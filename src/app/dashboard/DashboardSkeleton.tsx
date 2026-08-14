export default function DashboardSkeleton() {
    return (
        <main className="app-page">
            <section className="app-section">
                <div className="container">
                    <div className="app-container" style={{ maxWidth: 960 }}>
                        <div className="dashboard-header-container">
                            <div className="dashboard-profile">
                                <div className="dashboard-avatar" style={{ opacity: 0.35 }} />
                                <div className="dashboard-title-group">
                                    <div style={{ height: 28, width: 220, borderRadius: 8, background: '#e5e7eb' }} />
                                    <div style={{ height: 14, width: 160, borderRadius: 6, background: '#f3f4f6', marginTop: 8 }} />
                                </div>
                            </div>
                        </div>
                        <div className="stats-container-grid">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="stat-card-premium" style={{ minHeight: 88 }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: '#f3f4f6' }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ height: 22, width: 40, borderRadius: 6, background: '#e5e7eb' }} />
                                        <div style={{ height: 10, width: 72, borderRadius: 4, background: '#f3f4f6', marginTop: 8 }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Loading dashboard…</p>
                    </div>
                </div>
            </section>
        </main>
    );
}
