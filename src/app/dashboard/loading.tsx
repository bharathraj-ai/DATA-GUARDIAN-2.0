export default function DashboardLoading() {
    return (
        <main className="app-page" style={{ alignItems: 'flex-start' }}>
            <section className="app-section">
                <div className="container">
                    <div className="app-container" style={{ maxWidth: '960px' }}>

                        {/* Skeleton Header */}
                        <div className="app-header" style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'center' }}>
                            <div className="skeleton skeleton-circle" style={{ width: '48px', height: '48px', flexShrink: 0 }} />
                            <div style={{ flex: 1, maxWidth: '280px' }}>
                                <div className="skeleton skeleton-text-lg" style={{ width: '70%', marginBottom: '10px' }} />
                                <div className="skeleton skeleton-text-sm" style={{ width: '45%' }} />
                            </div>
                        </div>

                        {/* Skeleton Stats Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="skeleton-card">
                                    <div className="skeleton skeleton-text-lg" style={{ width: '50%', marginBottom: '12px' }} />
                                    <div className="skeleton skeleton-text-sm" style={{ width: '70%' }} />
                                </div>
                            ))}
                        </div>

                        {/* Skeleton Tab Bar */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                            <div className="skeleton" style={{ width: '100px', height: '40px', borderRadius: '10px' }} />
                            <div className="skeleton" style={{ width: '100px', height: '40px', borderRadius: '10px' }} />
                        </div>

                        {/* Skeleton Link Cards */}
                        <div className="app-form-card">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {[1, 2, 3].map((i) => (
                                    <div key={i} style={{ padding: '20px', borderRadius: '16px', background: 'rgba(15, 23, 42, 0.5)', border: '1px solid var(--border-color)' }}>
                                        <div className="skeleton-row" style={{ marginBottom: '16px' }}>
                                            <div className="skeleton skeleton-circle" style={{ width: '40px', height: '40px', flexShrink: 0 }} />
                                            <div style={{ flex: 1 }}>
                                                <div className="skeleton skeleton-text" style={{ width: '60%', marginBottom: '8px' }} />
                                                <div className="skeleton skeleton-text-sm" style={{ width: '40%' }} />
                                            </div>
                                            <div className="skeleton" style={{ width: '72px', height: '28px', borderRadius: '14px' }} />
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <div className="skeleton skeleton-text-sm" style={{ width: '120px' }} />
                                            <div className="skeleton skeleton-text-sm" style={{ width: '90px' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            </section>
        </main>
    );
}
