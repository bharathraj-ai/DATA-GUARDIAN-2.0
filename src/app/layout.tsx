import type { Metadata, Viewport } from "next";
import { Inter } from 'next/font/google';
import Link from 'next/link';
import Image from 'next/image';
import "./globals.css";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";

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
    default: "Data Guardian - Secure Data Protection",
    template: "%s | Data Guardian",
  },
  description: "Protect your sensitive data with military-grade encryption, ephemeral sessions, and complete access control. Share securely with OTP protection and instant revocation.",
  keywords: ["data protection", "encryption", "secure sharing", "privacy", "cybersecurity", "OTP", "self-destructing links", "zero trust"],
  authors: [{ name: "Data Guardian" }],
  creator: "Data Guardian",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Data Guardian",
    title: "Data Guardian - Enterprise Secure Data Sharing",
    description: "Share sensitive data with military-grade AES-256 encryption, OTP protection, and instant revocation. Zero-knowledge architecture ensures complete privacy.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Data Guardian - Secure Data Protection",
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
          <Navbar />
          <div id="main-content">{children}</div>
          <footer className="footer">
            <div className="container">
              <div className="footer-grid">
                <div className="footer-brand">
                  <Link href="/" className="footer-logo">
                    <Image src="/logo.svg" alt="Data Guardian" width={24} height={24} />
                    <span className="gradient-text">Data Guardian</span>
                  </Link>
                  <p className="footer-motto">
                    Protecting your sensitive data with military-grade encryption and self-destructing links.
                  </p>
                </div>
                <div>
                  <h4 className="footer-col-title">Platform</h4>
                  <div className="footer-links">
                    <Link href="/services" className="footer-link">Services</Link>
                    <Link href="/how-it-works" className="footer-link">How it Works</Link>
                    <Link href="/create-link" className="footer-link">Create Link</Link>
                  </div>
                </div>
                <div>
                  <h4 className="footer-col-title">Legal</h4>
                  <div className="footer-links">
                    <Link href="/legal/privacy" className="footer-link">Privacy Policy</Link>
                    <Link href="/legal/terms" className="footer-link">Terms of Service</Link>
                    <Link href="/legal/cookies" className="footer-link">Cookie Policy</Link>
                  </div>
                </div>
              </div>
              <div className="footer-bottom">
                <p>&copy; 2026 Data Guardian. All rights reserved.</p>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
