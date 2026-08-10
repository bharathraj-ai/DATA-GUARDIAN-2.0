export default function CreateLinkLoading() {
    return (
        <main
            className="app-page"
            style={{ background: '#FFFFFF', animation: 'none', minHeight: '100vh', alignItems: 'flex-start' }}
        >
            <section className="app-section">
                <div className="container">
                    <div className="app-container" style={{ maxWidth: '720px' }}>
                        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                            <div
                                className="skeleton skeleton-text-lg"
                                style={{ width: '60%', margin: '0 auto 12px' }}
                            />
                            <div
                                className="skeleton skeleton-text-sm"
                                style={{ width: '40%', margin: '0 auto' }}
                            />
                        </div>
                        <div className="app-form-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i}>
                                    <div
                                        className="skeleton skeleton-text-sm"
                                        style={{ width: '30%', marginBottom: '8px' }}
                                    />
                                    <div className="skeleton" style={{ width: '100%', height: '44px' }} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
