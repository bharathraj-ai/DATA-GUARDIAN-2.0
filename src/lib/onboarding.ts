import { normalizeRole, type AppRole } from '@/lib/security/role-helpers';

/**
 * Persistent onboarding state derived from User.roleSelected.
 * ROLE_SELECTION = new / incomplete; COMPLETE = finished role onboarding.
 */
export type OnboardingStep = 'ROLE_SELECTION' | 'COMPLETE';

export function getOnboardingStep(roleSelected: boolean | null | undefined): OnboardingStep {
    return roleSelected ? 'COMPLETE' : 'ROLE_SELECTION';
}

export function isOnboardingComplete(roleSelected: boolean | null | undefined): boolean {
    return getOnboardingStep(roleSelected) === 'COMPLETE';
}

/** Safe relative path for post-auth redirects (blocks open redirects). */
export function safeCallbackPath(raw: string | null | undefined): string | null {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
    // Never bounce auth router pages through themselves as destinations
    if (
        raw === '/auth/continue' ||
        raw.startsWith('/auth/continue?') ||
        raw === '/auth/signin' ||
        raw.startsWith('/auth/signin?') ||
        raw === '/auth/role-select' ||
        raw.startsWith('/auth/role-select?')
    ) {
        return null;
    }
    return raw;
}

export function dashboardPathForRole(role: string | null | undefined): string {
    return normalizeRole(role) === 'VENDOR' ? '/dashboard/vendor' : '/dashboard/owner';
}

/** `/dashboard` and role dashboards — skip the extra hop, go straight to role path. */
export function isDashboardEntryPath(path: string): boolean {
    return (
        path === '/dashboard' ||
        path.startsWith('/dashboard?') ||
        path === '/dashboard/owner' ||
        path.startsWith('/dashboard/owner?') ||
        path === '/dashboard/vendor' ||
        path.startsWith('/dashboard/vendor?')
    );
}

/**
 * Post-login destination after Google OAuth / session restore.
 * Completed users never land on role-select.
 */
export function resolvePostAuthRedirect(opts: {
    roleSelected: boolean;
    role: string | AppRole | null | undefined;
    callbackUrl?: string | null;
}): string {
    if (!isOnboardingComplete(opts.roleSelected)) {
        const cb = safeCallbackPath(opts.callbackUrl);
        return cb
            ? `/auth/role-select?callbackUrl=${encodeURIComponent(cb)}`
            : '/auth/role-select';
    }

    const cb = safeCallbackPath(opts.callbackUrl);
    if (cb && !isDashboardEntryPath(cb)) return cb;
    return dashboardPathForRole(opts.role);
}
