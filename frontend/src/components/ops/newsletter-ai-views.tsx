'use client';
import { useRef, useState } from 'react';
import { Button, EmptyState, Field, cx, useToast } from '@/components/ui';
import {
  newsletterApi, OPP_DOMAINS, OPP_LEVELS, DOMAIN_LABELS, EDITION_SECTIONS,
  type EditionExtras, type EditionSection, type Extraction, type SectionNote, type AlertSource, type RadarRow,
} from '@/lib/newsletter-api';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tile, fmtDate, fmtDateTime, humanize, useAction, useLoad } from './kit';

/**
 * Part 5 additions to the newsletter screens (newsletter-views.tsx keeps the
 * part 4 layout; these slot into it):
 *
 *   SixtySeconds       "This week in 60 seconds": swipeable cards, one per item,
 *                      each with its deadline chip and the reader's own reason
 *   DeadlineRadar      confirmed closing dates in 7, 14 and 30 days
 *   BadgeStrip         flashcard streak and badges
 *   ChallengeBlock     students: challenge a classmate (own class, in the app)
 *   SectionNoteLine    the editor's note under a section, with its sources
 *   ExtractionDetails  in the review queue: each extracted detail beside the
 *                      text it came from, and what was dropped
 *   RegenerateBar      editor, drafts: "Regenerate this section"
 *   DeskAlerts         the "Google Alerts" desk tab: the guided "Add a Google
 *                      Alert" panel, feeds, what they found, and accuracy
 */

// ── reader ─────────────────────────────────────────────────────────────

export function SixtySeconds({ extras }: { extras: EditionExtras }) {
  const track = useRef<HTMLOListElement>(null);
  const [at, setAt] = useState(0);
  const cards = extras.sixtySeconds;
  const go = (i: number) => {
    const n = Math.max(0, Math.min(cards.length - 1, i));
    setAt(n);
    track.current?.children[n]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };
  const onScroll = () => {
    const el = track.current;
    if (!el || !el.children.length) return;
    const w = (el.children[0] as HTMLElement).offsetWidth + 12;
    setAt(Math.round(el.scrollLeft / w));
  };
  return (
    <div className="nl60">
      <div className="nl60-dots" aria-hidden="true">{cards.map((c, i) => <span key={i} className={cx(i <= at && 'is-on')} />)}</div>
      <ol ref={track} className="nl60-track" onScroll={onScroll} aria-label="Swipe through this edition, one card at a time">
        {cards.map((c, i) => (
          <li key={i} className={cx('nl60-card', `is-${c.kind.toLowerCase()}`, c.urgent && 'is-urgent')} aria-roledescription="card" aria-label={`${i + 1} of ${cards.length}`}>
            {c.kind === 'ITEM' && <span className="nl60-chip">{c.chip}</span>}
            <h3 className="nl60-title">{c.title}</h3>
            {c.text && <p className="nl60-text">{c.text}</p>}
            {c.question && <p className="nl60-q">{c.question}</p>}
            {c.because && <p className="nl60-because">{c.because}</p>}
            {c.kind === 'ITEM' && c.type && <p className="nl60-type">{c.type}</p>}
          </li>
        ))}
      </ol>
      <div className="nl60-nav">
        <Button small variant="soft" disabled={at === 0} onClick={() => go(at - 1)}>Back</Button>
        <span className="ops-muted">{Math.min(at + 1, cards.length)} of {cards.length}</span>
        <Button small variant="soft" disabled={at >= cards.length - 1} onClick={() => go(at + 1)}>Next</Button>
      </div>
    </div>
  );
}

function RadarLane({ title, rows }: { title: string; rows: RadarRow[] }) {
  return (
    <div className="nl-radar-lane">
      <h3>{title} <span className="ops-muted">{rows.length}</span></h3>
      {rows.length ? (
        <ul>{rows.map((r) => (
          <li key={r.id}>
            <b className="nl-radar-days">{r.daysLeft}<small>{r.daysLeft === 1 ? 'day' : 'days'}</small></b>
            <span><span className="nl-radar-title">{r.title}</span>{r.saved && <span className="ops-muted"> (saved)</span>}{r.because && <span className="nl-radar-why">{r.because}</span>}</span>
          </li>
        ))}</ul>
      ) : <p className="ops-muted">Nothing closes then.</p>}
    </div>
  );
}

