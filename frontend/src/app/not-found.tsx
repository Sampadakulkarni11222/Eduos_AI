import Link from 'next/link';

/**
 * 404 page. Deliberately does not guess where the user should go — a parent, a
 * teacher and a warden all have different landing pages, and the portal router
 * at "/" already sends each role to the right one.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'Newsreader, serif',
            fontSize: 44,
            lineHeight: 1,
            color: 'var(--accent, #591620)',
            marginBottom: 10,
          }}
        >
          404
        </div>
        <h1
          style={{
            fontFamily: 'Newsreader, serif',
            fontSize: 20,
            margin: '0 0 8px',
            color: 'var(--text-1, #332b25)',
          }}
        >
          Page not found
        </h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2b, #6b5f56)', margin: '0 0 20px' }}>
          This page does not exist, or you may not have access to it.
        </p>
        <Link href="/" className="btn btn-accent" style={{ textDecoration: 'none' }}>
          Back to start
        </Link>
      </div>
    </div>
  );
}
