'use client';
import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown in the root layout itself, where
 * `error.tsx` cannot help because the layout that would wrap it is the thing
 * that failed. It must therefore render its own <html> and <body>, and cannot
 * rely on any provider, stylesheet or token from the app.
 *
 * Colours are hard-coded for exactly that reason: design-system.css may never
 * have loaded at this point.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Fatal application error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F7F3EA',
          color: '#332b25',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
            ⚠
          </div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>The app could not start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#6b5f56', margin: '0 0 20px' }}>
            Something failed before the page could load. Reloading usually fixes
            it — if it does not, please contact your school administrator.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#9a8c80', margin: '0 0 20px' }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
          <button
            onClick={reset}
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '10px 18px',
              background: '#591620',
              color: '#F4E7D2',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
