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
    encryptBuffer
} from '@/lib/crypto';
import { userDataSchema, fileSchema, ACCEPTED_FILE_TYPES } from '@/lib/validations';
import { z } from 'zod';

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
        const otp = generateOTP();
        const expiresAt = calculateExpiry(validityMinutes);

        // Run OTP hashing, user data encryption, and file encryption IN PARALLEL
        const [otpHash, encryptedUserData, dataHash, encryptedFiles] = await Promise.all([
            hashOTP(otp),
            Promise.resolve(encryptData(userData)),
            Promise.resolve(generateDataHash(userData)),
            Promise.all(
                files.map(async (file) => {
                    const buffer = Buffer.from(await file.arrayBuffer());
                    const { iv, authTag, encryptedContent } = encryptBuffer(buffer);
                    return {
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
                        encryptedContent,
                        iv,
                        authTag,
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
                    otpHash,
                    expiresAt,
                    userId: userDataRecord.id,
                    // V2.1 Additions
                    purpose: purpose || undefined,
                    purposeDetail: purposeDetail || undefined,
                    notificationEmail: notificationEmail || undefined,
                    files: {
                        create: encryptedFiles,
                    },
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

        return {
            success: true,
            shareUrl,
            ownerUrl,
            otp,
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
