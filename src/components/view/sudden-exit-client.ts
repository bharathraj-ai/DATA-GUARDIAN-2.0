const INTERNAL_NAV_KEY = 'dg:internal-nav';
const WORK_COMPLETED_KEY = 'dg:work-completed';

/** Call when work has been successfully completed and delivered to the owner. */
export function markWorkCompleted() {
    try {
        sessionStorage.setItem(WORK_COMPLETED_KEY, '1');
    } catch {
        /* ignore */
    }
    if (typeof window !== 'undefined') {
        (window as Window & { __DG_WORK_COMPLETED__?: boolean }).__DG_WORK_COMPLETED__ = true;
    }
}

/** Check if the session is finished because work was marked completed. */
export function isWorkCompleted(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        if (sessionStorage.getItem(WORK_COMPLETED_KEY) === '1') return true;
    } catch {
        /* ignore */
    }
    const w = window as Window & { __DG_WORK_COMPLETED__?: boolean };
    return Boolean(w.__DG_WORK_COMPLETED__);
}

/** Check if any internal navigation or legitimate session transition is currently active. */
export function isInternalNavigationActive(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        if (sessionStorage.getItem(INTERNAL_NAV_KEY) === '1') return true;
        if (sessionStorage.getItem(WORK_COMPLETED_KEY) === '1') return true;
        if (sessionStorage.getItem('dg:post-break-redirect') === '1') return true;
    } catch {
        /* ignore */
    }
    const w = window as Window & {
        __DG_INTERNAL_NAV__?: boolean;
        __DG_WORK_COMPLETED__?: boolean;
        __DG_RELOAD__?: boolean;
    };
    return Boolean(w.__DG_INTERNAL_NAV__ || w.__DG_WORK_COMPLETED__ || w.__DG_RELOAD__);
}

/** Call before in-app moves (view ↔ editor, take break, complete work) so OTP is not rotated. */
export function markInternalNavigation() {
    try {
        sessionStorage.setItem(INTERNAL_NAV_KEY, '1');
    } catch {
        /* ignore */
    }
    if (typeof window !== 'undefined') {
        (window as Window & { __DG_INTERNAL_NAV__?: boolean }).__DG_INTERNAL_NAV__ = true;
    }
}

export function consumeInternalNavigation(): boolean {
    let flagged = false;
    try {
        flagged = sessionStorage.getItem(INTERNAL_NAV_KEY) === '1';
        sessionStorage.removeItem(INTERNAL_NAV_KEY);
    } catch {
        /* ignore */
    }
    if (typeof window !== 'undefined') {
        const w = window as Window & { __DG_INTERNAL_NAV__?: boolean };
        flagged = flagged || Boolean(w.__DG_INTERNAL_NAV__);
        w.__DG_INTERNAL_NAV__ = false;
    }
    return flagged;
}

export function markReloadShortcut() {
    if (typeof window !== 'undefined') {
        (window as Window & { __DG_RELOAD__?: boolean }).__DG_RELOAD__ = true;
    }
}

export function consumeReloadShortcut(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as Window & { __DG_RELOAD__?: boolean };
    const flagged = Boolean(w.__DG_RELOAD__);
    w.__DG_RELOAD__ = false;
    return flagged;
}

export function parseEditorFileIdFromPath(pathname: string, token: string): string | null {
    if (!pathname || !token) return null;
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] !== 'editor' || parts[1] !== token || !parts[2]) return null;
    return parts[2];
}

export function readEditClientInstanceId(fileId: string): string | undefined {
    try {
        return sessionStorage.getItem(`dg:edit-client:${fileId}`) || undefined;
    } catch {
        return undefined;
    }
}
