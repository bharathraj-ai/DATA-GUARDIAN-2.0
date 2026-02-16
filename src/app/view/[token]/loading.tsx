export default function ViewLoading() {
    return (
        <main style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--darker-bg)',
        }}>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '20px',
            }}>
                <div style={{
                    width: '48px',
                    height: '48px',
                    border: '3px solid rgba(14, 165, 233, 0.15)',
                    borderTopColor: 'var(--primary-blue)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                }} />
                <p style={{
                    color: 'var(--text-muted)',
                    fontSize: '14px',
                    fontWeight: '500',
                }}>Decrypting secure data...</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        </main>
    );
}
