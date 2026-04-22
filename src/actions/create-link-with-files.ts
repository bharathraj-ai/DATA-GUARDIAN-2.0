'use server';

import { prisma } from '@/lib/prisma';
import {
    generateSecureToken,
    generateOTP,
    hashOTP,
    calculateExpiry,
    encryptData,
    generateDataHash,
    generateOwnerToken,
    encryptBuffer,
    generateDek,
    encryptDek
} from '@/lib/crypto';
import { userDataSchema, fileSchema, ACCEPTED_FILE_TYPES } from '@/lib/validations';
import { z } from 'zod';
import { auth } from '@/lib/auth';

export type CreateSecureLinkResult = {
    success: boolean;
    shareUrl?: string;
    ownerUrl?: string;
    otp?: string;
    expiresAt?: Date;
    purpose?: string;  // V2.1: Return purpose for confirmation
    error?: string;
};

export async function createSecureLinkWithFiles(formData: FormData): Promise<CreateSecureLinkResult> {
    try {
        // ZERO TRUST: Only OWNER role can create secure links
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: 'Authentication required.' };
        }
        const userRole = (session.user as any)?.role;
        if (userRole === 'VENDOR') {
            return { success: false, error: 'Vendors cannot create secure links. Only owners can create links.' };
        }

        // 1. Extract and Validate Text Data
        const rawData = {
            firstName: formData.get('firstName'),
            lastName: formData.get('lastName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            gender: formData.get('gender'),
            age: Number(formData.get('age')),
            validityMinutes: Number(formData.get('validityMinutes')),
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
        
        // Parse hierarchical vendors
        let vendors: { email: string; level: number }[] = [];
        if (vendorsStr) {
            try {
                vendors = JSON.parse(vendorsStr);
            } catch (e) {
                return { success: false, error: 'Invalid vendors JSON format' };
            }
        } else if (vendorEmail) {
            // Fallback: Make them a standard Level 2 user
            vendors = [{ email: vendorEmail.toLowerCase(), level: 2 }];
        }

        if (vendors.length === 0) {
            return { success: false, error: 'At least one vendor is required. Specify who you are sending data to.' };
        }

        const allowEditing = formData.get('allowEditing') === 'true';
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

        // Validate all files first (fast check)
        for (const file of files) {
            const validation = fileSchema.safeParse({ size: file.size, type: file.type });
            if (!validation.success) {
                return {
                    success: false,
                    error: `File ${file.name}: ${validation.error.issues[0]?.message}`,
                };
            }
        }

        const { firstName, lastName, email, phone, gender, age, validityMinutes } = validatedData.data;

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
        const expiresAt = calculateExpiry(validityMinutes);

        // Generate per-vendor OTPs
        const vendorAcessData = await Promise.all(
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

        // Run global OTP hashing, user data encryption, and file encryption IN PARALLEL
        const [globalOtpHash, encryptedUserData, dataHash, encryptedFiles] = await Promise.all([
            hashOTP(globalOtp),
            Promise.resolve(encryptData(userData)),
            Promise.resolve(generateDataHash(userData)),
            Promise.all(
                files.map(async (file) => {
                    const buffer = Buffer.from(await file.arrayBuffer());
                    const dek = generateDek();
                    const { iv, authTag, encryptedContent } = encryptBuffer(buffer, dek);
                    const encryptedDek = encryptDek(dek);
                    return {
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        encryptedContent,
                        iv,
                        authTag,
                        encryptedDek,
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

            // Create SecureLink with Files (V2.1 Enhanced)
            const secureLink = await tx.secureLink.create({
                data: {
                    token,
                    ownerToken,
                    otpHash: globalOtpHash,
                    otpPlain: globalOtp,
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
                    LinkAccess: {
                        create: vendorAcessData.map(v => ({ 
                            vendorEmail: v.email, 
                            level: v.level,
                            otpHash: v.otpHash,
                            otpPlain: v.otp
                        })),
                    },
                    UserFile: {
                        create: encryptedFiles,
                    },
                    VendorAccess: {
                        create: vendors.map(v => ({
                            email: v.email.toLowerCase(),
                            level: v.level,
                            maxLogins: 3
                        }))
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

            return secureLink;
        }, {
            maxWait: 5000,   // Reduced from 30s - fail fast on connection issues
            timeout: 60000  // Reduced from 5min - most operations should complete quickly
        });

        // Audit log AFTER transaction (non-blocking, fire-and-forget for speed)
        prisma.auditLog.create({
            data: {
                action: 'CREATED',
                linkId: result.id,
                metadata: JSON.stringify({
                    fileCount: files.length,
                    purpose: purpose || undefined,
                    hasNotifications: !!notificationEmail
                }),
            },
        }).catch(err => console.warn('[AUDIT] Failed to log:', err.message));

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const shareUrl = `${baseUrl}/share/${token}`;
        const ownerUrl = `${baseUrl}/revoke/${ownerToken}`;

        console.log(`[SECURE] Link created with ${files.length} files. ID: ${result.id}`);

        // 📧 Send OTP email to all vendors per their unique OTPs (fire-and-forget)
        if (vendorAcessData.length > 0) {
            import('@/lib/email').then(({ sendOTPEmail }) => {
                vendorAcessData.forEach(v => {
                    sendOTPEmail(v.email, token, v.otp, validityMinutes)
                        .then(() => console.log(`[EMAIL] OTP sent to ${v.email.substring(0, 3)}***`))
                        .catch((err) => console.error('[EMAIL] Failed to send OTP:', err.message));
                });
            });
        }

        return {
            success: true,
            shareUrl,
            ownerUrl,
            otp: globalOtp,
            expiresAt,
            purpose: purpose || undefined,  // V2.1: Return for UI confirmation
        };

    } catch (error) {
        console.error('Error creating secure link:', error instanceof Error ? error.message : 'Unknown error');
        return {
            success: false,
            error: 'Failed to create secure link. Please try again.',
        };
    }
}
