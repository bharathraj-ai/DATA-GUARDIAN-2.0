'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { setUserRole } from '@/actions/set-role';
import { Session } from 'next-auth';
import { ArrowRight, KeyRound, Link2, Shield } from 'lucide-react';
import styles from './role-select.module.css';

interface RoleSelectClientProps {
    callbackUrl: string | null;
    session: Session | null;
}

export default function RoleSelectClient({ callbackUrl, session }: RoleSelectClientProps) {
    const router = useRouter();
    const { update } = useSession();
    const [isLoading, setIsLoading] = useState(false);
    const [selected, setSelected] = useState<'OWNER' | 'VENDOR' | null>(null);
    const [error, setError] = useState('');

    const destinationForRole = (role: string | undefined) => {
        if (role === 'OWNER' && callbackUrl) return callbackUrl;
        if (role === 'OWNER') return '/dashboard/owner';
        return '/dashboard/vendor';
    };

    const commitRole = async (role: 'OWNER' | 'VENDOR') => {
        setIsLoading(true);
        setError('');
        setSelected(role);

        try {
            const result = await setUserRole(role);

            if (result.success) {
                await update({
                    role,
                    roleSelected: true,
                    onboardingStep: 'COMPLETE',
                });
                router.replace(destinationForRole(role));
            } else if (result.error === 'Role has already been selected') {
                await update({ roleSelected: true, onboardingStep: 'COMPLETE' });
                router.replace(destinationForRole(session?.user?.role ?? role));
            } else {
                setError(result.error || 'Failed to set role');
                setSelected(null);
            }
        } catch {
            setError('Something went wrong. Please try again.');
            setSelected(null);
        } finally {
            setIsLoading(false);
        }
    };

    const firstName = session?.user?.name?.split(' ')[0];

    return (
        <main className={styles.page}>
            <div className={styles.wrap}>
                <header className={styles.head}>
                    <div className={styles.kicker}>First session</div>
                    <h1 className={styles.title}>
                        {firstName ? `${firstName}, where do you sit in the protocol?` : 'Where do you sit in the protocol?'}
                    </h1>
                    <p className={styles.sub}>
                        Owner issues the encrypted share. Vendor receives it. Pick one — it stays with this account.
                    </p>
                    {error ? <p className={styles.error}>{error}</p> : null}
                </header>

                <div className={styles.stage}>
                    <button
                        type="button"
                        className={`${styles.node} ${selected === 'OWNER' ? styles.on : ''} ${selected === 'VENDOR' ? styles.off : ''}`}
                        onClick={() => setSelected('OWNER')}
                        disabled={isLoading}
                    >
                        <div className={styles.console}>
                            <div className={styles.chrome}>
                                <span className={styles.dot} />
                                <span className={styles.dot} />
                                <span className={styles.dot} />
                                <span className={styles.chromeLabel}>Issue console</span>
                            </div>
                            <div className={styles.body}>
                                <div className={`${styles.art} ${styles.ownerArt}`}>
                                    <Shield size={32} strokeWidth={1.8} />
                                </div>
                                <span className={styles.role}>Owner</span>
                                <span className={styles.blurb}>
                                    You hold the vault. Create the link, set expiry, and revoke the moment you need to.
                                </span>
                                <ul className={styles.facts}>
                                    <li><span className={`${styles.tick} ${styles.ownerTick}`}>✓</span> Encrypt and share files</li>
                                    <li><span className={`${styles.tick} ${styles.ownerTick}`}>✓</span> Expiry by time, days, or months</li>
                                    <li><span className={`${styles.tick} ${styles.ownerTick}`}>✓</span> Live monitor and kill-switch</li>
                                </ul>
                            </div>
                        </div>
                    </button>

                    <div className={styles.bridge} aria-hidden="true">
                        <span className={styles.bridgeLabel}>Secure link</span>
                        <div className={styles.line} />
                        <div className={styles.token}>
                            <Link2 size={18} />
                        </div>
                        <div className={styles.token}>
                            <KeyRound size={18} />
                        </div>
                        <span className={styles.bridgeLabel}>OTP gate</span>
                    </div>

                    <button
                        type="button"
                        className={`${styles.node} ${selected === 'VENDOR' ? styles.on : ''} ${selected === 'OWNER' ? styles.off : ''}`}
                        onClick={() => setSelected('VENDOR')}
                        disabled={isLoading}
                    >
                        <div className={styles.console}>
                            <div className={styles.chrome}>
                                <span className={styles.dot} />
                                <span className={styles.dot} />
                                <span className={styles.dot} />
                                <span className={styles.chromeLabel}>Receive console</span>
                            </div>
                            <div className={styles.body}>
                                <div className={`${styles.art} ${styles.vendorArt}`}>
                                    <KeyRound size={32} strokeWidth={1.8} />
                                </div>
                                <span className={styles.role}>Vendor</span>
                                <span className={styles.blurb}>
                                    You enter with OTP. Work inside a locked session — the file never walks out on its own.
                                </span>
                                <ul className={styles.facts}>
                                    <li><span className={`${styles.tick} ${styles.vendorTick}`}>✓</span> OTP-protected access</li>
                                    <li><span className={`${styles.tick} ${styles.vendorTick}`}>✓</span> Secure viewer and editor</li>
                                    <li><span className={`${styles.tick} ${styles.vendorTick}`}>✓</span> Break, resume, complete work</li>
                                </ul>
                            </div>
                        </div>
                    </button>
                </div>

                <div className={styles.foot}>
                    {selected ? (
                        <>
                            <p>
                                Selected <strong>{selected === 'OWNER' ? 'Owner' : 'Vendor'}</strong>. This identity is
                                permanent for this Google account.
                            </p>
                            <button
                                type="button"
                                className={`${styles.go} ${selected === 'VENDOR' ? styles.goVendor : ''}`}
                                onClick={() => commitRole(selected)}
                                disabled={isLoading}
                            >
                                {isLoading ? 'Assigning…' : `Continue as ${selected === 'OWNER' ? 'Owner' : 'Vendor'}`}
                                {!isLoading && <ArrowRight size={16} />}
                            </button>
                        </>
                    ) : (
                        <p>Click Owner or Vendor above, then confirm. You only do this once.</p>
                    )}
                </div>
            </div>
        </main>
    );
}
