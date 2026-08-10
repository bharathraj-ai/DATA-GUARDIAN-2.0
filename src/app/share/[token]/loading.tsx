export default function ShareLoading() {
    return (
        <main
            className="otp-wrapper"
            style={{
                minHeight: '100vh',
                background: 'linear-gradient(145deg, #F8FAFC 0%, #EFF6FF 50%, #F1F5F9 100%)',
            }}
        >
            <div className="otp-card">
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '16px',
                        padding: '40px 0',
                    }}
                >
                    <div
                        style={{
                            width: '40px',
                            height: '40px',
                            border: '3px solid rgba(99, 102, 241, 0.15)',
                            borderTopColor: '#6366f1',
                            borderRadius: '50%',
                            animation: 'share-spin 0.8s linear infinite',
                        }}
                    />
                    <p
                        style={{
                            color: '#64748b',
                            fontSize: '14px',
                            margin: 0,
                        }}
                    >
                        Loading secure page…
                    </p>
                    <style>{`@keyframes share-spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            </div>
        </main>
    );
}
