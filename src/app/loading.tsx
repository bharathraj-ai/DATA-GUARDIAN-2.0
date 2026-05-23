export default function Loading() {
    return (
        <main style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#FFFFFF', // Light enterprise theme background
        }}>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '24px',
            }}>
                {/* Lottie-style SVG Animation Container */}
                <div className="lottie-loader">
                    <svg width="80" height="80" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                        {/* Background Shield */}
                        <rect className="lottie-shield" width="40" height="40" rx="10" fill="#111111" />
                        
                        {/* "D" Shape - Path drawing animation */}
                        <path className="lottie-path-d" d="M13 10H19C24.5228 10 29 14.4772 29 20C29 25.5228 24.5228 30 19 30H13V10Z" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        
                        {/* "G" Shape - Path drawing animation */}
                        <path className="lottie-path-g" d="M25 15C23.6845 12.5674 20.5163 10.5 17.5 10.5C12.2533 10.5 8 14.7533 8 20C8 25.2467 12.2533 29.5 17.5 29.5C22.7467 29.5 27 25.2467 27 20H19.5" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        
                        {/* Data Node - Fade in animation */}
                        <circle className="lottie-node" cx="27" cy="20" r="2.5" fill="#38BDF8"/>
                    </svg>
                </div>

                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px'
                }}>
                    <h2 className="loading-title">Data Guardian</h2>
                    <div className="loading-bar-container">
                        <div className="loading-bar-progress"></div>
                    </div>
                </div>

                <style>{`
                    /* Lottie Container Pulsing */
                    .lottie-loader {
                        animation: lottiePulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                    }
                    @keyframes lottiePulse {
                        0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(17, 17, 17, 0); }
                        50% { transform: scale(1.05); box-shadow: 0 10px 30px -10px rgba(17, 17, 17, 0.3); }
                    }

                    /* Shield Background Fade */
                    .lottie-shield {
                        animation: shieldFade 2s ease-in-out infinite alternate;
                    }
                    @keyframes shieldFade {
                        0% { fill: #111111; }
                        100% { fill: #1E293B; }
                    }

                    /* Path Drawing "D" */
                    .lottie-path-d {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: drawD 2.5s ease-in-out infinite alternate;
                    }
                    @keyframes drawD {
                        0% { stroke-dashoffset: 100; opacity: 0; }
                        10% { opacity: 1; }
                        100% { stroke-dashoffset: 0; opacity: 1; }
                    }

                    /* Path Drawing "G" */
                    .lottie-path-g {
                        stroke-dasharray: 100;
                        stroke-dashoffset: 100;
                        animation: drawG 2.5s ease-in-out infinite alternate;
                        animation-delay: 0.5s;
                    }
                    @keyframes drawG {
                        0% { stroke-dashoffset: 100; opacity: 0; }
                        10% { opacity: 1; }
                        100% { stroke-dashoffset: 0; opacity: 1; }
                    }

                    /* Node Fade */
                    .lottie-node {
                        animation: nodePulse 2s ease-in-out infinite;
                    }
                    @keyframes nodePulse {
                        0%, 100% { opacity: 0.2; transform: scale(0.8); transform-origin: center; }
                        50% { opacity: 1; transform: scale(1.2); transform-origin: center; box-shadow: 0 0 10px #38BDF8; }
                    }

                    /* Text Loading */
                    .loading-title {
                        color: #111111;
                        font-size: 16px;
                        font-weight: 700;
                        letter-spacing: -0.01em;
                        margin: 0;
                        background: linear-gradient(90deg, #111111, #4B5563, #111111);
                        background-size: 200% auto;
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        animation: textShine 2s linear infinite;
                    }
                    @keyframes textShine {
                        to { background-position: 200% center; }
                    }

                    /* Sleek Loading Bar */
                    .loading-bar-container {
                        width: 120px;
                        height: 4px;
                        background: #F1F5F9;
                        border-radius: 4px;
                        overflow: hidden;
                        position: relative;
                    }
                    .loading-bar-progress {
                        position: absolute;
                        top: 0;
                        left: 0;
                        height: 100%;
                        width: 40%;
                        background: #38BDF8;
                        border-radius: 4px;
                        animation: barSlide 1.5s ease-in-out infinite;
                    }
                    @keyframes barSlide {
                        0% { left: -40%; width: 40%; }
                        50% { left: 20%; width: 60%; }
                        100% { left: 100%; width: 40%; }
                    }
                `}</style>
            </div>
        </main>
    );
}