export function DeadlineRadar({ extras }: { extras: EditionExtras }) {
  const r = extras.deadlineRadar;
  if (!r.in7.length && !r.in14.length && !r.in30.length) return <p className="ops-muted">No confirmed closing dates in the next 30 days. {r.note}</p>;
  return (
    <div className="ops-stack">
      <div className="nl-radar">
        <RadarLane title="Within 7 days" rows={r.in7} />
        <RadarLane title="8 to 14 days" rows={r.in14} />
        <RadarLane title="15 to 30 days" rows={r.in30} />
      </div>
      <p className="ops-muted">{r.note}</p>
    </div>
  );
}

export function BadgeStrip({ extras }: { extras: EditionExtras }) {
  return (
    <div className="nl-badges">
      <p className="nl-badges-streak"><b>{extras.streak.count}</b> day streak <span className="ops-muted">(best {extras.streak.best})</span></p>
      <ul>{extras.badges.map((b) => (
        <li key={b.key} className={cx('nl-badge', b.earned && 'is-earned')} title={b.hint}>
          <span className="nl-badge-mark" aria-hidden="true">{b.earned ? '★' : '☆'}</span>
          <span>{b.label}<small>{b.earned ? 'Earned' : `${b.progress}: ${b.hint}`}</small></span>
        </li>
      ))}</ul>
    </div>
  );
}

export function ChallengeBlock({ editionId, extras, onChanged }: { editionId: string; extras: EditionExtras; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const mates = useLoad(() => (open ? newsletterApi.classmates(editionId) : Promise.resolve([])), [open, editionId]);
  const toast = useToast();
  const { run, busy, error } = useAction();
  const c = extras.challenges;
  if (!c) return null;
  const rows = [...c.received, ...c.sent];
  return (
    <div className="nl-challenge">
      {rows.length > 0 && (
        <ul className="nl-challenge-list">{rows.map((r) => (
          <li key={r.id}>
            <span>{r.direction === 'RECEIVED' ? `${r.with} challenged you` : `You challenged ${r.with}`}</span>
            <span className={cx('nl-challenge-score', r.status === 'DONE' && 'is-done')}>{r.status === 'DONE' ? `${r.yourScore}/${r.outOf} v ${r.theirScore}/${r.outOf}: ${r.result}` : r.result}</span>
          </li>
        ))}</ul>
      )}
      {c.left > 0 && !open && <Button small variant="soft" onClick={() => setOpen(true)}>Challenge a classmate</Button>}
      {open && (
        <Loadable state={mates}>{(list) => list.length ? (
          <div className="nl-pick-list">{list.map((m) => (
            <Button key={m.studentId} small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.challenge(editionId, m.studentId); toast(r.sent ? `Challenge sent to ${r.to}` : `You already challenged ${r.to}`); setOpen(false); onChanged(); })}>{m.name}</Button>
          ))}</div>
        ) : <p className="ops-muted">No classmates with an EduOS login yet.</p>}</Loadable>
      )}
      <ErrorNote error={error} />
      <p className="ops-muted">{c.note}</p>
    </div>
  );
}

export function SectionNoteLine({ note }: { note?: SectionNote }) {
  if (!note) return null;
  return (
    <p className="nl-note">
      {note.note}
      {note.evidence.length > 0 && <span className="nl-note-src"> Based on {note.evidence.map((e, i) => (
        <span key={e.opportunityId}>{i ? ', ' : ''}{e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> : e.title}</span>
      ))}.</span>}
    </p>
  );
}

// ── editor ─────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', summary: 'Summary', type: 'Type', level: 'Level', region: 'Region', domains: 'Domains', gradeMin: 'From class', gradeMax: 'To class',
  ageMin: 'From age', ageMax: 'To age', streams: 'Streams', registrationOpens: 'Registration opens', registrationCloses: 'Registration closes', eventDate: 'Event date',
  fee: 'Fee', mode: 'Mode', officialUrl: 'Official link', organiser: 'Organiser', howToApply: 'How to apply',
};

