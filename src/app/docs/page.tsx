import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'Secure Protocol field guide: hierarchy, SecureLink, OTP, sessions, and revoke.',
};

export default function DocsPage() {
  return (
    <main className="container" style={{ padding: '3rem 1rem', maxWidth: 720 }}>
      <h1 style={{ fontSize: '2rem' }}>Protocol guide</h1>
      <p style={{ color: '#94a3b8' }}>
        Short field guide to the pieces you use day to day.
      </p>

      <section style={section}>
        <h2 style={h2}>Hierarchy</h2>
        <p style={p}>
          <strong>Admin</strong> → <strong>Company</strong> → <strong>Manager</strong> →{' '}
          <strong>Team leader</strong> (owner of the share) → <strong>Vendor</strong>.
        </p>
        <p style={p}>
          Self-serve sign-up picks Team leader or Vendor. Company, Manager, and Admin seats are
          invite- or seed-only.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>SecureLink</h2>
        <p style={p}>
          Encrypted package with token, expiry, and access rules. Ciphertext lives in MongoDB GridFS;
          metadata in Postgres.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>OTP</h2>
        <p style={p}>
          Hashed one-time code delivered by email. Wrong attempts can lock or revoke the link. Prefer
          sending the link and OTP on different channels.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Session</h2>
        <p style={p}>
          Short-lived vendor access with device binding after unlock. Break sessions pause work and
          rotate OTP on resume.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Owner token</h2>
        <p style={p}>
          Separate control path for revoke without using the share URL. Team leaders keep this private.
        </p>
      </section>

      <p style={{ marginTop: '2rem' }}>
        <Link href="/help" style={{ color: '#38bdf8' }}>
          Help center
        </Link>
      </p>
    </main>
  );
}

const section: React.CSSProperties = {
  marginTop: '1.5rem',
  borderTop: '1px solid #1e293b',
  paddingTop: '1rem',
};
const h2: React.CSSProperties = { fontSize: '1.15rem', margin: '0 0 0.5rem' };
const p: React.CSSProperties = { color: '#94a3b8', fontSize: 14, lineHeight: 1.6, margin: '0 0 0.5rem' };
