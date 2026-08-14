import type { Metadata, Viewport } from "next";
import { Inter } from 'next/font/google';
import "./globals.css";
import "./anthropic.css";
import "./responsive.css";
import Providers from "@/components/Providers";
import ClientAppShell from "@/components/ClientAppShell";
import SiteFooter from "@/components/SiteFooter";

// next/font: Self-hosts Inter, preloads it, eliminates render-blocking requests
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  // Avoid blocking first paint while the font file loads
  preload: false,
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
          <ClientAppShell footer={<SiteFooter />}>
            {children}
          </ClientAppShell>
        </Providers>
      </body>
    </html>
  );
}