export function ExtractionDetails({ x, sourceLink }: { x: Extraction; sourceLink?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx('nl-extract', x.method === 'AI' ? 'is-ai' : 'is-auto')}>
      <button type="button" className="nl-extract-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{x.label}</span><span className="ops-muted">{x.fields.length} detail{x.fields.length === 1 ? '' : 's'}{open ? '' : ', show where each came from'}</span>
      </button>
      {open && (
        <div className="nl-extract-body">
          <dl>{x.fields.map((f) => (
            <div key={f.field}><dt>{FIELD_LABELS[f.field] ?? humanize(f.field)} <span className="ops-muted">from the {f.from === 'PAGE' ? 'official page' : 'alert'}</span></dt><dd>“{f.snippet}”</dd></div>
          ))}</dl>
          {x.dropped.length > 0 && <p className="ops-muted">Left out because no source text supported them: {x.dropped.map((d) => FIELD_LABELS[d] ?? d).join(', ')}.</p>}
          {x.page?.note && <p className="ops-muted">Page: {x.page.note}</p>}
          {sourceLink && <p className="ops-muted nl-break">Article: <a href={sourceLink} target="_blank" rel="noopener noreferrer">{sourceLink}</a></p>}
        </div>
      )}
    </div>
  );
}

const SECTION_LABELS: Record<EditionSection, string> = { hook: 'Hook', notes: 'Section notes', flashcards: 'Flashcards', quiz: 'Quiz', poll: 'Poll' };

export function RegenerateBar({ editionId, writtenBy, onDone }: { editionId: string; writtenBy?: Record<string, string> | null; onDone: () => void }) {
  const toast = useToast();
  const { run, busy, error } = useAction();
  const [last, setLast] = useState<string | null>(null);
  return (
    <div className="nl-regen">
      <p className="nl-regen-label">Regenerate this section</p>
      <div className="nl-actions">
        {EDITION_SECTIONS.map((s) => (
          <Button key={s} small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.regenerate(editionId, s); setLast(r.message); toast(`${SECTION_LABELS[s]}: ${r.writtenBy === 'AI' ? 'new AI version' : 'new template version'}`); onDone(); })}>
            {SECTION_LABELS[s]}{writtenBy?.[s] ? <span className="nl-regen-by">{writtenBy[s] === 'AI' ? 'AI' : 'template'}</span> : null}
          </Button>
        ))}
      </div>
      {last && <p className="ops-muted">{last}</p>}
      <ErrorNote error={error} />
    </div>
  );
}

