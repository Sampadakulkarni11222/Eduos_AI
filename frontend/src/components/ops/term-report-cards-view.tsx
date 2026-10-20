'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { openReportCardPdf, reportCardsApi, type RcCard, type RcPublished } from '@/lib/reportcards-api';
import { Drawer } from './drawer';
import {
  DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Timeline, fmtDate, humanize, useAction, useLoad,
} from './kit';

/**
 * Term report cards. Class teachers prepare and approve their class's cards,
 * subject teachers enter the hand-marked components of their subjects, the
 * principal approves and publishes; families and students view and download
 * their own published cards, every version kept.
 */

const STATUS_PILL: Record<string, string> = { DRAFT: 'DRAFT', CLASS_TEACHER_APPROVED: 'IN_REVIEW', PRINCIPAL_APPROVED: 'APPROVED', PUBLISHED: 'PUBLISHED' };
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', CLASS_TEACHER_APPROVED: 'Class teacher approved', PRINCIPAL_APPROVED: 'Principal approved', PUBLISHED: 'Published' };

export function CardBody({ card }: { card: RcCard }) {
  return (
    <div className="ops-stack rc-card">
      <div className="rc-table-wrap">
        <table className="ops-table rc-table">
          <thead><tr><th>Subject</th>{card.components.map((c) => <th key={c.key}>{c.label}<span className="ops-muted"> /{c.maxMarks}</span></th>)}<th>Total</th><th>%</th><th>Grade</th></tr></thead>
          <tbody>
            {card.scholastic.map((r) => (
              <tr key={r.subjectOfferingId}><td>{r.subject}</td>
                {card.components.map((c) => { const cell = r.components[c.key]; return <td key={c.key} className={cell?.status !== 'OK' ? 'rc-pending' : undefined}>{!cell ? '—' : cell.status === 'ABSENT' ? (cell.absence ?? 'AB') : cell.value === null ? (cell.status === 'NO_EXAM' ? 'no exam' : 'pending') : cell.value}</td>; })}
                <td>{r.total}/{r.maxMarks}</td><td>{r.percentage ?? '—'}</td><td><b>{r.grade ?? '—'}</b></td></tr>
            ))}
            {card.summary && <tr className="rc-total"><td>Overall</td>{card.components.map((c) => <td key={c.key} />)}<td>{card.summary.total}/{card.summary.maxMarks}</td><td>{card.summary.percentage ?? '—'}</td><td><b>{card.summary.grade ?? '—'}</b></td></tr>}
          </tbody>
        </table>
      </div>
      <KeyValues rows={[
        ...card.coScholasticAreas.map((a) => [a.label, card.coScholastic[a.key] ?? '—'] as [string, string]),
        [card.disciplineLabel, card.discipline ?? '—'],
        ['Attendance', card.attendance?.workingDays ? `${card.attendance.present} of ${card.attendance.workingDays} days (${card.attendance.percentage}%)` : 'No register marks'],
        ['Class teacher\'s remarks', card.classTeacherRemarks ?? '—'],
        ['Result', card.resultLine ?? '—'],
      ]} />
    </div>
  );
}

