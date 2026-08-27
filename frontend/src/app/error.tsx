'use client';
import { useEffect } from 'react';

/**
 * Route-level error boundary. Without this, any uncaught render error anywhere
 * in the app dropped the user onto Next.js's raw default error screen — no
 * branding, no way back, and in production no indication of what to do next.
 *
 * `reset()` re-renders the failed segment, which recovers from transient causes
 * (a bad API response, a race on first paint) without a full page load.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the browser console and in server logs via the digest, so a
    // failure a user reports can be traced without reproducing it first.
    console.error('Route error:', error);
  }, [error]);

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
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
          ⚠
        </div>
        <h1
          style={{
            fontFamily: 'Newsreader, serif',
            fontSize: 22,
            margin: '0 0 8px',
            color: 'var(--text-1, #332b25)',
          }}
        >
          Something went wrong
        </h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-2b, #6b5f56)', margin: '0 0 20px' }}>
          This screen failed to load. Trying again usually fixes it — if it keeps
          happening, please tell your school administrator.
        </p>

        {error.digest && (
          <p style={{ fontSize: 11.5, color: 'var(--text-faint, #9a8c80)', margin: '0 0 20px' }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-accent" onClick={reset}>
            Try again
          </button>
          <button className="btn btn-soft" onClick={() => window.location.assign('/')}>
            Back to start
          </button>
        </div>
      </div>
    </div>
  );
}
