'use client';
import { FormEvent, useEffect, useId, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { genuiApi, type GenUiAnswer, type GenUiSurface, type PinnedPanel } from '@/lib/genui-api';
import { Spinner } from '@/components/ui';
import { GenUiPanel } from './genui';

/**
 * "Ask your dashboard": type what you want to see and get a generated panel
 * built from the analytics workspace or your own dashboard, at your own
 * access. Pin it and it stays on this page on every device (the server keeps
 * the question, not the figures, and rebuilds it each time).
 */

const EXAMPLES: Record<GenUiSurface, string[]> = {
  analytics: ['Compare fee collection this year with last year by month', 'Show attendance for 7B this term', 'New enquiries this quarter vs last year'],
  dashboard: ['Show my attendance this month', 'Pending homework', 'Fees due'],
};

function PinnedCard({ p, onRemoved }: { p: PinnedPanel; onRemoved: (id: string) => void }) {
  const [state, setState] = useState<{ data: GenUiAnswer | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    genuiApi.render(p.id)
      .then((d) => { if (live) setState({ data: d, error: null, loading: false }); })
      .catch((e) => { if (live) setState({ data: null, error: errorMessage(e, 'Could not load this panel.'), loading: false }); });
    return () => { live = false; };
  }, [p.id]);
  const remove = async () => {
    setBusy(true);
    try { await genuiApi.unpin(p.id); onRemoved(p.id); } catch { setBusy(false); }
  };
  const unpin = <button type="button" className="btn btn-soft btn-sm" onClick={() => void remove()} disabled={busy} aria-label={`Unpin "${p.title}"`}>Unpin</button>;
  if (state.loading) return <div className="genui-panel genui-loading" aria-busy="true"><Spinner /> <span className="ops-muted">{p.title}</span></div>;
  if (!state.data) return <div className="genui-panel"><div className="genui-head"><h3 className="genui-title">{p.title}</h3>{unpin}</div><p className="ops-muted">{state.error}</p></div>;
  return <GenUiPanel ui={state.data.ui} actions={unpin} fallback={<div className="genui-panel"><div className="genui-head"><h3 className="genui-title">{p.title}</h3>{unpin}</div><p className="ops-muted">Nothing to show for this question right now.</p></div>} />;
}

export function AskDashboard({ surface, childId = null }: { surface: GenUiSurface; childId?: string | null }) {
  const inputId = useId();
  const [prompt, setPrompt] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<GenUiAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pins, setPins] = useState<PinnedPanel[]>([]);
  const [max, setMax] = useState(12);

  useEffect(() => {
    genuiApi.pinned(surface).then((r) => { setPins(r.items); setMax(r.max); }).catch(() => setPins([]));
  }, [surface]);

  const ask = async (e?: FormEvent, text = prompt) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true); setError(null);
    try { setAnswer(await genuiApi.ask(q, childId)); setAsked(q); } catch (err) { setError(errorMessage(err, 'Could not build that panel.')); setAnswer(null); } finally { setBusy(false); }
  };
  const pin = async () => {
    if (!asked || !answer) return;
    try {
      const p = await genuiApi.pin(surface, asked, answer.title !== 'No matching figures' ? answer.title : undefined, childId);
      setPins((cur) => (cur.some((x) => x.id === p.id) ? cur : [...cur, p]));
      setAnswer(null); setAsked(null); setPrompt('');
    } catch (err) { setError(errorMessage(err, 'Could not pin this panel.')); }
  };
  const pinned = asked ? pins.some((p) => p.prompt === asked) : false;

  return (
    <section className="genui-ask card" aria-label="Ask your dashboard">
      <form className="genui-ask-row" onSubmit={(e) => void ask(e)}>
        <label htmlFor={inputId} className="genui-ask-label"><span aria-hidden="true">✨</span> Ask your dashboard</label>
        <input id={inputId} className="input genui-ask-input" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} placeholder={`e.g. ${EXAMPLES[surface][0]}`} disabled={busy} />
        <button type="submit" className="btn btn-accent btn-sm" disabled={busy || !prompt.trim()}>{busy ? 'Building…' : 'Show'}</button>
      </form>
      {!answer && !busy && (
        <div className="genui-examples" aria-label="Examples">
          {EXAMPLES[surface].map((x) => <button key={x} type="button" className="genui-chip" onClick={() => { setPrompt(x); void ask(undefined, x); }}>{x}</button>)}
        </div>
      )}
      {error && <p className="ops-error" role="alert">⚠ {error}</p>}
      {answer && (
        <GenUiPanel
          ui={answer.ui}
          fallback={<p className="ops-muted">Nothing to show for that.</p>}
          actions={(
            <>
              {answer.source !== 'none' && (pinned
                ? <span className="ops-muted">Pinned</span>
                : <button type="button" className="btn btn-soft btn-sm" onClick={() => void pin()} disabled={pins.length >= max} title={pins.length >= max ? `Up to ${max} pinned panels` : 'Keep this panel on this page'}>📌 Pin</button>)}
              <button type="button" className="btn btn-soft btn-sm" onClick={() => { setAnswer(null); setAsked(null); }} aria-label="Close this panel">×</button>
            </>
          )}
        />
      )}
      {pins.length > 0 && (
        <div className="genui-pins" aria-label="Pinned panels">
          {pins.map((p) => <PinnedCard key={p.id} p={p} onRemoved={(id) => setPins((cur) => cur.filter((x) => x.id !== id))} />)}
        </div>
      )}
    </section>
  );
}
