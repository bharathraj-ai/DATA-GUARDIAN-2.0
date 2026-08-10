export default function RevokeLoading() {
    return (
        <main
            className="revoke-wrapper"
            style={{
                background: 'linear-gradient(145deg, #F8FAFC 0%, #EFF6FF 50%, #F1F5F9 100%)',
                minHeight: '100vh',
            }}
        >
            <div
                className="revoke-card"
                style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '28px',
                    padding: '40px',
                    maxWidth: '560px',
                    width: '100%',
                    margin: '0 auto',
                }}
            >
                <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                    <div
                        className="skeleton skeleton-circle"
                        style={{ width: '64px', height: '64px', margin: '0 auto 16px' }}
                    />
                    <div
                        className="skeleton skeleton-text-lg"
                        style={{ width: '55%', margin: '0 auto 10px' }}
                    />
                    <div
                        className="skeleton skeleton-text-sm"
                        style={{ width: '40%', margin: '0 auto' }}
                    />
                </div>
                <div
                    style={{
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        borderRadius: '18px',
                        padding: '24px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                    }}
                >
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <div className="skeleton skeleton-text-sm" style={{ width: '30%' }} />
                            <div className="skeleton skeleton-text-sm" style={{ width: '40%' }} />
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
