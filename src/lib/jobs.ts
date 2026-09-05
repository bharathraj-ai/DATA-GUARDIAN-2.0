/**
 * Durable Postgres job queue. Upstash Redis REST cannot host Bull/BullMQ;
 * Vercel `after()` is best-effort. Cron (`/api/cleanup`) drains this table.
 */
import 'server-only';

import { prisma } from '@/lib/prisma';
import { logger, redactEmail } from '@/lib/logger';

export type JobType = 'otp_email' | 'delete_blobs';

export type OtpEmailPayload = {
    email: string;
    token: string;
    otp: string;
    validityMinutes: number;
};

export type DeleteBlobsPayload = {
    keys: string[];
};

type JobPayload = OtpEmailPayload | DeleteBlobsPayload;

const BACKOFF_SECONDS = [15, 30, 60, 120, 300];

export async function enqueueJob(type: JobType, payload: JobPayload, runAfter?: Date): Promise<string> {
    const job = await prisma.job.create({
        data: {
            type,
            payload: payload as object,
            status: 'pending',
            runAfter: runAfter ?? new Date(),
        },
        select: { id: true },
    });
    return job.id;
}

export async function enqueueOtpEmails(
    vendors: Array<{ email: string; otp: string }>,
    token: string,
    validityMinutes: number,
): Promise<void> {
    if (vendors.length === 0) return;
    await Promise.all(
        vendors.map((v) =>
            enqueueJob('otp_email', {
                email: v.email,
                token,
                otp: v.otp,
                validityMinutes,
            }),
        ),
    );
}

async function handleJob(type: string, payload: unknown): Promise<void> {
    if (type === 'otp_email') {
        const data = payload as OtpEmailPayload;
        const { sendOTPEmail, isEmailConfigured } = await import('@/lib/email');
        if (!isEmailConfigured()) {
            throw new Error('Email is not configured');
        }
        await sendOTPEmail(data.email, data.token, data.otp, data.validityMinutes);
        logger.info(`Queued OTP sent to ${redactEmail(data.email)}`);
        return;
    }

    if (type === 'delete_blobs') {
        const data = payload as DeleteBlobsPayload;
        const { deleteCiphertexts } = await import('@/lib/blob-store');
        await deleteCiphertexts(data.keys ?? []);
        return;
    }

    throw new Error(`Unknown job type: ${type}`);
}

export async function processDueJobs(limit = 15): Promise<{ processed: number; failed: number }> {
    const due = await prisma.job.findMany({
        where: {
            status: 'pending',
            runAfter: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
            id: true,
            type: true,
            payload: true,
            attempts: true,
            maxAttempts: true,
        },
    });

    let processed = 0;
    let failed = 0;

    for (const job of due) {
        const claimed = await prisma.job.updateMany({
            where: { id: job.id, status: 'pending' },
            data: { status: 'processing', attempts: { increment: 1 } },
        });
        if (claimed.count === 0) continue;

        try {
            await handleJob(job.type, job.payload);
            await prisma.job.update({
                where: { id: job.id },
                data: { status: 'done', lastError: null },
            });
            processed += 1;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Job failed';
            const attempts = job.attempts + 1;
            const giveUp = attempts >= job.maxAttempts;
            const delaySec = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
            await prisma.job.update({
                where: { id: job.id },
                data: {
                    status: giveUp ? 'failed' : 'pending',
                    lastError: message.slice(0, 500),
                    runAfter: giveUp ? new Date() : new Date(Date.now() + delaySec * 1000),
                },
            });
            failed += 1;
            logger.warn(`Job ${job.type} ${giveUp ? 'failed' : 'retry'}`, { attempts, message });
        }
    }

    return { processed, failed };
}
