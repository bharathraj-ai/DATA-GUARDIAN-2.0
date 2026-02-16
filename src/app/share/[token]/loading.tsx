export default function ShareLoading() {
    return (
        <main className="otp-wrapper">
            <div className="otp-card">
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '40px 0',
                }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        border: '3px solid rgba(14, 165, 233, 0.15)',
                        borderTopColor: 'var(--primary-blue)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                    <p style={{
                        color: 'var(--text-muted)',
                        fontSize: '14px',
                    }}>Loading secure page...</p>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        </main>
    );
}
