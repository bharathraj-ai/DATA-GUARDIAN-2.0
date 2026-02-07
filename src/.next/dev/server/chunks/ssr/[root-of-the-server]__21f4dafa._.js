module.exports = [
"[externals]/os [external] (os, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("os", () => require("os"));

module.exports = mod;
}),
"[externals]/tty [external] (tty, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("tty", () => require("tty"));

module.exports = mod;
}),
"[externals]/fs [external] (fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs", () => require("fs"));

module.exports = mod;
}),
"[externals]/child_process [external] (child_process, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("child_process", () => require("child_process"));

module.exports = mod;
}),
"[externals]/fs/promises [external] (fs/promises, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs/promises", () => require("fs/promises"));

module.exports = mod;
}),
"[externals]/async_hooks [external] (async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("async_hooks", () => require("async_hooks"));

module.exports = mod;
}),
"[externals]/events [external] (events, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("events", () => require("events"));

module.exports = mod;
}),
"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/lib/prisma.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "prisma",
    ()=>prisma
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f40$prisma$2f$client$2f$default$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/@prisma/client/default.js [app-rsc] (ecmascript)");
;
const globalForPrisma = globalThis;
// Create new client only if one doesn't exist
function createPrismaClient() {
    const client = new __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f40$prisma$2f$client$2f$default$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PrismaClient"]({
        // Minimal logging for performance - only errors
        log: [
            'error'
        ]
    });
    return client;
}
const prisma = globalForPrisma.prisma ?? createPrismaClient();
// Cache client in development to prevent hot-reload memory leaks
if ("TURBOPACK compile-time truthy", 1) {
    globalForPrisma.prisma = prisma;
}
}),
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/lib/crypto.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "calculateExpiry",
    ()=>calculateExpiry,
    "decryptBuffer",
    ()=>decryptBuffer,
    "decryptData",
    ()=>decryptData,
    "encryptBuffer",
    ()=>encryptBuffer,
    "encryptData",
    ()=>encryptData,
    "generateDataHash",
    ()=>generateDataHash,
    "generateEncryptionKey",
    ()=>generateEncryptionKey,
    "generateOTP",
    ()=>generateOTP,
    "generateOwnerToken",
    ()=>generateOwnerToken,
    "generateSecureToken",
    ()=>generateSecureToken,
    "generateSessionId",
    ()=>generateSessionId,
    "hashOTP",
    ()=>hashOTP,
    "verifyOTPHash",
    ()=>verifyOTPHash
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$uuid$2f$dist$2d$node$2f$v4$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__default__as__v4$3e$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/uuid/dist-node/v4.js [app-rsc] (ecmascript) <export default as v4>");
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$bcryptjs$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/bcryptjs/index.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
;
;
;
function generateSecureToken() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$uuid$2f$dist$2d$node$2f$v4$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__default__as__v4$3e$__["v4"])();
}
function generateOTP() {
    const buffer = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].randomBytes(4);
    const num = buffer.readUInt32BE(0);
    const otp = num % 900000 + 100000;
    return otp.toString();
}
async function hashOTP(otp) {
    const secret = process.env.ENCRYPTION_KEY || 'fallback-secret';
    return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createHmac('sha256', secret).update(otp).digest('hex');
}
async function verifyOTPHash(otp, hash) {
    // Check if it's a bcrypt hash (starts with $2a$, $2b$, or $2y$)
    if (hash.startsWith('$2')) {
        // Legacy bcrypt verification for existing OTPs
        return __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$bcryptjs$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"].compare(otp, hash);
    }
    // Fast HMAC verification for new OTPs
    const secret = process.env.ENCRYPTION_KEY || 'fallback-secret';
    const computedHash = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createHmac('sha256', secret).update(otp).digest('hex');
    // Constant-time comparison to prevent timing attacks
    return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));
}
function calculateExpiry(minutes) {
    const now = new Date();
    return new Date(now.getTime() + minutes * 60 * 1000);
}
// ============================================
// AES-256-GCM ENCRYPTION UTILITIES
// ============================================
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
function generateEncryptionKey() {
    return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].randomBytes(KEY_LENGTH).toString('hex');
}
// Cache the encryption key to avoid repeated env parsing
let _cachedKey = null;
function getEncryptionKey() {
    if (_cachedKey) return _cachedKey;
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error('ENCRYPTION_KEY not configured in environment variables');
    }
    if (keyHex.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be 64 hex characters (256 bits)');
    }
    _cachedKey = Buffer.from(keyHex, 'hex');
    return _cachedKey;
}
function encryptData(data) {
    const key = getEncryptionKey();
    const iv = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].randomBytes(IV_LENGTH);
    const cipher = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });
    const plaintext = JSON.stringify(data);
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}
function decryptData(encryptedString) {
    const key = getEncryptionKey();
    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
    }
    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    if (iv.length !== IV_LENGTH) {
        throw new Error('Invalid IV length');
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error('Invalid auth tag length');
    }
    const decipher = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(authTag);
    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return JSON.parse(plaintext);
}
function encryptBuffer(buffer) {
    const key = getEncryptionKey();
    const iv = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].randomBytes(IV_LENGTH);
    const cipher = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });
    const encryptedContent = Buffer.concat([
        cipher.update(buffer),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    return {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        encryptedContent
    };
}
function decryptBuffer(encryptedContent, ivHex, authTagHex) {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(authTag);
    return Buffer.concat([
        decipher.update(encryptedContent),
        decipher.final()
    ]);
}
function generateDataHash(data) {
    const json = JSON.stringify(data);
    return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createHash('sha256').update(json).digest('hex');
}
function generateSessionId() {
    return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].randomBytes(32).toString('hex');
}
function generateOwnerToken() {
    return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].randomBytes(24).toString('base64url');
}
}),
"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/lib/validations.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ACCEPTED_FILE_TYPES",
    ()=>ACCEPTED_FILE_TYPES,
    "MAX_FILE_SIZE",
    ()=>MAX_FILE_SIZE,
    "MAX_TOTAL_SIZE",
    ()=>MAX_TOTAL_SIZE,
    "SharePurposeSchema",
    ()=>SharePurposeSchema,
    "fileSchema",
    ()=>fileSchema,
    "otpVerifySchema",
    ()=>otpVerifySchema,
    "userDataSchema",
    ()=>userDataSchema
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/zod/v4/classic/external.js [app-rsc] (ecmascript) <export * as z>");
;
const userDataSchema = __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    firstName: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1, 'First name is required').max(50, 'First name too long'),
    lastName: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(1, 'Last name is required').max(50, 'Last name too long'),
    email: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().email('Invalid email address'),
    phone: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().min(10, 'Phone number must be at least 10 digits').max(15, 'Phone number too long'),
    gender: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'male',
        'female',
        'other',
        'prefer-not-to-say'
    ], {
        message: 'Please select a valid gender option'
    }),
    age: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().int().min(1, 'Age must be at least 1').max(150, 'Invalid age'),
    validityMinutes: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().int().min(1, 'Validity must be at least 1 minute').max(1440, 'Validity cannot exceed 24 hours')
});
const otpVerifySchema = __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    token: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().uuid('Invalid link token'),
    otp: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().length(6, 'OTP must be 6 digits').regex(/^\d+$/, 'OTP must contain only digits')
});
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB Total
const ACCEPTED_FILE_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'image/png',
    'image/jpeg',
    'application/pdf',
    'text/plain'
];
const fileSchema = __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    size: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().max(MAX_FILE_SIZE, 'File size must be less than 15MB'),
    type: __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        ACCEPTED_FILE_TYPES[0],
        ...ACCEPTED_FILE_TYPES.slice(1)
    ], {
        message: 'Invalid file type. Allowed: Excel, CSV, Images, PDF, Text'
    })
});
const SharePurposeSchema = __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
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
}),
"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/actions/create-link-with-files.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* __next_internal_action_entry_do_not_use__ [{"408866afce838797a2a07b2b65b218f26b9d6eb8f5":"createSecureLinkWithFiles"},"",""] */ __turbopack_context__.s([
    "createSecureLinkWithFiles",
    ()=>createSecureLinkWithFiles
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/next/dist/build/webpack/loaders/next-flight-loader/server-reference.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/lib/prisma.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/lib/crypto.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$validations$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/lib/validations.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js [app-rsc] (ecmascript)");
;
;
;
;
async function createSecureLinkWithFiles(formData) {
    try {
        // 1. Extract and Validate Text Data
        const rawData = {
            firstName: formData.get('firstName'),
            lastName: formData.get('lastName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            gender: formData.get('gender'),
            age: Number(formData.get('age')),
            validityMinutes: Number(formData.get('validityMinutes'))
        };
        // V2.1: Extract purpose and notification fields
        const purpose = formData.get('purpose');
        const purposeDetail = formData.get('purposeDetail');
        const notificationEmail = formData.get('notificationEmail');
        const validatedData = __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$validations$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["userDataSchema"].safeParse(rawData);
        if (!validatedData.success) {
            return {
                success: false,
                error: validatedData.error.issues[0]?.message || 'Invalid input data'
            };
        }
        // 2. Extract and Process Files
        const files = [];
        const fileEntries = formData.getAll('files');
        for (const entry of fileEntries){
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
                error: `Too many files. Maximum ${MAX_FILES} files allowed (you selected ${files.length}).`
            };
        }
        const totalSize = files.reduce((sum, f)=>sum + f.size, 0);
        if (totalSize > MAX_TOTAL_SIZE) {
            return {
                success: false,
                error: `Total file size exceeds 100MB limit (${(totalSize / 1024 / 1024).toFixed(1)}MB selected).`
            };
        }
        // Validate all files first (fast check)
        for (const file of files){
            const validation = __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$validations$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["fileSchema"].safeParse({
                size: file.size,
                type: file.type
            });
            if (!validation.success) {
                return {
                    success: false,
                    error: `File ${file.name}: ${validation.error.issues[0]?.message}`
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
            age
        };
        // 4. Generate Security Artifacts - PARALLELIZE crypto operations
        const token = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["generateSecureToken"])();
        const ownerToken = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["generateOwnerToken"])();
        const otp = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["generateOTP"])();
        const expiresAt = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["calculateExpiry"])(validityMinutes);
        // Run OTP hashing, user data encryption, and file encryption IN PARALLEL
        const [otpHash, encryptedUserData, dataHash, encryptedFiles] = await Promise.all([
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["hashOTP"])(otp),
            Promise.resolve((0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["encryptData"])(userData)),
            Promise.resolve((0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["generateDataHash"])(userData)),
            Promise.all(files.map(async (file)=>{
                const buffer = Buffer.from(await file.arrayBuffer());
                const { iv, authTag, encryptedContent } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$crypto$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["encryptBuffer"])(buffer);
                return {
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: file.size,
                    encryptedContent,
                    iv,
                    authTag
                };
            }))
        ]);
        // 5. Database Transaction - Optimized with shorter timeout
        const result = await __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["prisma"].$transaction(async (tx)=>{
            // Create UserData Record
            const userDataRecord = await tx.userData.create({
                data: {
                    encryptedData: encryptedUserData,
                    dataHash
                }
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
                        create: encryptedFiles
                    }
                }
            });
            return secureLink;
        }, {
            maxWait: 5000,
            timeout: 60000 // Reduced from 5min - most operations should complete quickly
        });
        // Audit log AFTER transaction (non-blocking, fire-and-forget for speed)
        __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$lib$2f$prisma$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["prisma"].auditLog.create({
            data: {
                action: 'CREATED',
                linkId: result.id,
                metadata: JSON.stringify({
                    fileCount: files.length,
                    purpose: purpose || undefined,
                    hasNotifications: !!notificationEmail
                })
            }
        }).catch((err)=>console.warn('[AUDIT] Failed to log:', err.message));
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
            purpose: purpose || undefined
        };
    } catch (error) {
        console.error('Error creating secure link:', error instanceof Error ? error.message : 'Unknown error');
        return {
            success: false,
            error: 'Failed to create secure link. Please try again.'
        };
    }
}
;
(0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ensureServerEntryExports"])([
    createSecureLinkWithFiles
]);
(0, __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerServerReference"])(createSecureLinkWithFiles, "408866afce838797a2a07b2b65b218f26b9d6eb8f5", null);
}),
"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/.next-internal/server/app/signup/page/actions.js { ACTIONS_MODULE0 => \"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/actions/create-link-with-files.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$actions$2f$create$2d$link$2d$with$2d$files$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/actions/create-link-with-files.ts [app-rsc] (ecmascript)");
;
}),
"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/.next-internal/server/app/signup/page/actions.js { ACTIONS_MODULE0 => \"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/actions/create-link-with-files.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "408866afce838797a2a07b2b65b218f26b9d6eb8f5",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$actions$2f$create$2d$link$2d$with$2d$files$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createSecureLinkWithFiles"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f2e$next$2d$internal$2f$server$2f$app$2f$signup$2f$page$2f$actions$2e$js__$7b$__ACTIONS_MODULE0__$3d3e$__$225b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$actions$2f$create$2d$link$2d$with$2d$files$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$2922$__$7d$__$5b$app$2d$rsc$5d$__$28$server__actions__loader$2c$__ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i('[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/.next-internal/server/app/signup/page/actions.js { ACTIONS_MODULE0 => "[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/actions/create-link-with-files.ts [app-rsc] (ecmascript)" } [app-rsc] (server actions loader, ecmascript) <locals>');
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$src$2f$actions$2f$create$2d$link$2d$with$2d$files$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/actions/create-link-with-files.ts [app-rsc] (ecmascript)");
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__21f4dafa._.js.map