function AddAlertPanel({ onAdded }: { onAdded: () => void }) {
  const g = useLoad(() => newsletterApi.alertGuide(), []);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [level, setLevel] = useState('');
  const [region, setRegion] = useState('');
  const [domain, setDomain] = useState<string>('SCIENCE');
  const toast = useToast();
  const { run, busy, error } = useAction();
  const copy = (q: string) => { setQuery(q); if (!title) setTitle(q.slice(0, 60)); void navigator.clipboard?.writeText(q).then(() => toast('Copied: paste it into Google Alerts'), () => undefined); };
  return (
    <SectionCard title="Add a Google Alert" sub="Google Alerts sends new web results for the words you choose to an RSS feed. EduOS reads that feed; it does not use any Google API and never reads Google's pages.">
      <Loadable state={g}>{(d) => (
        <div className="nl-alert-guide">
          <ol className="nl-alert-steps">{d.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <div className="nl-alert-suggest">
            <p className="nl-regen-label">Words to watch, by domain{d.state ? ` (state: ${d.state})` : ''}</p>
            <div className="nl-seg" role="group" aria-label="Domain">
              {Object.keys(d.suggestions.byDomain).map((k) => <button key={k} type="button" aria-pressed={domain === k} className={cx(domain === k && 'is-on')} onClick={() => setDomain(k)}>{DOMAIN_LABELS[k] ?? k}</button>)}
            </div>
            <ul>{[...(d.suggestions.byDomain[domain] ?? []), ...(domain === 'SCIENCE' ? d.suggestions.byLevel.NATIONAL ?? [] : [])].map((q) => (
              <li key={q}><code>{q}</code><Button small variant="ghost" onClick={() => copy(q)}>Copy</Button></li>
            ))}</ul>
            <p className="ops-muted">State and international ideas: {[...(d.suggestions.byLevel.STATE ?? []), ...(d.suggestions.byLevel.INTERNATIONAL ?? [])].join('; ')}</p>
          </div>
          <form className="nl-alert-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await newsletterApi.addAlertSource({ kind: 'GOOGLE_ALERT', url: url.trim(), title: title.trim(), query: query.trim() || undefined, tags: { domains, level: level || null, region: region.trim() || null } }); toast('Feed added: EduOS checks it every hour'); setUrl(''); setTitle(''); setQuery(''); setDomains([]); onAdded(); }); }}>
            <Field label="RSS feed link from Google Alerts" hint={`Looks like ${d.urlPattern}`}><input className="input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.google.com/alerts/feeds/…" required /></Field>
            <Field label="Name"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Science olympiads, India" required maxLength={120} /></Field>
            <Field label="Words the alert watches (for your reference)"><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} /></Field>
            <fieldset className="nl-alert-tags"><legend>Domains</legend>
              {OPP_DOMAINS.map((k) => <label key={k} className="nl-toggle"><input type="checkbox" checked={domains.includes(k)} onChange={(e) => setDomains((cur) => (e.target.checked ? [...cur, k] : cur.filter((x) => x !== k)))} /> {DOMAIN_LABELS[k]}</label>)}
            </fieldset>
            <div className="nl-alert-row">
              <Field label="Level"><select className="input" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">Any</option>{OPP_LEVELS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
              <Field label="Region (a state)"><input className="input" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={80} placeholder={d.state ?? ''} /></Field>
            </div>
            <Button disabled={busy || !url.trim() || !title.trim()}>Add the feed</Button>
            <ErrorNote error={error} />
          </form>
          <ul className="nl-alert-notes">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <DataNote>{d.aiExtraction}</DataNote>
        </div>
      )}</Loadable>
    </SectionCard>
  );
}

function SourceRow({ s, onChanged }: { s: AlertSource; onChanged: () => void }) {
  const toast = useToast();
  const { run, busy, error } = useAction();
  return (
    <li>
      <div className="nl-desk-main">
        <b>{s.title}</b> <StatusPill status={s.status === 'PAUSED' ? 'PAUSED' : s.lastStatus === 'FAILED' ? 'FAILED' : s.sample ? 'SAMPLE' : 'ACTIVE'} />
        <p className="ops-muted">{s.kindLabel}{s.tagLabels.domains.length ? `. ${s.tagLabels.domains.join(', ')}` : ''}{s.tagLabels.level ? `, ${s.tagLabels.level.toLowerCase()}` : ''}{s.tagLabels.region ? `, ${s.tagLabels.region}` : ''}</p>
        {s.query && <p className="ops-muted">Watching: {s.query}</p>}
        <p className="ops-muted">
          {s.sample ? 'Sample feed with a made-up address: never fetched.' : s.lastFetchedAt ? `Checked ${fmtDateTime(s.lastFetchedAt)}, ${s.lastItemCount} item(s) in the feed, ${s.itemsFound} new so far.` : 'Not checked yet.'}
          {s.lastStatus === 'FAILED' && s.lastError && ` Last error: ${s.lastError}.`}
          {s.failures > 0 && s.nextFetchAt && ` Next try ${fmtDateTime(s.nextFetchAt)} (waiting longer after ${s.failures} failure${s.failures === 1 ? '' : 's'}).`}
        </p>
        <p className="ops-muted nl-break">{s.url}</p>
      </div>
      <div className="nl-actions">
        {!s.sample && <Button small variant="soft" disabled={busy || s.status === 'PAUSED'} onClick={() => void run(async () => { const r = await newsletterApi.checkAlertSource(s.id); toast(`${r.added} new item(s); ${r.extracted.CANDIDATE} to review`); onChanged(); })}>Check now</Button>}
        <Button small variant="ghost" disabled={busy} onClick={() => void run(async () => { await newsletterApi.updateAlertSource(s.id, { status: s.status === 'PAUSED' ? 'APPROVED' : 'PAUSED' }); onChanged(); })}>{s.status === 'PAUSED' ? 'Resume' : 'Pause'}</Button>
      </div>
      <ErrorNote error={error} />
    </li>
  );
}

