import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Help Center',
  description: 'Common questions for Secure Protocol owners, team leaders, and vendors.',
};

const FAQS = [
  {
    q: 'Invalid OTP?',
    a: 'Use the latest email code. After repeated fails the link may lock or revoke.',
  },
  {
    q: 'Wrong Google account?',
    a: 'Sign out and use the email bound to the share invitation.',
  },
  {
    q: 'Stop access now?',
    a: 'Team leaders revoke from the shares dashboard or the owner-token revoke page.',
  },
  {
    q: 'Vendor paused mid-work?',
    a: 'Use Break session, then re-enter OTP to resume.',
  },
  {
    q: 'Who can create links?',
    a: 'Only Team leaders. Company and Manager seats manage people; Vendors receive shares.',
  },
  {
    q: 'How do OTPs arrive?',
    a: 'By email (SMTP) only. Send the share link on a different channel when you can.',
  },
];

export default function HelpPage() {
  return (
    <main className="container" style={{ padding: '3rem 1rem', maxWidth: 720 }}>
      <h1 style={{ fontSize: '2rem' }}>Help Center</h1>
      <p style={{ color: '#94a3b8' }}>Fast answers for the issues teams hit most often.</p>
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
        {FAQS.map((f) => (
          <article
            key={f.q}
            style={{
              border: '1px solid #1e293b',
              borderRadius: 12,
              padding: '1rem 1.25rem',
              background: '#0f172a',
            }}
          >
            <h2 style={{ fontSize: '1rem', margin: '0 0 0.35rem' }}>{f.q}</h2>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: 14 }}>{f.a}</p>
          </article>
        ))}
      </div>
      <p style={{ marginTop: '2rem' }}>
        <Link href="/docs" style={{ color: '#38bdf8' }}>
          Protocol docs
        </Link>
        {' · '}
        <Link href="/status" style={{ color: '#38bdf8' }}>
          System status
        </Link>
      </p>
    </main>
  );
}
