/**
 * Priority semantics (matches VendorAccess.level / DocumentSession.level):
 *   lower numeric value = higher authority
 *   Priority 1 > Priority 2 > Priority 3
 *
 * requestPriority < currentPriority  → requester may take over
 */

export function hasHigherPriority(requestPriority: number, currentPriority: number): boolean {
    return requestPriority < currentPriority;
}

export function hasEqualPriority(a: number, b: number): boolean {
    return a === b;
}

export function clampPriority(level: number | null | undefined): number {
    if (typeof level !== 'number' || !Number.isFinite(level)) return 2;
    return Math.min(10, Math.max(1, Math.trunc(level)));
}

export function displayNameFromEmail(email: string | null | undefined, fallback = 'Collaborator'): string {
    if (!email) return fallback;
    const local = email.split('@')[0]?.trim();
    return local || fallback;
}
