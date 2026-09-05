import 'server-only';

import { prisma, warmPrismaConnection } from '@/lib/prisma';
import {
    generateSecureToken,
    generateOTP,
    hashOTPSync,
    calculateExpiryFromMode,
    type ExpiryMode,
    encryptData,
    generateDataHash,
    generateOwnerToken,
} from '@/lib/crypto';
import { userDataSchema } from '@/lib/validations';
import { auth } from '@/lib/auth';
import { canCreateSecureLinks } from '@/lib/security/role-helpers';
import { checkUploadRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { logger, redactToken } from '@/lib/logger';
import { bindRequestIdFromHeaders } from '@/lib/request-context';
import { isEmailConfigured, warmEmailTransport } from '@/lib/email';
import { isMongoConfigured, warmMongoConnection } from '@/lib/mongo/client';
import type { CreateSecureLinkResult } from '@/lib/create-link-result';
import type { CreateLinkJson } from '@/lib/create-link-payload';
import {
    loadStagedFiles,
    markStagedFilesLinked,
    stagePlainFile,
    type PreparedLinkFile,
} from '@/lib/create-link-stage';
import { countActiveLinksForOwner, resolvePlanLimitsForUser } from '@/lib/plan-limits';
import { formatBytes, type PlanLimits } from '@/lib/plans';

export type { CreateSecureLinkResult };

type SessionUser = { id: string; role?: string | null };

function runAfterResponse(work: () => Promise<void>) {
    try {
        after(work);
    } catch {
        void work();
    }
}

function warmCreateLinkDeps() {
    if (isMongoConfigured()) {
        void warmMongoConnection().catch(() => {});
    }
    warmPrismaConnection();
    warmEmailTransport();
}

async function gateCreateLink(): Promise<
    | { ok: true; session: SessionUser; clientIP: string; plan: PlanLimits }
    | { ok: false; error: string }
> {
    warmCreateLinkDeps();
    const [session, requestHeaders] = await Promise.all([auth(), headers()]);
    await bindRequestIdFromHeaders();
    if (!session?.user?.id) {
        return { ok: false, error: 'Authentication required.' };
    }
    if (!canCreateSecureLinks(session.user.role)) {
        return { ok: false, error: 'Only team leaders can create secure links.' };
    }
    if (!isEmailConfigured()) {
        return {
            ok: false,
            error: 'Email is not configured on the server. Set EMAIL_USER and EMAIL_PASS (or SMTP_USER / SMTP_PASS) so the OTP can be delivered.',
        };
    }

    let plan: PlanLimits;
    try {
        plan = await resolvePlanLimitsForUser(session.user.id);
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Plan check failed.' };
    }

    const active = await countActiveLinksForOwner(session.user.id);
    if (active >= plan.maxActiveLinks) {
        return {
            ok: false,
            error: `Your ${plan.label} plan allows ${plan.maxActiveLinks} active link(s). Revoke or wait for expiry, or request a plan upgrade.`,
        };
    }

    const clientIP = extractClientIP(requestHeaders);
    const rateLimit = await checkUploadRateLimit(clientIP);
    if (!rateLimit.allowed) {
        return { ok: false, error: formatRateLimitError(rateLimit) };
    }
    return {
        ok: true,
        session: { id: session.user.id, role: session.user.role },
        clientIP,
        plan,
    };
}

function parseVendors(input: unknown, vendorEmail?: string | null): { email: string; level: number }[] | string {
    let vendors: { email: string; level: number }[] = [];
    if (Array.isArray(input)) {
        if (input.length === 0) return 'Invalid vendors list';
        vendors = input
            .map((v: { email?: string; level?: number }) => {
                const email = String(v.email || '').toLowerCase().trim();
                const level = Math.min(10, Math.max(1, Number(v.level) || 2));
                return { email, level };
            })
            .filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email));
        if (vendors.length === 0) return 'At least one valid vendor email is required.';
    } else if (vendorEmail) {
        vendors = [{ email: vendorEmail.toLowerCase(), level: 2 }];
    }
    if (vendors.length === 0) {
        return 'At least one vendor is required. Specify who you are sending data to.';
    }
    return vendors;
}