const ITEM_STATUS: Record<string, string> = { NEW: 'Waiting', CANDIDATE: 'In the review queue', DUPLICATE: 'Duplicate', SKIPPED: 'Not an opportunity', FAILED: 'Could not process' };

export function DeskAlerts() {
  const sources = useLoad(() => newsletterApi.alertSources(), []);
  const items = useLoad(() => newsletterApi.alertItems(), []);
  const stats = useLoad(() => newsletterApi.alertAnalytics(), []);
  const toast = useToast();
  const { run, busy, error } = useAction();
  const reload = () => { void sources.reload(); void items.reload(); void stats.reload(); };
  return (
    <div className="ops-stack">
      <AddAlertPanel onAdded={reload} />
      <SectionCard title="Alert feeds" sub="Read every hour. A feed that fails waits longer before the next try (2 hours, 4, 8, up to a day).">
        <div className="nl-actions"><Button small variant="soft" disabled={busy} onClick={() => void run(async () => { const r = await newsletterApi.runAlerts(); toast(`${r.feeds.checked} feed(s) checked, ${r.extracted.CANDIDATE} new candidate(s)`); reload(); })}>Check all feeds now</Button></div>
        <ErrorNote error={error} />
        <Loadable state={sources}>{(rows) => rows.length ? <ul className="nl-desk-list">{rows.map((s) => <SourceRow key={s.id} s={s} onChanged={reload} />)}</ul> : <EmptyState icon="⌁" title="No alert feeds yet" sub="Create a Google Alert with the steps above and paste its RSS link." />}</Loadable>
      </SectionCard>
      <SectionCard title="What the feeds found" sub="Each item once, by its real article link. Candidates wait in the review queue; nothing is published without you.">
        <Loadable state={items}>{(rows) => rows.length ? (
          <ul className="nl-desk-list">{rows.slice(0, 30).map((i) => (
            <li key={i.id}><div className="nl-desk-main"><b>{i.title}</b> <span className={cx('nl-item-status', `is-${i.status.toLowerCase()}`)}>{ITEM_STATUS[i.status]}</span><p className="ops-muted">{i.sourceTitle}, {fmtDate(i.fetchedAt)}{i.note ? `. ${i.note}` : ''}</p><p className="ops-muted nl-break">{i.link}</p></div></li>
          ))}</ul>
        ) : <p className="ops-muted">Nothing found yet.</p>}</Loadable>
      </SectionCard>
      <Loadable state={stats}>{(a) => (
        <SectionCard title="How the feeds are doing">
          <div className="kpi-grid">
            <Tile label="Items found" value={a.totals.found} /><Tile label="Candidates" value={a.totals.candidates} />
            <Tile label="Published" value={a.totals.accepted} /><Tile label="Details kept as extracted" value={a.accuracy.keptAsExtractedPct === null ? 'None yet' : `${a.accuracy.keptAsExtractedPct}%`} />
          </div>
          <div className="nl-table-wrap">
            <table className="nl-table">
              <thead><tr><th scope="col">Feed</th><th scope="col">Found</th><th scope="col">Candidates</th><th scope="col">Duplicates</th><th scope="col">Skipped</th><th scope="col">Published</th><th scope="col">Rejected</th><th scope="col">Waiting review</th></tr></thead>
              <tbody>{a.sources.map((r) => <tr key={r.id}><td>{r.title}</td><td>{r.found}</td><td>{r.candidates}</td><td>{r.duplicates}</td><td>{r.skipped}</td><td>{r.accepted}</td><td>{r.rejected}</td><td>{r.pending}</td></tr>)}</tbody>
            </table>
          </div>
          {a.accuracy.byField.length > 0 && <p className="ops-muted">Most edited before publishing: {a.accuracy.byField.slice(0, 4).map((f) => `${FIELD_LABELS[f.field] ?? f.field} (${f.edited} of ${f.extracted})`).join(', ')}.</p>}
          <DataNote>{a.accuracy.note}</DataNote>
        </SectionCard>
      )}</Loadable>
    </div>
  );
}
