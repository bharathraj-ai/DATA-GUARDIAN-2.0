import { z } from 'zod';

export const userDataSchema = z.object({
    firstName: z.string().max(50, 'First name too long').optional().or(z.literal('')),
    lastName: z.string().max(50, 'Last name too long').optional().or(z.literal('')),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().max(15, 'Phone number too long').optional().or(z.literal('')),
    gender: z.string().optional().or(z.literal('')),
    age: z.number().int().max(150, 'Invalid age').optional().or(z.literal(0)),
    validityMinutes: z.number().int().min(1, 'Validity must be at least 1 minute').max(10080, 'Validity cannot exceed 7 days').optional(),
    expiryMode: z.enum(['time', 'days', 'months']).default('time'),
    expiryAmount: z.number().int().min(1, 'Expiration value must be at least 1'),
}).superRefine((data, ctx) => {
    const { expiryMode, expiryAmount } = data;
    if (expiryMode === 'time' && expiryAmount > 10080) {
        ctx.addIssue({
            code: 'custom',
            message: 'Time-based validity cannot exceed 7 days (10,080 minutes)',
            path: ['expiryAmount'],
        });
    }
    if (expiryMode === 'days' && expiryAmount > 365) {
        ctx.addIssue({
            code: 'custom',
            message: 'Day count cannot exceed 365 days',
            path: ['expiryAmount'],
        });
    }
    if (expiryMode === 'months' && expiryAmount > 12) {
        ctx.addIssue({
            code: 'custom',
            message: 'Month period cannot exceed 12 months',
            path: ['expiryAmount'],
        });
    }
});

export type UserDataInput = z.infer<typeof userDataSchema>;

export const otpVerifySchema = z.object({
    token: z.string().uuid('Invalid link token'),
    otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d+$/, 'OTP must contain only digits'),
    vendorEmail: z.string().email('Invalid email address').optional(),
});

export type OTPVerifyInput = z.infer<typeof otpVerifySchema>;

export const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB Total

export const ACCEPTED_FILE_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv', // .csv
    'image/png', // .png
    'image/jpeg', // .jpg, .jpeg
    'application/pdf', // .pdf
    'text/plain', // .txt
];

export const fileSchema = z.object({
    size: z.number().max(MAX_FILE_SIZE, 'File size must be less than 15MB'),
    type: z.enum([ACCEPTED_FILE_TYPES[0], ...ACCEPTED_FILE_TYPES.slice(1)] as [string, ...string[]], {
        message: 'Invalid file type. Allowed: Excel, CSV, Images, PDF, Text',
    }),
});

// ============================================
// V2.1 ADDITIONS - PURPOSE TAGS
// ============================================

export const SharePurposeSchema = z.enum([
    'VERIFICATION',
    'REVIEW',
    'AUDIT',
    'COLLABORATION',
    'COMPLIANCE',
    'SUPPORT',
    'OTHER'
], {
    message: 'Please select a valid purpose category'
});

export type SharePurpose = z.infer<typeof SharePurposeSchema>;
