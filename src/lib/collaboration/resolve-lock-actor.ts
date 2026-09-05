import { clampPriority, displayNameFromEmail } from './priority';
import type { LockActor } from './edit-lock-types';

export function sanitizeClientInstanceId(raw: unknown, fallbackSessionId: string): string {
    if (typeof raw !== 'string') return fallbackSessionId;
    const trimmed = raw.trim().slice(0, 80);
    if (!trimmed || !/^[\w.:-]+$/.test(trimmed)) return fallbackSessionId;
    return trimmed;
}

type VendorRow = { id?: string; email: string; level?: number };

export function resolveLockActor(input: {
    sessionId: string;
    effectiveEmail: string | null;
    level?: number | null;
    isOwner: boolean;
    token: string;
    ownerId?: string | null;
    vendors?: VendorRow[];
    clientInstanceId?: unknown;
    displayName?: string | null;
}): LockActor | null {
    const email = input.effectiveEmail?.trim().toLowerCase()
        || (input.isOwner && input.ownerId ? `owner:${input.ownerId}` : null);
    if (!email) return null;

    const vendor = input.vendors?.find((v) => v.email.trim().toLowerCase() === email);
    const priority = input.isOwner ? 1 : clampPriority(vendor?.level ?? input.level ?? 2);
    const clientInstanceId = sanitizeClientInstanceId(input.clientInstanceId, input.sessionId);

    return {
        userId: email,
        userName: (input.displayName && input.displayName.trim().slice(0, 64))
            || displayNameFromEmail(email, input.isOwner ? 'Owner' : 'Collaborator'),
        teamId: vendor?.id || (input.isOwner ? `owner:${input.ownerId}` : `vendor:${email}`),
        priority,
        sessionId: input.sessionId,
        clientInstanceId,
        token: input.token,
        isOwner: input.isOwner,
    };
}
