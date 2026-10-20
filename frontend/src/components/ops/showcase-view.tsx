'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import { usePortalHref } from '@/lib/school-path';
import { showcaseApi, type DraftEntry, type Edition, type PublishedEntry, type PublishedShowcase, type RankPreview } from '@/lib/clubs-api';
import { Drawer } from './drawer';
import {
  DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Timeline, fmtDate, humanize, useAction, useLoad,
} from './kit';

/**
 * The school showcase: previous class and term top rankers and achievements
 * in sports, arts and olympiads.
 *
 * Everyone reads the published showcase. Holders of showcase.publish
 * (administration, principal, marketing; never students or families) draft
 * entries — ranks drawn from published results up to the school's cut-off,
 * achievements from approved records and results — have someone else review
 * them, and publish. Consent is checked again at publishing; an entry without
 * it is left out and says why.
 */

const ICON: Record<string, string> = { ACADEMIC: '🎓', SPORTS: '🏅', ARTS: '🎭', OLYMPIAD: '🔬', SERVICE: '🤝', OTHER: '★' };
const FAMILY = ['STUDENT', 'PARENT', 'ALUMNUS'];

function Medal({ rank }: { rank: number | null }) {
  if (!rank) return null;
  return <span className={`showcase-medal r${Math.min(rank, 4)}`} aria-label={`Rank ${rank}`}>{rank}</span>;
}

function EntryTile({ e }: { e: PublishedEntry }) {
  return (
    <li className={`showcase-tile cat-${e.category.toLowerCase()}`}>
      <div className="showcase-tile-top">{e.kind === 'RANK' ? <Medal rank={e.rank} /> : <span className="showcase-icon" aria-hidden="true">{ICON[e.category] ?? '★'}</span>}<span className="showcase-cat">{humanize(e.category)}</span></div>
      <div className="showcase-name">{e.studentName}</div>
      <div className="showcase-title">{e.title}</div>
      {(e.detail || e.level) && <div className="showcase-detail">{[e.detail, e.level && e.kind !== 'RANK' ? humanize(e.level) : null].filter(Boolean).join(' · ')}</div>}
    </li>
  );
}

export function PublishedShowcaseView({ data }: { data: PublishedShowcase }) {
  const [cat, setCat] = useState('ALL');
  if (!data.editions.length) return <EmptyState icon="🏆" title="Nothing published yet" sub="Top rankers and achievements appear here once the school publishes them." />;
  return (
    <div className="ops-stack">
      <div className="ops-inline" role="group" aria-label="Filter">
        {['ALL', 'ACADEMIC', 'SPORTS', 'ARTS', 'OLYMPIAD'].map((c) => <Button key={c} small variant={cat === c ? 'accent' : 'soft'} onClick={() => setCat(c)}>{c === 'ALL' ? 'Everything' : humanize(c)}</Button>)}
      </div>
      {data.editions.map((ed) => {
        const rows = ed.entries.filter((e) => cat === 'ALL' || e.category === cat);
        if (!rows.length) return null;
        return (
          <SectionCard key={ed.id} title={ed.title} sub={`${ed.periodLabel ? `${ed.periodLabel} · ` : ''}published ${fmtDate(ed.publishedAt)}`}>
            {ed.description && <p className="ops-muted">{ed.description}</p>}
            <ul className="showcase-grid">{rows.map((e) => <EntryTile key={e.id} e={e} />)}</ul>
          </SectionCard>
        );
      })}
      <DataNote>Ranks come from published exam results; equal marks share a rank and the next rank is skipped. Only the top {data.rankCutoff} are shown, and a child appears only with their family&apos;s consent.</DataNote>
    </div>
  );
}

/** A dashboard card: the latest published honours. */
export function ShowcaseCard({ limit = 6 }: { limit?: number }) {
  const link = usePortalHref();
  const { permissions } = usePermissions();
  const state = useLoad(() => (permissions['institution.read'] ? showcaseApi.published({ limit }) : Promise.resolve(null)), [limit, Boolean(permissions['institution.read'])]);
  if (!permissions['institution.read']) return null;
  const items = state.data?.highlights ?? [];
  if (!state.loading && !items.length) return null;
  return (
    <Card className="showcase-card">
      <div className="showcase-card-head"><strong>🏆 School showcase</strong><Link href={link('/showcase')} className="showcase-card-link">See all →</Link></div>
      {state.error ? <p className="ops-muted">{state.error}</p> : (
        <ul className="showcase-strip">{items.slice(0, limit).map((e) => (
          <li key={e.id}>{e.kind === 'RANK' ? <Medal rank={e.rank} /> : <span className="showcase-icon" aria-hidden="true">{ICON[e.category] ?? '★'}</span>}<div><div className="showcase-name">{e.studentName}</div><div className="showcase-detail">{e.title}{e.detail ? ` · ${e.detail}` : ''}</div></div></li>
        ))}</ul>
      )}
    </Card>
  );
}

