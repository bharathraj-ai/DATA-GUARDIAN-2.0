import type { Metadata } from "next";
import Link from 'next/link';
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Data Guardian - Secure Data Protection",
  description: "Protect your sensitive data with military-grade encryption, ephemeral sessions, and complete access control.",
  keywords: ["data protection", "encryption", "secure sharing", "privacy", "cybersecurity"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* We use Inter from globals.css @import */}
      </head>
      <body>
        <Navbar />
        {children}
        <footer className="footer">
          <div className="container">
            <div className="footer-grid">
              <div className="footer-brand">
                <Link href="/" className="footer-logo">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
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
                  <Link href="/signup" className="footer-link">Create Link</Link>
                </div>
              </div>
              <div>
                <h4 className="footer-col-title">Legal</h4>
                <div className="footer-links">
                  <a href="#" className="footer-link">Privacy Policy</a>
                  <a href="#" className="footer-link">Terms of Service</a>
                  <a href="#" className="footer-link">Cookie Policy</a>
                </div>
              </div>
            </div>
            <div className="footer-bottom">
              <p>&copy; 2026 Data Guardian. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
