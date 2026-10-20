'use client';
import { EvidenceFooter } from '@/components/evidence-footer';
import { useState } from 'react';
import { Button, Field, Select } from '@/components/ui';
import { aiDraftsApi, DRAFT_KINDS, type DraftKind, type DraftResult } from '@/lib/green-api';
import { DataNote, ErrorNote, Loadable, SectionCard, humanize, useAction, useLoad } from './kit';

/**
 * AI drafts for staff: a letter, circular text, minutes from notes, a
 * lesson-plan outline or a report-card remark. The draft is shown here to copy
 * and edit; nothing is sent, published or saved. Without an AI key the draft
 * comes from a template and says so. Health, safeguarding and contact details
 * are removed before anything reaches a model; a remark sends only marks bands
 * and the attendance percentage.
 */
const KIND_LABEL: Record<DraftKind, string> = { LETTER: 'Letter', CIRCULAR: 'Circular', MINUTES: 'Minutes from notes', LESSON_PLAN: 'Lesson-plan outline', REPORT_REMARK: 'Report-card remark' };
type Band = { subject: string; band: string };

export function AiDraftsView() {
  const status = useLoad(() => aiDraftsApi.status(), []);
  const [kind, setKind] = useState<DraftKind>('LETTER');
  const [f, setF] = useState<Record<string, string>>({});
  const [bands, setBands] = useState<Band[]>([{ subject: '', band: 'B1' }]);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [copied, setCopied] = useState(false);
  const { run, busy, error } = useAction();
  const v = (k: string) => f[k] ?? '';
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const text = (k: string, label: string, rows = 0, hint?: string) => (
    <Field label={label} hint={hint}>{rows ? <textarea className="input" rows={rows} value={v(k)} onChange={set(k)} style={{ width: '100%' }} /> : <input className="input" value={v(k)} onChange={set(k)} />}</Field>
  );
  const body = (): Record<string, unknown> => {
    switch (kind) {
      case 'LETTER': return { kind, recipient: v('recipient'), subject: v('subject'), purpose: v('purpose'), points: v('points').split('\n'), tone: v('tone') || 'FORMAL', signOff: v('signOff') };
      case 'CIRCULAR': return { kind, title: v('title'), audience: v('audience'), date: v('date'), details: v('details'), actionRequired: v('actionRequired') };
      case 'MINUTES': return { kind, meetingTitle: v('meetingTitle'), date: v('date'), attendees: v('attendees'), notes: v('notes') };
      case 'LESSON_PLAN': return { kind, subject: v('subject'), grade: v('grade'), topic: v('topic'), durationMinutes: Number(v('durationMinutes')) || 40, objectives: v('objectives').split('\n') };
      case 'REPORT_REMARK': return { kind, studentFirstName: v('firstName'), bands: bands.filter((b) => b.subject), attendancePct: v('attendancePct') === '' ? null : Number(v('attendancePct')) };
      default: return { kind };
    }
  };
  return (
    <Loadable state={status}>
      {(st) => (
        <div className="drafts-view">
          <SectionCard title="Ask for a draft" sub={st.aiConfigured ? 'Drafts come from the school\'s AI model.' : 'No AI key is configured, so drafts come from templates.'}>
            <DataNote>A draft is never sent, published or saved. Copy it, edit it, and save it in the screen where it is used. Health, safeguarding and contact details are removed before anything reaches a model.</DataNote>
            <Select label="Draft" value={kind} onChange={(k) => { setKind(k as DraftKind); setResult(null); }} options={DRAFT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
            {kind === 'LETTER' && <>
              <div className="lab-form-grid">{text('recipient', 'To')}{text('subject', 'Subject')}{text('signOff', 'Sign off as')}
                <Select label="Tone" value={v('tone') || 'FORMAL'} onChange={(t) => setF({ ...f, tone: t })} options={[{ value: 'FORMAL', label: 'Formal' }, { value: 'WARM', label: 'Warm' }]} /></div>
              {text('purpose', 'What the letter is for', 3)}{text('points', 'Points to include (one per line)', 3)}
            </>}
            {kind === 'CIRCULAR' && <><div className="lab-form-grid">{text('title', 'Title')}{text('audience', 'For')}{text('date', 'Date')}</div>{text('details', 'Details', 4)}{text('actionRequired', 'Action required')}</>}
            {kind === 'MINUTES' && <><div className="lab-form-grid">{text('meetingTitle', 'Meeting')}{text('date', 'Date')}{text('attendees', 'Present')}</div>{text('notes', 'Your notes', 8, 'Rough notes are fine. Lines with "will", "action" or a deadline become actions.')}</>}
            {kind === 'LESSON_PLAN' && <><div className="lab-form-grid">{text('subject', 'Subject')}{text('grade', 'Class')}{text('topic', 'Topic')}{text('durationMinutes', 'Minutes')}</div>{text('objectives', 'Objectives (one per line)', 3)}</>}
            {kind === 'REPORT_REMARK' && <>
              <div className="lab-form-grid">{text('firstName', 'Pupil\'s first name', 0, 'Used only in the text shown to you; never sent to a model.')}{text('attendancePct', 'Attendance %')}</div>
              <fieldset className="drafts-bands"><legend>Marks bands</legend>
                {bands.map((b, i) => (
                  <div key={i} className="green-inline">
                    <Field label="Subject"><input className="input" value={b.subject} onChange={(e) => setBands((l) => l.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))} /></Field>
                    <Select label="Band" value={b.band} onChange={(band) => setBands((l) => l.map((x, j) => (j === i ? { ...x, band } : x)))} options={st.bands.map((x) => ({ value: x, label: humanize(x) }))} />
                  </div>
                ))}
                <Button small variant="soft" onClick={() => setBands((l) => [...l, { subject: '', band: 'B1' }])}>Add a subject</Button>
              </fieldset>
              <p className="ops-muted">Only the subject bands and attendance are used. Do not type health or behaviour details here.</p>
            </>}
            <Button disabled={busy} onClick={() => void run(async () => { setCopied(false); setResult(await aiDraftsApi.draft(body())); })}>{busy ? 'Drafting…' : 'Draft'}</Button>
            <ErrorNote error={error} />
          </SectionCard>
          {result && (
            <SectionCard title="Draft" sub={result.label} actions={<Button small variant="soft" onClick={() => { void navigator.clipboard?.writeText(result.text); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</Button>}>
              <p className={`drafts-label drafts-${result.source.toLowerCase()}`}>{result.label}</p>
              {result.redactions > 0 && <p className="ops-muted">{result.redactions} restricted or contact detail(s) were removed before drafting.</p>}
              <textarea className="input drafts-output" rows={14} value={result.text} onChange={(e) => setResult({ ...result, text: e.target.value })} aria-label="Draft text" />
              <DataNote>{result.note}</DataNote>
              {result.basedOn && <EvidenceFooter note={result.basedOn.source} items={result.basedOn.items.map((x) => ({ text: `${x.label}: ${x.value}` }))} />}
            </SectionCard>
          )}
        </div>
      )}
    </Loadable>
  );
}
