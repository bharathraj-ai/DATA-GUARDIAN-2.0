'use client';

import { useEffect, useState } from 'react';

/**
 * First-paint splash owned entirely by React (className via state).
 * Never call DOM.remove() on this node — that races React reconciliation.
 */
export default function BootSplash() {
    const [hidden, setHidden] = useState(false);

    useEffect(() => {
        setHidden(true);
    }, []);

    return (
        <div
            id="dg-boot-loader"
            className={hidden ? 'dg-boot-loader-hide' : undefined}
            aria-busy={!hidden}
            aria-hidden={hidden}
            aria-label="Loading Data Guardian"
        >
            <div className="dg-boot-inner">
                <div className="dg-boot-logo">
                    <svg width="80" height="80" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="40" height="40" rx="10" fill="#111111" />
                        <path
                            d="M13 10H19C24.5228 10 29 14.4772 29 20C29 25.5228 24.5228 30 19 30H13V10Z"
                            stroke="white"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d="M25 15C23.6845 12.5674 20.5163 10.5 17.5 10.5C12.2533 10.5 8 14.7533 8 20C8 25.2467 12.2533 29.5 17.5 29.5C22.7467 29.5 27 25.2467 27 20H19.5"
                            stroke="#38BDF8"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <circle cx="27" cy="20" r="2.5" fill="#38BDF8" />
                    </svg>
                </div>
                <div className="dg-boot-title">Data Guardian</div>
                <div className="dg-boot-bar">
                    <div className="dg-boot-bar-fill" />
                </div>
            </div>
        </div>
    );
}