// ── preparing (publishers) ─────────────────────────────────────────────

const ENTRY_PILL: Record<string, string> = { DRAFT: 'DRAFT', REVIEWED: 'APPROVED', PUBLISHED: 'PUBLISHED', EXCLUDED: 'BLOCKED', WITHDRAWN: 'WITHDRAWN' };

function DrawRanks({ editionId, onDone }: { editionId: string; onDone: () => void }) {
  const opts = useLoad(() => showcaseApi.options(), []);
  const [f, setF] = useState({ examId: '', scope: 'SECTION', sectionId: '', gradeId: '' });
  const [preview, setPreview] = useState<RankPreview | null>(null);
  const { run, busy, error } = useAction();
  const query = { examId: f.examId, ...(f.scope === 'SECTION' ? { sectionId: f.sectionId } : { gradeId: f.gradeId }) };
  const ready = f.examId && (f.scope === 'SECTION' ? f.sectionId : f.gradeId);
  return (
    <SectionCard title="Draw top ranks" sub="From published results only. Only ranks up to the school's cut-off are ever shown.">
      <Loadable state={opts}>{(o) => !o.exams.length ? <p className="ops-muted">No exam has published results yet.</p> : (
        <>
          <div className="ops-grid-2">
            <Field label="Exam"><select className="input" value={f.examId} onChange={(e) => { setF({ ...f, examId: e.target.value }); setPreview(null); }}><option value="">Choose…</option>{o.exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Across"><select className="input" value={f.scope} onChange={(e) => { setF({ ...f, scope: e.target.value }); setPreview(null); }}><option value="SECTION">A class</option><option value="GRADE">A whole grade</option></select></Field>
            {f.scope === 'SECTION'
              ? <Field label="Class"><select className="input" value={f.sectionId} onChange={(e) => { setF({ ...f, sectionId: e.target.value }); setPreview(null); }}><option value="">Choose…</option>{o.sections.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
              : <Field label="Grade"><select className="input" value={f.gradeId} onChange={(e) => { setF({ ...f, gradeId: e.target.value }); setPreview(null); }}><option value="">Choose…</option>{o.grades.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
          </div>
          <div className="ops-inline">
            <Button variant="soft" disabled={busy || !ready} onClick={() => void run(async () => setPreview(await showcaseApi.rankPreview(query)))}>Preview top {o.settings.rankCutoff}</Button>
            <Button disabled={busy || !preview} onClick={() => void run(async () => { await showcaseApi.draftRanks(editionId, query); setPreview(null); onDone(); })}>Add as drafts</Button>
          </div>
          {preview && (
            <ul className="ops-list">{preview.rows.map((r) => <li key={r.studentId} className="ops-row"><Medal rank={r.rank} /><div className="ops-row-main">{r.name}</div>{r.consent ? <StatusPill status="ACTIVE" label="Consent on record" /> : <StatusPill status="BLOCKED" label="No consent: will be left out" />}</li>)}</ul>
          )}
          {preview && <DataNote>{preview.tieRule}{preview.unranked ? ` ${preview.unranked} student(s) are not ranked (an absence or a missing paper).` : ''}</DataNote>}
        </>
      )}</Loadable>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function AddAchievement({ editionId, onDone }: { editionId: string; onDone: () => void }) {
  const cands = useLoad(() => showcaseApi.candidates(), []);
  const { run, busy, error } = useAction();
  const [manual, setManual] = useState(false);
  const [f, setF] = useState({ studentId: '', category: 'OLYMPIAD', title: '', detail: '', level: '' });
  return (
    <SectionCard title="Add achievements" sub="From approved co-curricular records and approved fixture results, or written in (an olympiad certificate)." actions={<Button small variant="soft" onClick={() => setManual(true)}>Write one in</Button>}>
      <Loadable state={cands}>{(rows) => !rows.length ? <p className="ops-muted">No approved achievements in the last year.</p> : (
        <ul className="ops-list">{rows.slice(0, 40).map((c) => (
          <li key={`${c.source}:${c.sourceId}:${c.studentId}:${c.title}`} className="ops-row">
            <span className="showcase-icon" aria-hidden="true">{ICON[c.category]}</span>
            <div className="ops-row-main"><div className="ops-row-title">{c.studentName}: {c.title}</div><div className="ops-row-sub">{c.detail} · {humanize(c.level)} · {fmtDate(c.on)}{c.consent ? '' : ' · no consent on record'}</div></div>
            <Button small disabled={busy} onClick={() => void run(async () => { await showcaseApi.addEntry(editionId, { studentId: c.studentId, category: c.category, title: c.title, detail: c.detail, level: c.level, source: c.source, sourceId: c.sourceId }); onDone(); })}>Add</Button>
          </li>
        ))}</ul>
      )}</Loadable>
      <ErrorNote error={error} />
      {manual && <Modal title="Write in an achievement" onClose={() => setManual(false)} footer={<><Button variant="ghost" onClick={() => setManual(false)}>Cancel</Button><Button disabled={busy || !f.studentId || !f.title.trim()} onClick={() => void run(async () => { await showcaseApi.addEntry(editionId, f); setManual(false); onDone(); })}>Add draft</Button></>}>
        <Field label="Student ID" required hint="From the student's record."><input className="input" value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['OLYMPIAD', 'SPORTS', 'ARTS', 'SERVICE', 'OTHER'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
        <Field label="Honour" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Gold, National Science Olympiad" /></Field>
        <Field label="Detail"><input className="input" value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        <Field label="Level"><input className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} placeholder="e.g. National" /></Field>
        <ErrorNote error={error} />
      </Modal>}
    </SectionCard>
  );
}

function EditionDrawer({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const ed = useLoad(() => showcaseApi.edition(id), [id]);
  const { run, busy, error } = useAction();
  const [withdrawing, setWithdrawing] = useState<DraftEntry | 'ALL' | null>(null);
  const [history, setHistory] = useState<DraftEntry | null>(null);
  const toast = useToast();
  const refresh = async () => { await ed.reload(); onChange(); };
  return (
    <Drawer title={ed.data?.title ?? 'Showcase'} sub={ed.data ? `${humanize(ed.data.status)} · cut-off top ${ed.data.settings.rankCutoff}` : undefined} onClose={onClose}>
      <Loadable state={ed}>{(e) => (
        <div className="ops-stack">
          <div className="ops-inline">
            {e.status !== 'WITHDRAWN' && <Button disabled={busy || (!e.counts.REVIEWED)} onClick={() => void run(async () => {
              const out = await showcaseApi.publish(e.id);
              toast(`${out.published} published${out.excluded.length ? `; ${out.excluded.length} left out (see reasons)` : ''}`, out.excluded.length ? 'info' : 'success');
              await refresh();
            })}>Publish reviewed ({e.counts.REVIEWED})</Button>}
            {e.status === 'PUBLISHED' && <Button variant="ghost" onClick={() => setWithdrawing('ALL')}>Withdraw the showcase</Button>}
          </div>
          <p className="ops-callout">Someone other than the person who drafted an entry reviews it. At publishing, each child&apos;s consent, the cut-off and the results are checked again; an entry that fails is left out with the reason.</p>
          <ErrorNote error={error} />
          <SectionCard title="Entries">
            {!e.entries.length ? <p className="ops-muted">No entries yet. Draw ranks or add achievements below.</p> : (
              <ul className="ops-list">{e.entries.map((x) => (
                <li key={x.id} className="ops-row">
                  {x.kind === 'RANK' ? <Medal rank={x.rank} /> : <span className="showcase-icon" aria-hidden="true">{ICON[x.category]}</span>}
                  <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setHistory(x)}><div className="ops-row-title">{x.studentName}: {x.title}</div>
                    <div className="ops-row-sub">{x.detail ?? ''}{x.draftedBy ? ` · drafted by ${x.draftedBy}` : ''}{x.reviewedBy ? ` · reviewed by ${x.reviewedBy}` : ''}{!x.consent && !['PUBLISHED', 'WITHDRAWN'].includes(x.status) ? ' · no consent on record' : ''}{x.excludedReason ? ` · left out: ${x.excludedReason}` : ''}</div></button></div>
                  <StatusPill status={ENTRY_PILL[x.status]} label={x.status === 'EXCLUDED' ? 'Left out' : humanize(x.status)} />
                  {x.status === 'DRAFT' && <Button small onClick={() => void run(async () => { await showcaseApi.review(x.id, 'APPROVE'); await refresh(); })}>Review: OK</Button>}
                  {x.status === 'REVIEWED' && <Button small variant="ghost" onClick={() => void run(async () => { await showcaseApi.review(x.id, 'RETURN'); await refresh(); })}>Send back</Button>}
                  {['DRAFT', 'REVIEWED', 'EXCLUDED'].includes(x.status) && <Button small variant="ghost" onClick={() => void run(async () => { await showcaseApi.removeEntry(x.id); await refresh(); })}>Remove</Button>}
                  {x.status === 'PUBLISHED' && <Button small variant="ghost" onClick={() => setWithdrawing(x)}>Withdraw</Button>}
                </li>
              ))}</ul>
            )}
          </SectionCard>
          {e.status !== 'WITHDRAWN' && <DrawRanks editionId={e.id} onDone={() => void refresh()} />}
          {e.status !== 'WITHDRAWN' && <AddAchievement editionId={e.id} onDone={() => { toast('Draft added', 'success'); void refresh(); }} />}
          <SectionCard title="History"><Timeline items={e.history} /></SectionCard>
        </div>
      )}</Loadable>
      {withdrawing && <PromptModal title={withdrawing === 'ALL' ? 'Withdraw the whole showcase' : `Withdraw ${withdrawing.studentName}`} label="Reason" danger confirmLabel="Withdraw" onClose={() => setWithdrawing(null)} onSubmit={async (v) => {
        if (withdrawing === 'ALL') await showcaseApi.withdrawEdition(id, v); else await showcaseApi.withdrawEntry(withdrawing.id, v);
        await refresh();
      }} />}
      {history && <Modal title={`${history.studentName}: ${history.title}`} onClose={() => setHistory(null)}><Timeline items={history.history} /></Modal>}
    </Drawer>
  );
}

function Prepare() {
  const list = useLoad(() => showcaseApi.editions(), []);
  const settings = useLoad(() => showcaseApi.options().then((o) => o.settings), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Edition | null>(null);
  const [f, setF] = useState({ title: '', periodLabel: '', description: '' });
  const [cutoff, setCutoff] = useState<string>('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <SectionCard title="Showcases" actions={<Button onClick={() => setCreating(true)}>New showcase</Button>}>
        <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No showcases yet" sub="Create one, draw the top ranks from published results and add achievements." /> : (
          <ul className="ops-list">{rows.map((r) => (
            <li key={r.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(r)}><div className="ops-row-title">{r.title}</div><div className="ops-row-sub">{r.periodLabel ?? ''} · {r.counts.DRAFT} draft, {r.counts.REVIEWED} reviewed, {r.counts.PUBLISHED} published{r.counts.EXCLUDED ? `, ${r.counts.EXCLUDED} left out` : ''}</div></button></div><StatusPill status={r.status} /></li>
          ))}</ul>
        )}</Loadable>
      </SectionCard>
      <SectionCard title="Rank cut-off" sub="The showcase never shows a rank below this, and never a full class list.">
        <Loadable state={settings}>{(s) => (
          <div className="ops-inline">
            <select className="input" aria-label="Show ranks up to" value={cutoff || String(s.rankCutoff)} onChange={(e) => setCutoff(e.target.value)}>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>Top {n}</option>)}</select>
            <Button small disabled={busy || !cutoff || cutoff === String(s.rankCutoff)} onClick={() => void run(async () => { await showcaseApi.saveSettings(Number(cutoff)); toast('Cut-off saved', 'success'); await settings.reload(); setCutoff(''); })}>Save</Button>
          </div>
        )}</Loadable>
        <ErrorNote error={error} />
      </SectionCard>
      {creating && <Modal title="New showcase" onClose={() => setCreating(false)} footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.title.trim()} onClick={() => void run(async () => { const ed = await showcaseApi.createEdition(f); setCreating(false); await list.reload(); setOpen(ed); })}>Create</Button></>}>
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Term 1 toppers and achievers" /></Field>
        <Field label="Period"><input className="input" value={f.periodLabel} onChange={(e) => setF({ ...f, periodLabel: e.target.value })} placeholder="e.g. Term 1, 2026-27" /></Field>
        <Field label="Introduction"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <ErrorNote error={error} />
      </Modal>}
      {open && <EditionDrawer id={open.id} onClose={() => setOpen(null)} onChange={() => void list.reload()} />}
    </div>
  );
}

export function ShowcaseView() {
  const { permissions } = usePermissions();
  const { me } = useAuth();
  const canPublish = Boolean(permissions['showcase.publish']) && !FAMILY.includes(me?.profile?.role ?? '');
  const [tab, setTab] = useState<'published' | 'prepare'>('published');
  const published = useLoad(() => showcaseApi.published({}), []);
  return (
    <div className="ops-stack">
      {canPublish && <Tabs tabs={[{ key: 'published', label: 'Published' }, { key: 'prepare', label: 'Prepare and publish' }]} value={tab} onChange={setTab} />}
      {tab === 'published' || !canPublish ? <Loadable state={published}>{(d) => <PublishedShowcaseView data={d} />}</Loadable> : <Prepare />}
    </div>
  );
}
