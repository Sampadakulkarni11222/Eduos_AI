'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { renewSession } from '@/lib/api';
import { integrationsApi, safeReturnPath, OAUTH_STORAGE_KEY } from '@/lib/integrations-api';

/**
 * The single redirect URI every provider app (Meta, Google, LinkedIn, X) is
 * registered with. The provider sends the browser here with `code` and
 * `state`; this page hands them, with the nonce this tab kept, to the API,
 * which checks the state belongs to this school, this person and this tab
 * before exchanging the code. Tokens never come back to the browser.
 */
export default function OAuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Finishing the connection…');
  const [back, setBack] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const q = new URLSearchParams(window.location.search);
    let saved: { browserNonce?: string; returnPath?: string } = {};
    try { saved = JSON.parse(sessionStorage.getItem(OAUTH_STORAGE_KEY) ?? '{}'); } catch { saved = {}; }
    try { sessionStorage.removeItem(OAUTH_STORAGE_KEY); } catch { /* ignore */ }
    const returnPath = safeReturnPath(saved.returnPath);
    setBack(returnPath);
    // The code must not linger in the address bar or history.
    window.history.replaceState(null, '', window.location.pathname);
    const state = q.get('state') ?? '';
    if (!saved.browserNonce || !state) {
      setMessage('This connection was not started from this browser tab, so it was not completed. Go back and press Connect again.');
      return;
    }
    void (async () => {
      try {
        await renewSession();
        const out = await integrationsApi.complete({
          state, code: q.get('code') ?? undefined, error: q.get('error') ?? undefined,
          errorDescription: q.get('error_description') ?? undefined, browserNonce: saved.browserNonce as string,
        });
        setMessage('Connected. Taking you back…');
        router.replace(safeReturnPath(out.returnPath) ?? returnPath ?? '/');
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'The connection could not be completed.');
      }
    })();
  }, [router]);

  return (
    <main className="oauth-callback" style={{ maxWidth: 560, margin: '64px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Connecting an account</h1>
      <p role="status">{message}</p>
      {back && <p><a href={back}>Back to where you were</a></p>}
    </main>
  );
}
