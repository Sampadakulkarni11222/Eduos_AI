'use client';
import { useState } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:5000';

/** Asks before unsubscribing, so a link scanner opening the page does not unsubscribe anyone. */
export function NewsletterUnsubscribe({ school, token }: { school: string; token: string }) {
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'error'>(token ? 'ask' : 'error');
  const [message, setMessage] = useState(token ? '' : 'This unsubscribe link is incomplete.');
  const go = async () => {
    setState('busy');
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/public/newsletter/${encodeURIComponent(school)}/unsubscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? 'This unsubscribe link is not valid.');
      setMessage(body?.data?.message ?? 'You are unsubscribed.');
      setState('done');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setState('error');
    }
  };
  return (
    <main style={{ maxWidth: 520, margin: '48px auto', padding: '0 16px', fontFamily: 'inherit' }}>
      <h1 style={{ fontFamily: '"Newsreader", serif', fontSize: 28, margin: '0 0 12px' }}>Newsletter email</h1>
      {state === 'ask' || state === 'busy' ? (
        <>
          <p>Stop receiving the school newsletter by email? You can still read it in EduOS and turn the email back on in its Settings.</p>
          <button type="button" className="btn btn-accent" disabled={state === 'busy'} onClick={() => void go()}>{state === 'busy' ? 'Unsubscribing…' : 'Unsubscribe'}</button>
        </>
      ) : <p role={state === 'error' ? 'alert' : 'status'}>{message}</p>}
    </main>
  );
}
