export default function ViewLoading() {
    return (
        <main
            className="profile-wrapper"
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 24px',
                background: 'linear-gradient(145deg, #F8FAFC 0%, #EFF6FF 50%, #F1F5F9 100%)',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '20px',
                    background: '#FFFFFF',
                    border: '1px solid rgba(226, 232, 240, 0.8)',
                    borderRadius: '24px',
                    padding: '48px 56px',
                    boxShadow: '0 10px 40px rgba(15, 23, 42, 0.06)',
                }}
            >
                <div
                    style={{
                        width: '48px',
                        height: '48px',
                        border: '3px solid rgba(99, 102, 241, 0.15)',
                        borderTopColor: '#6366f1',
                        borderRadius: '50%',
                        animation: 'view-spin 0.8s linear infinite',
                    }}
                />
                <p
                    style={{
                        color: '#64748b',
                        fontSize: '14px',
                        fontWeight: 500,
                        margin: 0,
                    }}
                >
                    Loading secure view…
                </p>
                <style>{`@keyframes view-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        </main>
    );
}
