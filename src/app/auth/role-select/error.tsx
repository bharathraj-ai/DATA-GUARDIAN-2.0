'use client';

export default function RoleSelectError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <main className="app-page">
            <section className="app-section">
                <div className="container" style={{ textAlign: 'center', padding: '80px 16px' }}>
                    <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Couldn’t load role selection</h1>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                        Please try again. If this keeps happening, refresh the page.
                    </p>
                    <button type="button" className="btn btn-primary" onClick={() => reset()}>
                        Try again
                    </button>
                </div>
            </section>
        </main>
    );
}
