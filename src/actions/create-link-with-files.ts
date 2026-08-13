'use server';

import { prisma } from '@/lib/prisma';
import {
    generateSecureToken,
    generateOTP,
    hashOTP,
    calculateExpiryFromMode,
    type ExpiryMode,
    encryptData,
    generateDataHash,
    generateOwnerToken
} from '@/lib/crypto';
import { userDataSchema } from '@/lib/validations';
import { validateMimeType, ALLOWED_EXTENSIONS } from '@/lib/security/file-validator';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { requireOwnerRole } from '@/lib/security/roles';
import { checkUploadRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import path from 'path';
import { after } from 'next/server';
import { logger, redactToken, redactEmail } from '@/lib/logger';
import { isEmailConfigured } from '@/lib/email';

export type CreateSecureLinkResult = {
    success: boolean;
    shareUrl?: string;
    ownerUrl?: string;
    expiresAt?: Date;
    purpose?: string;  // V2.1: Return purpose for confirmation
    error?: string;
};

export async function createSecureLinkWithFiles(formData: FormData): Promise<CreateSecureLinkResult> {
    try {
        // ZERO TRUST: Only OWNER role (from Postgres, not JWT) can create secure links
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: 'Authentication required.' };
        }
        if (!(await requireOwnerRole(session.user.id))) {
            return { success: false, error: 'You do not have permission to create secure links.' };
        }

        void import('@/lib/mongo/client').then(({ isMongoConfigured, warmMongoConnection }) => {
            if (isMongoConfigured()) return warmMongoConnection();
        }).catch(() => {});

        // SECURITY: Rate limit uploads to prevent storage exhaustion
        const _headers = await headers();
        const clientIP = extractClientIP(_headers);
        const rateLimit = await checkUploadRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return { success: false, error: formatRateLimitError(rateLimit) };
        }

        // 1. Extract and Validate Text Data
        const rawData = {
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
        };

        // V2.1: Extract purpose and notification fields
        const purpose = formData.get('purpose') as string | null;
        const purposeDetail = formData.get('purposeDetail') as string | null;
        const notificationEmail = formData.get('notificationEmail') as string | null;

        // V2.2: Topic is mandatory — owner must describe what they're sharing
        const topic = (purpose || '').trim();
        if (!topic) {
            return { success: false, error: 'Topic is required. Please describe what data you are sharing.' };
        }

        // Zero Trust: Extract vendor email for email binding (Legacy/Fallback)
        const vendorEmail = formData.get('vendorEmail') as string | null;
        const vendorsStr = formData.get('vendors') as string | null;
        
        // Parse hierarchical vendors — clamp level to 1..10 (1 = team leader)
        let vendors: { email: string; level: number }[] = [];
        if (vendorsStr) {
            try {
                const parsed = JSON.parse(vendorsStr);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    return { success: false, error: 'Invalid vendors list' };
                }
                vendors = parsed.map((v: { email?: string; level?: number }) => {
                    const email = String(v.email || '').toLowerCase().trim();
                    const level = Math.min(10, Math.max(1, Number(v.level) || 2));
                    return { email, level };
                }).filter((v: { email: string }) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email));
                if (vendors.length === 0) {
                    return { success: false, error: 'At least one valid vendor email is required.' };
                }
            } catch (e) {
                return { success: false, error: 'Invalid vendors JSON format' };
            }
        } else if (vendorEmail) {
            vendors = [{ email: vendorEmail.toLowerCase(), level: 2 }];
        }

        if (vendors.length === 0) {
            return { success: false, error: 'At least one vendor is required. Specify who you are sending data to.' };
        }

        const allowEditing = formData.get('allowEditing') === 'true';
        const allowDownload = formData.get('allowDownload') === 'true';
        const validatedData = userDataSchema.safeParse(rawData);
        if (!validatedData.success) {
            return {
                success: false,
                error: validatedData.error.issues[0]?.message || 'Invalid input data',
            };
        }

        // 2. Extract and Process Files
        const files: File[] = [];
        const fileEntries = formData.getAll('files');

        for (const entry of fileEntries) {
            if (entry instanceof File && entry.size > 0) {
                files.push(entry);
            }
        }

        // FAST-FAIL: Validate file count and total size upfront
        const MAX_FILES = 50;
        const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB total

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

        // Validate all files: extension allowlist + magic byte verification
        // SECURITY: NEVER trust file.type — it's set by the client/browser and trivially spoofable
        const MAX_SINGLE_FILE_SIZE = 15 * 1024 * 1024; // 15MB per file
        for (const file of files) {
            if (file.size > MAX_SINGLE_FILE_SIZE) {
                return {
                    success: false,
                    error: `File "${file.name}" exceeds 15MB limit.`,
                };
            }

            // SECURITY: Reject null bytes in filenames (path traversal/injection)
            if (file.name.includes('\0')) {
                return { success: false, error: 'Invalid filename.' };
            }

            // SECURITY: Detect double extensions (e.g., "malware.pdf.exe")
            const nameParts = file.name.split('.');
            if (nameParts.length > 2) {
                // Check if any intermediate extension is dangerous
                for (let i = 1; i < nameParts.length - 1; i++) {
                    const intermediateExt = '.' + nameParts[i].toLowerCase();
                    if (ALLOWED_EXTENSIONS.has(intermediateExt)) {
                        // A known-good extension is NOT the final extension — suspicious
                        return {
                            success: false,
                            error: `File "${file.name}" has a suspicious double extension. Rename the file and try again.`,
                        };
                    }
                }
            }

            const ext = path.extname(file.name).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(ext)) {
                return {
                    success: false,
                    error: `File "${file.name}": type "${ext}" is not allowed. Permitted: Word, PDF, Excel, CSV, Images, Text.`,
                };
            }
        }

        const { firstName, lastName, email, phone, gender, age, expiryMode, expiryAmount } = validatedData.data;

        // 3. Prepare User Data for Encryption
        const userData = {
            firstName,
            lastName,
            email,
            phone,
            gender,
            age,
        };

        // 4. Generate Security Artifacts - PARALLELIZE crypto operations
        const token = generateSecureToken();
        const ownerToken = generateOwnerToken();
        const globalOtp = generateOTP(); // Fallback/Global OTP
        const expiresAt = calculateExpiryFromMode(expiryMode as ExpiryMode, expiryAmount);
        const validityMinutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));

        // Break-Based OTP Rotation: compute task duration and break limits dynamically
        const taskDurationHours = Math.max(1, Math.round(validityMinutes / 60));
        const allowedBreaks = Math.max(0, Math.floor(taskDurationHours / 2) - 1);

        const vendorAccessData = await Promise.all(
            vendors.map(async (v) => {
                const vendorOtp = generateOTP();
                const vendorOtpHash = await hashOTP(vendorOtp);
                return {
                    email: v.email,
                    level: v.level,
                    otp: vendorOtp,
                    otpHash: vendorOtpHash
                };
            })
        );

        // PERFORMANCE: Import modules ONCE before parallel file processing (not per-file)
        const { createEncryptionStream, generateDek, encryptDek } = await import('@/lib/crypto');
        const { uploadStreamToMongo } = await import('@/lib/mongo/operations');
        const { Readable } = await import('stream');

        // Run global OTP hashing, user data encryption, and file encryption IN PARALLEL
        const [globalOtpHash, encryptedUserData, dataHash, encryptedFiles] = await Promise.all([
            hashOTP(globalOtp),
            Promise.resolve(encryptData(userData)),
            Promise.resolve(generateDataHash(userData)),
            Promise.all(
                files.map(async (file) => {
                    // SECURITY: Stream only small chunk for magic bytes (prevents memory exhaustion)
                    const magicBytesBuffer = Buffer.from(await file.slice(0, 4100).arrayBuffer());
                    const ext = path.extname(file.name).toLowerCase();
                    const mimeCheck = validateMimeType(magicBytesBuffer, ext);
                    if (!mimeCheck.valid) {
                        throw new Error(`File "${file.name}": ${mimeCheck.error}`);
                    }
                    const trustedMimeType = mimeCheck.mimeType!;

                    // Sanitize filename: strip path components, limit length
                    const sanitizedName = path.basename(file.name).substring(0, 255);

                    const dek = generateDek();
                    const { cipher, iv, getAuthTag } = createEncryptionStream(dek);
                    const encryptedDekStr = encryptDek(dek);
                    
                    // Web Stream -> Node Readable Stream -> Encryption Transform
                    const nodeStream = Readable.fromWeb(file.stream() as any);
                    const encryptedStream = nodeStream.pipe(cipher);

                    // Upload directly to Mongo GridFS using streams (fast, no memory spikes)
                    const uploadResult = await uploadStreamToMongo({
                        stream: encryptedStream,
                        originalFileName: sanitizedName,
                        mimeType: trustedMimeType,
                        fileExtension: ext.replace('.', ''),
                        folder: 'vendor-uploads',
                        uploadedBy: session.user.id,
                        classification: 'INTERNAL',
                    });

                    // Auth tag is available ONLY after the cipher stream finishes
                    const authTag = getAuthTag();

                    return {
                        fileName: sanitizedName,
                        fileType: trustedMimeType,
                        fileSize: uploadResult.fileSize,
                        iv,
                        authTag,
                        encryptedDek: encryptedDekStr,
                        mongoFile: {
                            create: {
                                gridFSId: uploadResult.gridFSId,
                                originalFileName: sanitizedName,
                                mimeType: trustedMimeType,
                                fileExtension: ext.replace('.', ''),
                                fileSize: uploadResult.fileSize,
                                checksum: uploadResult.checksum,
                                folder: 'vendor-uploads',
                                uploadedBy: session.user.id,
                                classification: 'INTERNAL',
                            }
                        }
                    };
                })
            ),
        ]);

        // 5. Database Transaction - Optimized with shorter timeout
        const result = await prisma.$transaction(async (tx) => {
            // Create UserData Record
            const userDataRecord = await tx.userData.create({
                data: {
                    encryptedData: encryptedUserData,
                    dataHash,
                },
            });

            const secureLink = await tx.secureLink.create({
                include: {
                    VendorAccess: { select: { id: true, currentOtpHash: true } },
                },
                data: {
                    token,
                    ownerToken,
                    otpHash: globalOtpHash,
                    expiresAt,
                    userId: userDataRecord.id,
                    // OWNER BINDING: Associate link with authenticated user
                    ownerId: session.user.id,
                    purpose: topic,
                    purposeDetail: purposeDetail || undefined,
                    notificationEmail: notificationEmail || undefined,
                    // Zero Trust: Email binding - only this email can verify OTP
                    allowedVendorEmail: vendorEmail || undefined,
                    allowEditing,
                    allowDownload,
                    LinkAccess: {
                        create: vendorAccessData.map(v => ({ 
                            vendorEmail: v.email, 
                            level: v.level,
                            otpHash: v.otpHash,
                        })),
                    },
                    UserFile: {
                        create: encryptedFiles,
                    },
                    VendorAccess: {
                        create: vendors.map(v => {
                            const vendorOtpData = vendorAccessData.find(vd => vd.email === v.email);
                            return {
                                email: v.email.toLowerCase(),
                                level: v.level,
                                maxLogins: 3,
                                // Break-Based OTP Rotation fields
                                taskDurationHours,
                                allowedBreaks,
                                currentOtpHash: vendorOtpData?.otpHash ?? null,
                                currentOtpCreatedAt: new Date(),
                                currentOtpExpiresAt: expiresAt,
                            };
                        })
                    }
                },
            });

            // V2.2: Create a SendRecord that SURVIVES data deletion
            // Owner can always see WHO they sent data to and WHAT topic
            await tx.sendRecord.create({
                data: {
                    ownerId: session.user.id,
                    topic,
                    vendorEmail: vendors.map(v => v.email).join(', '),
                    fileCount: files.length,
                    status: 'active',
                    expiredAt: expiresAt,
                },
            });

            const createdVendors = secureLink.VendorAccess;
            if (createdVendors.length > 0) {
                await tx.otpHistory.createMany({
                    data: createdVendors
                        .filter(v => v.currentOtpHash)
                        .map(v => ({
                            vendorAccessId: v.id,
                            otpHash: v.currentOtpHash!,
                            reason: 'INITIAL',
                            status: 'ACTIVE',
                        })),
                });
            }

            return secureLink;
        }, {
            maxWait: 5000,
            // Do not hold a pool slot for 60s — that is what starves /create-link vendor list (P2024).
            timeout: 15000,
        });

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const shareUrl = `${baseUrl}/share/${token}`;
        const ownerUrl = `${baseUrl}/revoke/${ownerToken}`;

        logger.info(`Link created with ${files.length} files. ID: ${redactToken(result.id)}`);

        const finishAfterResponse = async () => {
            await prisma.auditLog.create({
                data: {
                    action: 'CREATED',
                    linkId: result.id,
                    metadata: JSON.stringify({
                        fileCount: files.length,
                        purpose: purpose || undefined,
                        hasNotifications: !!notificationEmail,
                        allowDownload,
                    }),
                },
            }).catch(err => logger.warn('Failed to log audit event:', err.message));

            if (vendorAccessData.length === 0) return;
            if (!isEmailConfigured()) {
                logger.error('[EMAIL] Not configured — OTP emails were not sent');
                return;
            }
            const { sendOTPEmail } = await import('@/lib/email');
            await Promise.allSettled(
                vendorAccessData.map((v) =>
                    sendOTPEmail(v.email, token, v.otp, validityMinutes).then(() =>
                        logger.info(`OTP sent to ${redactEmail(v.email)}`),
                    ),
                ),
            );
        };

        try {
            after(finishAfterResponse);
        } catch {
            void finishAfterResponse();
        }

        return {
            success: true,
            shareUrl,
            ownerUrl,
            // SECURITY: OTP is NEVER returned in API response — delivered via email only
            expiresAt,
            purpose: purpose || undefined,
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error creating secure link:', message);

        const isMongoDns =
            /querySrv|ECONNREFUSED|MongoServerSelectionError|ENOTFOUND|mongodb/i.test(message);
        return {
            success: false,
            error: isMongoDns
                ? 'Could not reach the file storage database (MongoDB). Check your network/DNS and that Atlas is online, then try again.'
                : 'Failed to create secure link. Please try again.',
        };
    }
}
