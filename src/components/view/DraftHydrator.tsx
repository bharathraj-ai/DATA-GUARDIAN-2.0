'use client';

import { useEffect } from 'react';

/**
 * Hydrates saved vendor draft and resume point onto the window object
 * so editor components can pick them up on mount.
 */
export function DraftHydrator({ lastSavedWork, resumePoint }: {
    lastSavedWork?: any;
    resumePoint?: any;
}) {
    useEffect(() => {
        if (lastSavedWork) {
            (window as any).__VENDOR_DRAFT__ = lastSavedWork;
        }
        if (resumePoint) {
            (window as any).__VENDOR_RESUME_POINT__ = resumePoint;
        }

        return () => {
            delete (window as any).__VENDOR_DRAFT__;
            delete (window as any).__VENDOR_RESUME_POINT__;
        };
    }, [lastSavedWork, resumePoint]);

    return null;
}
