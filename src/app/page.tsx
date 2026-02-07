import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="landing-page">
      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-background">
          <div className="hero-grid"></div>
          <div className="hero-glow hero-glow-1"></div>
          <div className="hero-glow hero-glow-2"></div>
        </div>

        <div className="container">
          <div className="hero-content">
            {/* Logo/Brand */}
            <div className="brand-badge">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>Data Guardian</span>
            </div>

            {/* Main Heading */}
            <h1 className="hero-title">
              Secure Data Sharing
              <br />
              <span className="gradient-text">Made Simple</span>
            </h1>

            <p className="hero-subtitle">
              Share sensitive information with time-limited, encrypted links.
              <br />
              Complete control. Zero compromise.
            </p>

            {/* CTA Buttons */}
            <div className="hero-cta">
              <Link href="/how-it-works" className="btn btn-primary btn-large">
                <span>Get Started</span>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Link>
              <Link href="/services" className="btn btn-secondary btn-large">
                <span>View Features</span>
              </Link>
            </div>

            {/* Trust Indicators */}
            <div className="trust-badges">
              <div className="trust-badge">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                </svg>
                <span>End-to-End Encrypted</span>
              </div>
              <div className="trust-badge">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
                </svg>
                <span>Self-Destructing Links</span>
              </div>
              <div className="trust-badge">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM8 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm.256 7a4.474 4.474 0 0 1-.229-1.004H3c.001-.246.154-.986.832-1.664C4.484 10.68 5.711 10 8 10c.26 0 .507.009.74.025.226-.341.496-.65.804-.918C9.077 9.038 8.564 9 8 9c-5 0-6 3-6 4s1 1 1 1h5.256Z"/>
                  <path d="M16 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Zm-1.993-1.679a.5.5 0 0 0-.686.172l-1.17 1.95-.547-.547a.5.5 0 0 0-.708.708l.774.773a.75.75 0 0 0 1.174-.144l1.335-2.226a.5.5 0 0 0-.172-.686Z"/>
                </svg>
                <span>OTP Protected</span>
              </div>
            </div>
          </div>

          {/* Hero Visual */}
          <div className="hero-visual">
            <div className="visual-card visual-card-main">
              <div className="visual-card-header">
                <div className="visual-dot"></div>
                <div className="visual-dot"></div>
                <div className="visual-dot"></div>
              </div>
              <div className="visual-card-content">
                <div className="visual-lock">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                </div>
                <div className="visual-text">Secure Link Generated</div>
                <div className="visual-timer">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
                    <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
                  </svg>
                  <span>Expires in 15m</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Why Choose Data Guardian?</h2>
            <p className="section-subtitle">
              Enterprise-grade security meets simplicity
            </p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon feature-icon-blue">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </div>
              <h3 className="feature-title">Military-Grade Encryption</h3>
              <p className="feature-description">
                Your data is encrypted with AES-256 encryption, the same standard used by governments and banks worldwide.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon feature-icon-cyan">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <h3 className="feature-title">Time-Limited Access</h3>
              <p className="feature-description">
                Set custom expiration times. Links automatically self-destruct after the specified duration.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon feature-icon-purple">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <h3 className="feature-title">OTP Authentication</h3>
              <p className="feature-description">
                Double-layer security with one-time passwords. Share the OTP separately for maximum protection.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon feature-icon-green">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </div>
              <h3 className="feature-title">Instant Revocation</h3>
              <p className="feature-description">
                Kill switch feature lets you revoke access instantly, even before the link expires.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon feature-icon-orange">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
              </div>
              <h3 className="feature-title">File Attachments</h3>
              <p className="feature-description">
                Securely share documents, images, and files up to 15MB. All files are encrypted in transit and at rest.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon feature-icon-pink">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
              </div>
              <h3 className="feature-title">QR Code Generation</h3>
              <p className="feature-description">
                Instantly generate QR codes for your secure links. Perfect for mobile sharing and quick access.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="stats-section">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-number">256-bit</div>
              <div className="stat-label">AES Encryption</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">100%</div>
              <div className="stat-label">Data Privacy</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">24/7</div>
              <div className="stat-label">Protection</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">Instant</div>
              <div className="stat-label">Revocation</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-card">
            <h2 className="cta-title">Ready to Secure Your Data?</h2>
            <p className="cta-subtitle">
              Start sharing sensitive information with confidence. No credit card required.
            </p>
            <div className="cta-buttons">
              <Link href="/how-it-works" className="btn btn-primary btn-large">
                <span>Learn How It Works</span>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Link>
              <Link href="/signup" className="btn btn-outline-light btn-large">
                <span>Create Secure Link</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
