import type { Metadata, Viewport } from "next";
import { Inter } from 'next/font/google';
import Link from 'next/link';
import Image from 'next/image';
import "./globals.css";
import "./anthropic.css";
import Providers from "@/components/Providers";
import ClientAppShell from "@/components/ClientAppShell";

// next/font: Self-hosts Inter, preloads it, eliminates render-blocking requests
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  preload: true,
});

// Viewport export (Next.js 16 best practice — separate from metadata)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#020617',
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: {
    default: "Secure Protocol - Enterprise Data Security",
    template: "%s | Secure Protocol",
  },
  description: "Protect your sensitive data with military-grade encryption, ephemeral sessions, and complete access control. Share securely with OTP protection and instant revocation.",
  keywords: ["data protection", "encryption", "secure sharing", "privacy", "cybersecurity", "OTP", "self-destructing links", "zero trust"],
  authors: [{ name: "Secure Protocol" }],
  creator: "Secure Protocol",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Secure Protocol",
    title: "Secure Protocol - Enterprise Secure Data Sharing",
    description: "Share sensitive data with military-grade AES-256 encryption, OTP protection, and instant revocation. Zero-knowledge architecture ensures complete privacy.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Secure Protocol - Secure Data Protection",
    description: "Military-grade encryption. OTP protection. Instant revocation. Share sensitive data with confidence.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* DNS prefetch for faster external connections */}
        <link rel="dns-prefetch" href="//accounts.google.com" />
        <link rel="preconnect" href="https://accounts.google.com" crossOrigin="anonymous" />
      </head>
      <body className={inter.className}>
        <a href="#main-content" className="skip-to-content">Skip to main content</a>
        <Providers>
          <ClientAppShell
            footer={
              <footer className="footer">
                <div className="container">
                  <div className="footer-grid">
                    <div className="footer-brand">
                      <Link href="/" className="footer-logo">
                        <Image src="/logo.svg" alt="Data Guardian" width={24} height={24} />
                        <span className="footer-logo-text">Data Guardian</span>
                      </Link>
                      <p className="footer-motto">
                        Enterprise-grade data security. Protect, share, and control your sensitive information with zero-knowledge architecture.
                      </p>
                      <div className="footer-socials">
                        <a href="#" aria-label="Twitter"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path></svg></a>
                        <a href="#" aria-label="GitHub"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg></a>
                        <a href="#" aria-label="LinkedIn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg></a>
                      </div>
                    </div>
                    <div>
                      <h4 className="footer-col-title">Product</h4>
                      <div className="footer-links">
                        <Link href="/create-link" className="footer-link">Secure Sharing</Link>
                        <Link href="/dashboard" className="footer-link">Dashboard</Link>
                        <Link href="/services" className="footer-link">Enterprise Services</Link>
                        <Link href="/how-it-works" className="footer-link">How it Works</Link>
                      </div>
                    </div>
                    <div>
                      <h4 className="footer-col-title">Resources</h4>
                      <div className="footer-links">
                        <Link href="#" className="footer-link">Documentation</Link>
                        <Link href="#" className="footer-link">Developer API</Link>
                        <Link href="#" className="footer-link">Help Center</Link>
                        <Link href="#" className="footer-link">System Status</Link>
                      </div>
                    </div>
                    <div>
                      <h4 className="footer-col-title">Legal</h4>
                      <div className="footer-links">
                        <Link href="/legal/privacy" className="footer-link">Privacy Policy</Link>
                        <Link href="/legal/terms" className="footer-link">Terms of Service</Link>
                        <Link href="#" className="footer-link">Security Audits</Link>
                        <Link href="/legal/cookies" className="footer-link">Cookie Policy</Link>
                      </div>
                    </div>
                  </div>
                  <div className="footer-bottom">
                    <p>&copy; {new Date().getFullYear()} Data Guardian. All rights reserved.</p>
                    <div className="footer-bottom-links">
                      <Link href="#">English (US)</Link>
                      <Link href="#">ISO 27001 Certified</Link>
                    </div>
                  </div>
                </div>
              </footer>
            }
          >
            {children}
          </ClientAppShell>
        </Providers>
      </body>
    </html>
  );
}
