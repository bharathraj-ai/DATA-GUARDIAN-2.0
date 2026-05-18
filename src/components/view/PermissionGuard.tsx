'use client';

import React from 'react';
import { useCollaborationStore, CapabilityFlags } from '@/store/useCollaborationStore';

interface PermissionGuardProps {
    /** Which capability flag to check */
    requiredCapability: keyof CapabilityFlags;
    /** Content to render when authorized */
    children: React.ReactNode;
    /** Optional fallback when denied (defaults to nothing) */
    fallback?: React.ReactNode;
}

/**
 * Declarative guard that renders children only if the server-granted
 * capability flag is true. The flag is set by the backend policy engine —
 * the client never computes access logic.
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
    requiredCapability,
    children,
    fallback = null,
}) => {
    const capabilities = useCollaborationStore((s) => s.capabilities);
    return capabilities[requiredCapability] ? <>{children}</> : <>{fallback}</>;
};