async function executeCreateLink(params: {
    startedAt: number;
    ownerId: string;
    rawData: Record<string, unknown>;
    topic: string;
    purposeDetail?: string | null;
    notificationEmail?: string | null;
    allowEditing: boolean;
    allowDownload: boolean;
    vendors: { email: string; level: number }[];
    preparedFiles: PreparedLinkFile[];
    filesMs: number;
    userDataId?: string;
    plan: PlanLimits;
}): Promise<CreateSecureLinkResult> {
    const {
        startedAt,
        ownerId,
        rawData,
        topic,
        purposeDetail,
        notificationEmail,
        allowEditing,
        allowDownload,
        vendors,
        preparedFiles,
        filesMs,
        userDataId,
        plan,
    } = params;

    if (!isEmailConfigured()) {
        return {
            success: false,
            error: 'Email is not configured on the server. Set EMAIL_USER and EMAIL_PASS (or SMTP_USER / SMTP_PASS) so the OTP can be delivered.',
        };
    }

    if (preparedFiles.length > plan.maxFilesPerLink) {
        return {
            success: false,
            error: `Your ${plan.label} plan allows ${plan.maxFilesPerLink} files per link (${preparedFiles.length} selected).`,
        };
    }
    const totalSize = preparedFiles.reduce((sum, f) => sum + f.fileSize, 0);
    if (totalSize > plan.maxTotalBytesPerLink) {
        return {
            success: false,
            error: `Your ${plan.label} plan allows ${formatBytes(plan.maxTotalBytesPerLink)} per link (${formatBytes(totalSize)} selected).`,
        };
    }

    const validatedData = userDataSchema.safeParse(rawData);
    if (!validatedData.success) {
        return {
            success: false,
            error: validatedData.error.issues[0]?.message || 'Invalid input data',
        };
    }

    const { firstName, lastName, email, phone, gender, age, expiryMode, expiryAmount } = validatedData.data;
    const userData = { firstName, lastName, email, phone, gender, age };

    const token = generateSecureToken();
    const ownerToken = generateOwnerToken();
    const globalOtp = generateOTP();
    const expiresAt = calculateExpiryFromMode(expiryMode as ExpiryMode, expiryAmount);
    const retentionMs = plan.maxRetentionDays * 24 * 60 * 60 * 1000;
    if (expiresAt.getTime() - Date.now() > retentionMs) {
        return {
            success: false,
            error: `Your ${plan.label} plan allows at most ${plan.maxRetentionDays} days of link retention.`,
        };
    }
    const validityMinutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
    const taskDurationHours = Math.max(1, Math.round(validityMinutes / 60));
    const allowedBreaks = Math.max(0, Math.floor(taskDurationHours / 2) - 1);
    const otpIssuedAt = new Date();

    const vendorAccessData = vendors.map((v) => {
        const vendorOtp = generateOTP();
        return {
            email: v.email,
            level: v.level,
            otp: vendorOtp,
            otpHash: hashOTPSync(vendorOtp),
        };
    });
    const globalOtpHash = hashOTPSync(globalOtp);
    const encryptedUserData = encryptData(userData);
    const dataHash = generateDataHash(userData);

    const { ensureOwnerOrganization } = await import('@/lib/tenant');
    const ownerRow = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { email: true, name: true },
    });
    const org = await ensureOwnerOrganization({
        userId: ownerId,
        email: ownerRow?.email,
        name: ownerRow?.name,
    });

    const dbStartedAt = Date.now();
    const userDataRecord = userDataId
        ? { id: userDataId }
        : await prisma.userData.create({
              data: {
                  encryptedData: encryptedUserData,
                  dataHash,
              },
              select: { id: true },
          });

    const secureLink = await prisma.secureLink.create({
        select: { id: true },
        data: {
            token,
            ownerToken,
            otpHash: globalOtpHash,
            expiresAt,
            userId: userDataRecord.id,
            ownerId,
            organizationId: org.organizationId || undefined,
            purpose: topic,
            purposeDetail: purposeDetail || undefined,
            notificationEmail: notificationEmail || undefined,
            allowedVendorEmail: vendors[0]?.email || undefined,
            allowEditing,
            allowDownload,
        },
    });

    const [vendorRows] = await Promise.all([
        prisma.vendorAccess.createManyAndReturn({
            data: vendorAccessData.map((v) => ({
                email: v.email.toLowerCase(),
                level: v.level,
                maxLogins: 3,
                taskDurationHours,
                allowedBreaks,
                currentOtpHash: v.otpHash,
                currentOtpCreatedAt: otpIssuedAt,
                currentOtpExpiresAt: expiresAt,
                secureLinkId: secureLink.id,
            })),
            select: { id: true, email: true },
        }),
        prisma.linkAccess.createMany({
            data: vendorAccessData.map((v) => ({
                secureLinkId: secureLink.id,
                vendorEmail: v.email,
                level: v.level,
                otpHash: v.otpHash,
            })),
        }),
        preparedFiles.length === 0
            ? Promise.resolve([])
            : prisma.mongoFile.createManyAndReturn({
                  data: preparedFiles.map((file) => ({
                      gridFSId: file.gridFSId,
                      originalFileName: file.fileName,
                      mimeType: file.fileType,
                      fileExtension: file.fileExtension,
                      fileSize: file.fileSize,
                      checksum: file.checksum,
                      folder: 'vendor-uploads',
                      uploadedBy: ownerId,
                      classification: 'INTERNAL',
                      scanStatus: file.scanStatus || 'pending',
                  })),
                  select: { id: true, gridFSId: true },
              }).then((mongoRows) => {
                  const missing = preparedFiles.filter(
                      (file) => !mongoRows.some((row) => row.gridFSId === file.gridFSId),
                  );
                  if (missing.length > 0) {
                      throw new Error('Could not attach prepared files. Please try again.');
                  }
                  return prisma.userFile.createMany({
                      data: preparedFiles.map((file) => {
                          const mongo = mongoRows.find((row) => row.gridFSId === file.gridFSId)!;
                          return {
                              fileName: file.fileName,
                              fileType: file.fileType,
                              fileSize: file.fileSize,
                              iv: file.iv,
                              authTag: file.authTag,
                              encryptedDek: file.encryptedDek,
                              secureLinkId: secureLink.id,
                              mongoFileId: mongo.id,
                          };
                      }),
                  });
              }),
    ]);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/share/${token}`;
    const ownerUrl = `${baseUrl}/revoke/${ownerToken}`;

    logger.info(
        `Link created in ${Date.now() - startedAt}ms (files=${filesMs}ms db=${Date.now() - dbStartedAt}ms) with ${preparedFiles.length} files. ID: ${redactToken(secureLink.id)}`,
    );

    const otpVendors = vendorAccessData.map((v) => ({ email: v.email, otp: v.otp }));
    const otpByEmail = new Map(vendorAccessData.map((v) => [v.email.toLowerCase(), v.otpHash]));
    const stagedIds = preparedFiles.map((f) => f.gridFSId);

    if (otpVendors.length > 0) {
        const { enqueueOtpEmails } = await import('@/lib/jobs');
        await enqueueOtpEmails(otpVendors, token, validityMinutes);
    }

    runAfterResponse(async () => {
        const stampWork = Promise.all([
            prisma.sendRecord.createMany({
                data: vendors.map((v) => ({
                    ownerId,
                    topic,
                    vendorEmail: v.email.toLowerCase(),
                    fileCount: preparedFiles.length,
                    status: 'active' as const,
                    expiredAt: expiresAt,
                })),
            }).catch((err) =>
                logger.warn('Failed to stamp send record:', err.message),
            ),
            prisma.auditLog.create({
                data: {
                    action: 'CREATED',
                    linkId: secureLink.id,
                    metadata: JSON.stringify({
                        fileCount: preparedFiles.length,
                        purpose: topic || undefined,
                        hasNotifications: !!notificationEmail,
                        allowDownload,
                    }),
                },
            }).catch((err) => logger.warn('Failed to log audit event:', err.message)),
            prisma.otpHistory.createMany({
                data: vendorRows.map((row) => ({
                    vendorAccessId: row.id,
                    otpHash: otpByEmail.get(row.email.toLowerCase()) || '',
                    reason: 'INITIAL',
                    status: 'ACTIVE',
                })).filter((row) => row.otpHash),
            }).catch((err) => logger.warn('Failed to stamp OTP history:', err.message)),
            markStagedFilesLinked(stagedIds).catch((err) =>
                logger.warn('Failed to mark staged files linked:', err instanceof Error ? err.message : err),
            ),
        ]);

        if (otpVendors.length === 0) {
            await stampWork;
            return;
        }

        const { processDueJobs } = await import('@/lib/jobs');
        await stampWork;
        await processDueJobs(otpVendors.length + 5);
    });

    return {
        success: true,
        shareUrl,
        ownerUrl,
        expiresAt: expiresAt.toISOString(),
        purpose: topic || undefined,
    };
}

export async function createSecureLinkFromJson(body: CreateLinkJson): Promise<CreateSecureLinkResult> {
    const startedAt = Date.now();
    try {
        const gate = await gateCreateLink();
        if (!gate.ok) return { success: false, error: gate.error };

        const topic = (body.purpose || '').trim();
        if (!topic) {
            return { success: false, error: 'Topic is required. Please describe what data you are sharing.' };
        }

        const vendors = parseVendors(body.vendors);
        if (typeof vendors === 'string') {
            return { success: false, error: vendors };
        }

        const stagedIds = Array.isArray(body.stagedGridFsIds) ? body.stagedGridFsIds.map(String) : [];
        const filesStartedAt = Date.now();
        const rawData = {
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: body.phone,
            gender: body.gender,
            age: Number(body.age),
            expiryMode: body.expiryMode || 'time',
            expiryAmount: Number(body.expiryAmount),
        };
        const validatedData = userDataSchema.safeParse(rawData);
        if (!validatedData.success) {
            return {
                success: false,
                error: validatedData.error.issues[0]?.message || 'Invalid input data',
            };
        }
        const { firstName, lastName, email, phone, gender, age } = validatedData.data;
        const encryptedUserData = encryptData({ firstName, lastName, email, phone, gender, age });
        const dataHash = generateDataHash({ firstName, lastName, email, phone, gender, age });

        const [preparedFiles, userDataRecord] = await Promise.all([
            loadStagedFiles(gate.session.id, stagedIds),
            prisma.userData.create({
                data: { encryptedData: encryptedUserData, dataHash },
                select: { id: true },
            }),
        ]);
        const totalSize = preparedFiles.reduce((sum, f) => sum + f.fileSize, 0);
        if (preparedFiles.length > gate.plan.maxFilesPerLink) {
            return {
                success: false,
                error: `Your ${gate.plan.label} plan allows ${gate.plan.maxFilesPerLink} files per link (${preparedFiles.length} selected).`,
            };
        }
        if (totalSize > gate.plan.maxTotalBytesPerLink) {
            return {
                success: false,
                error: `Your ${gate.plan.label} plan allows ${formatBytes(gate.plan.maxTotalBytesPerLink)} per link (${formatBytes(totalSize)} selected).`,
            };
        }

        return await executeCreateLink({
            startedAt,
            ownerId: gate.session.id,
            rawData,
            topic,
            purposeDetail: body.purposeDetail,
            notificationEmail: body.notificationEmail,
            allowEditing: Boolean(body.allowEditing),
            allowDownload: Boolean(body.allowDownload),
            vendors,
            preparedFiles,
            filesMs: Date.now() - filesStartedAt,
            userDataId: userDataRecord.id,
            plan: gate.plan,
        });
    } catch (error) {
        return failCreateLink(error);
    }
}

export async function createSecureLinkWithFiles(formData: FormData): Promise<CreateSecureLinkResult> {
    const startedAt = Date.now();
    try {
        const gate = await gateCreateLink();
        if (!gate.ok) return { success: false, error: gate.error };

        const topic = String(formData.get('purpose') || '').trim();
        if (!topic) {
            return { success: false, error: 'Topic is required. Please describe what data you are sharing.' };
        }

        const vendorsStr = formData.get('vendors') as string | null;
        let vendorList: unknown = undefined;
        if (vendorsStr) {
            try {
                vendorList = JSON.parse(vendorsStr);
            } catch {
                return { success: false, error: 'Invalid vendors JSON format' };
            }
        }
        const vendors = parseVendors(vendorList, formData.get('vendorEmail') as string | null);
        if (typeof vendors === 'string') {
            return { success: false, error: vendors };
        }

        const files: File[] = [];
        for (const entry of formData.getAll('files')) {
            if (entry instanceof File && entry.size > 0) files.push(entry);
        }
        if (files.length > gate.plan.maxFilesPerLink) {
            return {
                success: false,
                error: `Your ${gate.plan.label} plan allows ${gate.plan.maxFilesPerLink} files per link (${files.length} selected).`,
            };
        }
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        if (totalSize > gate.plan.maxTotalBytesPerLink) {
            return {
                success: false,
                error: `Your ${gate.plan.label} plan allows ${formatBytes(gate.plan.maxTotalBytesPerLink)} per link (${formatBytes(totalSize)} selected).`,
            };
        }

        const filesStartedAt = Date.now();
        const preparedFiles = await Promise.all(
            files.map(async (file) => {
                const plain = Buffer.from(await file.arrayBuffer());
                return stagePlainFile({
                    buffer: plain,
                    fileName: file.name,
                    uploadedBy: gate.session.id,
                });
            }),
        ).catch(async (err) => {
            throw err;
        });

        return await executeCreateLink({
            startedAt,
            ownerId: gate.session.id,
            rawData: {
                firstName: formData.get('firstName'),
                lastName: formData.get('lastName'),
                email: formData.get('email'),
                phone: formData.get('phone'),
                gender: formData.get('gender'),
                age: Number(formData.get('age')),
                validityMinutes: (() => {
                    const v = Number(formData.get('validityMinutes'));
                    return Number.isFinite(v) && v > 0 ? v : undefined;
                })(),
                expiryMode: (formData.get('expiryMode') as string) || 'time',
                expiryAmount: Number(formData.get('expiryAmount') || formData.get('validityMinutes')),
            },
            topic,
            purposeDetail: formData.get('purposeDetail') as string | null,
            notificationEmail: formData.get('notificationEmail') as string | null,
            allowEditing: formData.get('allowEditing') === 'true',
            allowDownload: formData.get('allowDownload') === 'true',
            vendors,
            preparedFiles,
            filesMs: Date.now() - filesStartedAt,
            plan: gate.plan,
        });
    } catch (error) {
        return failCreateLink(error);
    }
}

function failCreateLink(error: unknown): CreateSecureLinkResult {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error creating secure link:', message);

    const isMongoDns =
        /querySrv|ECONNREFUSED|MongoServerSelectionError|ENOTFOUND|mongodb/i.test(message);
    const isPrismaArg =
        /Unknown argument|Invalid `.*create\(\)` invocation/i.test(message);
    return {
        success: false,
        error: isMongoDns
            ? 'Could not reach the file storage database (MongoDB). Check your network/DNS and that Atlas is online, then try again.'
            : isPrismaArg
              ? 'Could not save the secure link. Refresh the page and try again.'
              : /Invalid filename|not allowed|double extension|exceeds|not ready|staged file|Too many files/i.test(message)
                ? message
                : 'Failed to create secure link. Please try again.',
    };
}