function CardEditor({ id, role, onClose, onChanged }: { id: string; role: 'ALL' | 'CLASS_TEACHER' | 'SUBJECT_TEACHER'; onClose: () => void; onChanged: () => void }) {
  const card = useLoad(() => reportCardsApi.get(id), [id]);
  const [draft, setDraft] = useState<{ coScholastic: Record<string, string | null>; discipline: string | null; remarks: string; manual: Record<string, Record<string, string>> } | null>(null);
  const [prompt, setPrompt] = useState<null | 'return' | 'publish' | 'self'>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const c = card.data;
  const d = draft ?? (c ? { coScholastic: { ...c.coScholastic }, discipline: c.discipline, remarks: c.classTeacherRemarks ?? '', manual: Object.fromEntries(Object.entries(c.manualMarks ?? {}).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, vv === null ? '' : String(vv)]))])) } : null);
  const classSide = role === 'ALL' || role === 'CLASS_TEACHER';
  const after = async (msg: string) => { setDraft(null); await card.reload(); onChanged(); toast(msg, 'success'); };
  const save = () => void run(async () => {
    if (!c || !d) return;
    const manualMarks = Object.fromEntries(Object.entries(d.manual).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, vv === '' ? null : Number(vv)]))]));
    await reportCardsApi.update(id, { ...(classSide ? { coScholastic: d.coScholastic, discipline: d.discipline, classTeacherRemarks: d.remarks } : {}), ...(Object.keys(manualMarks).length ? { manualMarks } : {}) });
    await after('Saved');
  });
  const manualComps = c?.components.filter((x) => x.source === 'MANUAL') ?? [];
  return (
    <Drawer title={c ? `${c.studentName} · ${c.termName}` : 'Report card'} sub={c ? `${c.className}${c.rollNo ? ` · roll ${c.rollNo}` : ''} · ${STATUS_LABEL[c.status]}${c.publishedVersion ? ` · published v${c.publishedVersion}` : ''}` : undefined} onClose={onClose} footer={c && d && (
      <>
        {c.status !== 'DRAFT' && classSide && <Button variant="ghost" onClick={() => setPrompt('return')}>Return to draft</Button>}
        <Button variant="soft" disabled={busy} onClick={save}>Save</Button>
        {c.status === 'DRAFT' && classSide && <Button disabled={busy} onClick={() => void run(async () => { await reportCardsApi.moderate(id, 'CLASS_TEACHER'); await after('Approved as class teacher'); })}>Approve (class teacher)</Button>}
        {c.status === 'CLASS_TEACHER_APPROVED' && role === 'ALL' && <Button disabled={busy} onClick={() => void run(async () => { await reportCardsApi.moderate(id, 'PRINCIPAL'); await after('Approved'); })}>Approve (principal)</Button>}
        {c.status === 'CLASS_TEACHER_APPROVED' && role === 'ALL' && <Button variant="ghost" onClick={() => setPrompt('self')}>Approve with a note</Button>}
        {c.status === 'PRINCIPAL_APPROVED' && role === 'ALL' && <Button disabled={busy} onClick={() => (c.publishedVersion ? setPrompt('publish') : void run(async () => { await reportCardsApi.publish(id); await after('Published; the family is told'); }))}>{c.publishedVersion ? 'Publish correction' : 'Publish'}</Button>}
      </>
    )}>
      <Loadable state={card}>{(x) => d && (
        <div className="ops-stack">
          <StatusPill status={STATUS_PILL[x.status]} label={STATUS_LABEL[x.status]} />
          {x.summary && !x.summary.complete && <p className="ops-callout is-warn">Marks still pending for {x.summary.pendingSubjects.join(', ')}. Only published marks are used; enter the hand-marked components below.</p>}
          <CardBody card={x} />
          {manualComps.length > 0 && (
            <SectionCard title="Hand-marked components" sub={role === 'SUBJECT_TEACHER' ? 'Your subjects only.' : undefined}>
              <table className="ops-table"><thead><tr><th>Subject</th>{manualComps.map((m) => <th key={m.key}>{m.label} /{m.maxMarks}</th>)}</tr></thead><tbody>
                {x.scholastic.map((r) => <tr key={r.subjectOfferingId}><td>{r.subject}</td>{manualComps.map((m) => <td key={m.key}><input className="input staff-num" type="number" min={0} max={m.maxMarks} step="0.5" aria-label={`${r.subject} ${m.label}`} value={d.manual[r.subjectOfferingId]?.[m.key] ?? ''} onChange={(e) => setDraft({ ...d, manual: { ...d.manual, [r.subjectOfferingId]: { ...(d.manual[r.subjectOfferingId] ?? {}), [m.key]: e.target.value } } })} /></td>)}</tr>)}
              </tbody></table>
            </SectionCard>
          )}
          {classSide && (
            <SectionCard title="Co-scholastic, discipline and remarks">
              <div className="ops-grid-2">
                {x.coScholasticAreas.map((a) => <Field key={a.key} label={a.label}><select className="input" value={d.coScholastic[a.key] ?? ''} onChange={(e) => setDraft({ ...d, coScholastic: { ...d.coScholastic, [a.key]: e.target.value || null } })}><option value="">—</option>{x.coScholasticGrades.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>)}
                <Field label={x.disciplineLabel}><select className="input" value={d.discipline ?? ''} onChange={(e) => setDraft({ ...d, discipline: e.target.value || null })}><option value="">—</option>{x.coScholasticGrades.map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
              </div>
              <Field label="Class teacher's remarks" hint="About learning and effort. Never a health or personality judgement."><textarea className="input" rows={3} maxLength={600} value={d.remarks} onChange={(e) => setDraft({ ...d, remarks: e.target.value })} /></Field>
            </SectionCard>
          )}
          <SectionCard title="History"><Timeline items={x.history} /></SectionCard>
          <ErrorNote error={error} />
        </div>
      )}</Loadable>
      {prompt === 'return' && <PromptModal title="Return to draft" label="What needs changing?" onClose={() => setPrompt(null)} onSubmit={async (v) => { await reportCardsApi.returnToDraft(id, v); await after('Returned to draft'); }} />}
      {prompt === 'self' && <PromptModal title="Approve as principal" label="Note (needed if you also approved it as class teacher)" onClose={() => setPrompt(null)} onSubmit={async (v) => { await reportCardsApi.moderate(id, 'PRINCIPAL', { selfModerationReason: v }); await after('Approved'); }} />}
      {prompt === 'publish' && <PromptModal title="Publish a corrected version" label="What was corrected (the family sees this)" onClose={() => setPrompt(null)} onSubmit={async (v) => { await reportCardsApi.publish(id, v); await after('Correction published'); }} />}
    </Drawer>
  );
}

function StaffCards() {
  const { permissions } = usePermissions();
  const principal = permissions['reportcards.manage'] === 'ALL';
  const sections = useLoad(() => reportCardsApi.sections(), []);
  const templates = useLoad(() => reportCardsApi.templates(), []);
  const [sel, setSel] = useState<{ sectionId: string; termKey: string; templateId: string }>({ sectionId: '', termKey: 'TERM_1', templateId: '' });
  const tpl = templates.data?.find((t) => t.id === sel.templateId) ?? templates.data?.[0];
  const sectionId = sel.sectionId || sections.data?.[0]?.id || '';
  const role = sections.data?.find((s) => s.id === sectionId)?.role ?? 'SUBJECT_TEACHER';
  const cards = useLoad(() => (sectionId && tpl ? reportCardsApi.list({ sectionId, termKey: sel.termKey, templateId: tpl.id }) : Promise.resolve([] as RcCard[])), [sectionId, sel.termKey, tpl?.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<null | 'CLASS_TEACHER_APPROVE' | 'PRINCIPAL_APPROVE' | 'PUBLISH'>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const counts = (cards.data ?? []).reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  return (
    <div className="ops-stack">
      <div className="ops-grid-2">
        <Loadable state={sections}>{(list) => <Field label="Class"><select className="input" value={sectionId} onChange={(e) => setSel({ ...sel, sectionId: e.target.value })}>{list.map((s) => <option key={s.id} value={s.id}>{s.label}{s.role === 'CLASS_TEACHER' ? ' (class teacher)' : ''}</option>)}</select></Field>}</Loadable>
        <Loadable state={templates}>{(list) => <Field label="Template and term"><div className="ops-inline">
          <select className="input" value={tpl?.id ?? ''} onChange={(e) => setSel({ ...sel, templateId: e.target.value })}>{list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select className="input" value={sel.termKey} onChange={(e) => setSel({ ...sel, termKey: e.target.value })} aria-label="Term">{(tpl?.terms ?? []).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select>
        </div></Field>}</Loadable>
      </div>
      {tpl && <DataNote>{tpl.terms.find((t) => t.key === sel.termKey)?.components.map((c) => `${c.label} ${c.maxMarks}${c.source === 'EXAM' ? ` (from "${c.examName}")` : ' (entered by the subject teacher)'}`).join(' · ')}. Only published marks are used. Co-scholastic areas are graded {tpl.coScholasticGrades.join('/')}.</DataNote>}
      <div className="ops-inline">
        {(role === 'CLASS_TEACHER' || role === 'ALL') && <Button disabled={busy || !sectionId} onClick={() => void run(async () => { const r = await reportCardsApi.generate({ sectionId, termKey: sel.termKey, templateId: tpl?.id }); toast(`${r.created} prepared, ${r.refreshed} refreshed from published marks`, 'success'); await cards.reload(); })}>Prepare / refresh from published marks</Button>}
        {(role === 'CLASS_TEACHER' || role === 'ALL') && (counts.DRAFT ?? 0) > 0 && <Button variant="soft" onClick={() => setBulkConfirm('CLASS_TEACHER_APPROVE')}>Approve all complete drafts</Button>}
        {principal && (counts.CLASS_TEACHER_APPROVED ?? 0) > 0 && <Button variant="soft" onClick={() => setBulkConfirm('PRINCIPAL_APPROVE')}>Approve all ({counts.CLASS_TEACHER_APPROVED})</Button>}
        {principal && (counts.PRINCIPAL_APPROVED ?? 0) > 0 && <Button onClick={() => setBulkConfirm('PUBLISH')}>Publish approved ({counts.PRINCIPAL_APPROVED})</Button>}
      </div>
      <Loadable state={cards}>{(list) => !list.length ? <EmptyState title="No cards for this class and term" sub={role === 'SUBJECT_TEACHER' ? 'The class teacher prepares the cards; you then enter your subject\'s hand-marked components.' : 'Prepare them from published marks.'} /> : (
        <ul className="ops-list card card-pad">{list.map((c) => (
          <li key={c.id} className="ops-row">
            <div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(c.id)}><div className="ops-row-title">{c.rollNo ? `${c.rollNo}. ` : ''}{c.studentName}</div><div className="ops-row-sub">{c.summary?.percentage ?? '—'}% · {c.summary?.grade ?? '—'}{c.summary && !c.summary.complete ? ` · pending: ${c.summary.pendingSubjects.join(', ')}` : ''}</div></button></div>
            <StatusPill status={STATUS_PILL[c.status]} label={`${STATUS_LABEL[c.status]}${c.publishedVersion ? ` v${c.publishedVersion}` : ''}`} />
          </li>
        ))}</ul>
      )}</Loadable>
      <ErrorNote error={error} />
      {open && <CardEditor id={open} role={role} onClose={() => setOpen(null)} onChanged={() => void cards.reload()} />}
      {bulkConfirm && (
        <Modal title={humanize(bulkConfirm)} onClose={() => setBulkConfirm(null)} footer={<><Button variant="ghost" onClick={() => setBulkConfirm(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => {
          const r = await reportCardsApi.bulk({ action: bulkConfirm, sectionId, termKey: sel.termKey, templateId: tpl?.id });
          toast(`${r.done} done${r.failed.length ? `, ${r.failed.length} not ready` : ''}`, r.failed.length ? 'info' : 'success');
          setBulkConfirm(null); await cards.reload();
        })}>Go ahead</Button></>}>
          <p>{bulkConfirm === 'PUBLISH' ? 'Publishing writes a version each family can see and download, and tells them. Corrections later publish a new version; this one is kept.' : 'Cards that are not complete are skipped and listed.'}</p>
        </Modal>
      )}
    </div>
  );
}

function FamilyCards() {
  const list = useLoad(() => reportCardsApi.published(), []);
  const [older, setOlder] = useState<{ versionId: string; label: string } | null>(null);
  const olderCard = useLoad(() => (older ? reportCardsApi.version(older.versionId) : Promise.resolve(null)), [older?.versionId]);
  const { run, error } = useAction();
  return (
    <div className="ops-stack">
      <Loadable state={list}>{(rows: RcPublished[]) => !rows.length ? <EmptyState title="No report cards published yet" sub="Term report cards appear here when the school publishes them." /> : (
        <>{rows.map((r) => (
          <SectionCard key={r.cardId} title={`${r.card.studentName} · ${r.card.termName}`} sub={`${r.card.className} · published ${fmtDate(r.publishedAt)}${r.version > 1 ? ` · corrected version ${r.version}` : ''}`}
            actions={<Button small onClick={() => void run(() => openReportCardPdf(r.versionId))}>Download PDF</Button>}>
            {r.correctionNote && <p className="ops-callout">Corrected: {r.correctionNote}</p>}
            <CardBody card={r.card} />
            {r.olderVersions.length > 0 && <p className="ops-muted">Earlier versions: {r.olderVersions.map((o) => <button key={o.versionId} type="button" className="ops-row-link rc-version" onClick={() => setOlder({ versionId: o.versionId, label: `version ${o.version}` })}>version {o.version} ({fmtDate(o.publishedAt)})</button>)}</p>}
          </SectionCard>
        ))}</>
      )}</Loadable>
      <ErrorNote error={error} />
      {older && <Drawer title={`Superseded ${older.label}`} onClose={() => setOlder(null)}><Loadable state={olderCard}>{(v) => (v ? <CardBody card={v.card} /> : null)}</Loadable></Drawer>}
    </div>
  );
}

export function TermReportCardsView() {
  const { permissions } = usePermissions();
  if (permissions['reportcards.manage']) return <StaffCards />;
  if (permissions['reportcards.read']) return <FamilyCards />;
  return <EmptyState title="Not available" sub="Report cards are not part of your role." />;
}
