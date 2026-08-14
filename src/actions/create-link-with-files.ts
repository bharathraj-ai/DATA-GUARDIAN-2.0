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
import { checkUploadRateLimit, extractClientIP, formatRateLimitError, type RateLimitResult } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { logger, redactToken, redactEmail } from '@/lib/logger';
import { isEmailConfigured, warmEmailTransport } from '@/lib/email';
import { isMongoConfigured, warmMongoConnection } from '@/lib/mongo/client';
import type { CreateSecureLinkResult } from '@/lib/create-link-result';
import type { CreateLinkJson } from '@/lib/create-link-payload';
import {
    loadStagedFiles,
    markStagedFilesLinked,
    MAX_FILES,
    MAX_TOTAL_SIZE,
    stagePlainFile,
    type PreparedLinkFile,
} from '@/lib/create-link-stage';

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
    | { ok: true; session: SessionUser; clientIP: string }
    | { ok: false; error: string }
> {
    warmCreateLinkDeps();
    const [session, requestHeaders] = await Promise.all([auth(), headers()]);
    if (!session?.user?.id) {
        return { ok: false, error: 'Authentication required.' };
    }
    if (!canCreateSecureLinks(session.user.role)) {
        return { ok: false, error: 'You do not have permission to create secure links.' };
    }
    if (!isEmailConfigured()) {
        return {
            ok: false,
            error: 'Email is not configured on the server. Set EMAIL_USER and EMAIL_PASS (or SMTP_USER / SMTP_PASS) so the OTP can be delivered.',
        };
    }
    const clientIP = extractClientIP(requestHeaders);
    const rateLimit = await Promise.race([
        checkUploadRateLimit(clientIP),
        new Promise<RateLimitResult>((resolve) =>
            setTimeout(
                () =>
                    resolve({
                        allowed: true,
                        remaining: 1,
                        resetAt: Date.now() + 3_600_000,
                    }),
                50,
            ),
        ),
    ]);
    if (!rateLimit.allowed) {
        return { ok: false, error: formatRateLimitError(rateLimit) };
    }
    return { ok: true, session: { id: session.user.id, role: session.user.role }, clientIP };
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
    } = params;

    if (!isEmailConfigured()) {
        return {
            success: false,
            error: 'Email is not configured on the server. Set EMAIL_USER and EMAIL_PASS (or SMTP_USER / SMTP_PASS) so the OTP can be delivered.',
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

    const sendRecordPayload = {
        ownerId,
        topic,
        vendorEmail: vendors.map((v) => v.email).join(', '),
        fileCount: preparedFiles.length,
        status: 'active' as const,
        expiredAt: expiresAt,
    };

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const shareUrl = `${baseUrl}/share/${token}`;
    const ownerUrl = `${baseUrl}/revoke/${ownerToken}`;

    logger.info(
        `Link created in ${Date.now() - startedAt}ms (files=${filesMs}ms db=${Date.now() - dbStartedAt}ms) with ${preparedFiles.length} files. ID: ${redactToken(secureLink.id)}`,
    );

    const otpVendors = vendorAccessData.map((v) => ({ email: v.email, otp: v.otp }));
    const otpByEmail = new Map(vendorAccessData.map((v) => [v.email.toLowerCase(), v.otpHash]));
    const stagedIds = preparedFiles.map((f) => f.gridFSId);

    runAfterResponse(async () => {
        const stampWork = Promise.all([
            prisma.sendRecord.create({ data: sendRecordPayload }).catch((err) =>
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

        const { sendOTPEmail } = await import('@/lib/email');
        const mailWork = Promise.allSettled(
            otpVendors.map((v) =>
                sendOTPEmail(v.email, token, v.otp, validityMinutes).then(() =>
                    logger.info(`OTP sent to ${redactEmail(v.email)}`),
                ),
            ),
        ).then((results) => {
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length === results.length) {
                const reason = failed[0].status === 'rejected' ? failed[0].reason : null;
                logger.error(
                    '[EMAIL FAILED] Could not send any OTP emails after link create',
                    reason instanceof Error ? reason.message : reason,
                );
            } else if (failed.length > 0) {
                logger.warn(`[EMAIL] ${failed.length}/${results.length} OTP emails failed after link create`);
            }
        });

        await Promise.all([stampWork, mailWork]);
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
        if (totalSize > MAX_TOTAL_SIZE) {
            return {
                success: false,
                error: `Total file size exceeds 100MB limit (${(totalSize / 1024 / 1024).toFixed(1)}MB selected).`,
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
        if (files.length > MAX_FILES) {
            return {
                success: false,
                error: `Too many files. Maximum ${MAX_FILES} files allowed (you selected ${files.length}).`,
            };
        }
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        if (totalSize > MAX_TOTAL_SIZE) {
            return {
                success: false,
                error: `Total file size exceeds 100MB limit (${(totalSize / 1024 / 1024).toFixed(1)}MB selected).`,
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
