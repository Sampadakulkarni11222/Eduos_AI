'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { usePortalHref } from '@/lib/school-path';
import { portfolioApi, type CompetencyDto, type PortfolioDto } from '@/lib/p2-api';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tile, fmtDate, humanize, useAction, useLoad, useQueryParam } from './kit';

/**
 * Competency portfolio (CBSE/NEP competencies): evidence read from the
 * school's own records plus teacher evidence, a three-level rubric per
 * competency (developing, proficient, advanced; no scores, nothing about
 * behaviour), the student's reflections, and a PDF for the family.
 * Families and students see only their own.
 */
const LEVEL_TONE: Record<string, string> = { DEVELOPING: 'PENDING', PROFICIENT: 'IN_PROGRESS', ADVANCED: 'COMPLETED' };
const KIND_LABEL: Record<string, string> = { ASSIGNMENT: 'Assignment', REPORT_CARD: 'Report card', CLUB: 'Club', FIXTURE: 'Fixture', SHOWCASE: 'Showcase', LAB_PRACTICAL: 'Lab practical', ECO_ACTIVITY: 'Eco activity', CO_CURRICULAR: 'Co-curricular', TEACHER: 'Teacher evidence' };

function Competency({ c, p, onChanged }: { c: CompetencyDto; p: PortfolioDto; onChanged: () => void }) {
  const href = usePortalHref();
  const [mode, setMode] = useState<null | 'rate' | 'evidence' | 'reflect'>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const shown = open ? c.evidence : c.evidence.slice(0, 4);
  return (
    <div className="pf-card">
      <div className="pf-head">
        <div><div className="pf-title">{c.label}</div><div className="pf-desc">{c.description}</div></div>
        {c.rating ? <StatusPill status={LEVEL_TONE[c.rating.level]} label={`${c.rating.levelLabel} · ${c.rating.term}`} /> : <span className="ops-muted">Not rated yet</span>}
      </div>
      {c.rating?.comment && <p className="pf-comment">“{c.rating.comment}” <span className="ops-muted">· {c.rating.ratedByName}</span></p>}
      {!c.evidence.length ? <p className="ops-muted">No evidence yet.</p> : (
        <ul className="pf-evidence">{shown.map((e, i) => (
          <li key={`${e.kind}-${e.id ?? i}`}><span className="pf-kind">{KIND_LABEL[e.kind] ?? humanize(e.kind)}</span> {e.link && e.link.startsWith('/') ? <Link href={href(e.link)}>{e.title}</Link> : e.link ? <a href={e.link} target="_blank" rel="noreferrer">{e.title}</a> : e.title}<span className="ops-muted"> · {e.detail ?? e.description ?? ''}{e.on ? ` · ${fmtDate(e.on)}` : ''}</span></li>
        ))}</ul>
      )}
      {c.evidence.length > 4 && <button type="button" className="ops-row-link pf-more" onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : `Show all ${c.evidence.length}`}</button>}
      {!!c.reflections.length && <div className="pf-reflections">{c.reflections.map((r) => <p key={r.id}><b>Reflection</b> ({fmtDate(r.at)}): {r.text}</p>)}</div>}
      <div className="ops-inline">
        {p.canManage && <Button small variant="soft" onClick={() => { setMode('rate'); setF({ level: c.rating?.level ?? 'DEVELOPING', term: p.term, comment: '' }); }}>Rate</Button>}
        {p.canManage && <Button small variant="ghost" onClick={() => { setMode('evidence'); setF({}); }}>+ Evidence</Button>}
        {p.canReflect && <Button small variant="ghost" onClick={() => { setMode('reflect'); setF({}); }}>+ My reflection</Button>}
      </div>
      {mode && (
        <Modal title={`${{ rate: 'Rate', evidence: 'Add evidence', reflect: 'My reflection' }[mode]}: ${c.label}`} onClose={() => setMode(null)} footer={<><Button variant="soft" onClick={() => setMode(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => {
          if (mode === 'rate') await portfolioApi.rate(p.student.id, { competencyKey: c.key, level: f.level, term: f.term, comment: f.comment });
          if (mode === 'evidence') await portfolioApi.addEvidence(p.student.id, { competencyKey: c.key, title: f.title, description: f.description, link: f.link || null, on: f.on || undefined });
          if (mode === 'reflect') await portfolioApi.reflect(p.student.id, { competencyKey: c.key, text: f.text });
          toast('Saved', 'success'); setMode(null); onChanged();
        })}>Save</Button></>}>
          {mode === 'rate' && (<>
            <div className="ops-inline" role="radiogroup" aria-label="Level">{p.levels.map((l) => <label key={l.key}><input type="radio" name="level" checked={f.level === l.key} onChange={() => setF({ ...f, level: l.key })} /> {l.label}</label>)}</div>
            <Field label="Term"><input className="input" value={f.term ?? ''} onChange={(e) => setF({ ...f, term: e.target.value })} /></Field>
            <Field label="Comment (what the evidence shows)"><textarea className="input" rows={3} value={f.comment ?? ''} onChange={(e) => setF({ ...f, comment: e.target.value })} style={{ width: '100%' }} /></Field>
            <DataNote>A rubric level, never a score or a behaviour rating.</DataNote>
          </>)}
          {mode === 'evidence' && (<div className="ops-form-grid">
            <Field label="What the student did" required><input className="input" value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Date"><input className="input" type="date" value={f.on ?? ''} onChange={(e) => setF({ ...f, on: e.target.value })} /></Field>
            <Field label="Details"><input className="input" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Link (https:// or an EduOS page)"><input className="input" value={f.link ?? ''} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
          </div>)}
          {mode === 'reflect' && <Field label="What I learned, what I am proud of, what I will try next" required><textarea className="input" rows={4} value={f.text ?? ''} onChange={(e) => setF({ ...f, text: e.target.value })} style={{ width: '100%' }} /></Field>}
          <ErrorNote error={error} />
        </Modal>
      )}
    </div>
  );
}

export function PortfolioView() {
  const [search, setSearch] = useState('');
  const students = useLoad(() => portfolioApi.students(search ? { search } : {}), [search]);
  const preset = useQueryParam('student');
  const [studentId, setStudentId] = useState<string | null>(preset);
  useEffect(() => { if (!studentId && students.data?.length === 1) setStudentId(students.data[0].studentId); }, [students.data, studentId]);
  const state = useLoad(() => (studentId ? portfolioApi.get(studentId) : Promise.resolve(null)), [studentId]);
  const { run, busy, error } = useAction();
  return (
    <div className="ops-stack">
      {(students.data?.length ?? 0) !== 1 && (
        <SectionCard title="Student">
          <div className="ops-form-grid">
            <Field label="Find"><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or admission no." /></Field>
            <Field label="Student"><select className="input" value={studentId ?? ''} onChange={(e) => setStudentId(e.target.value || null)}><option value="">Choose…</option>{(students.data ?? []).map((s) => <option key={s.studentId} value={s.studentId}>{s.name}{s.className ? ` · ${s.className}` : ''}</option>)}</select></Field>
          </div>
        </SectionCard>
      )}
      {!studentId ? <EmptyState title="Choose a student" sub="Portfolios show evidence from school records, rubric levels and the student's reflections." /> : (
        <Loadable state={state}>{(p) => p && (
          <>
            <SectionCard title={`${p.student.name}${p.student.className ? ` · ${p.student.className}` : ''}`} sub={`Competency portfolio · ${p.term}`} actions={<Button small variant="soft" disabled={busy} onClick={() => void run(() => portfolioApi.openPdf(p.student.id))}>Download PDF</Button>}>
              <div className="kpi-grid"><Tile label="Evidence items" value={p.counts.evidence} /><Tile label="From school records" value={p.counts.fromRecords} /><Tile label="Added by teachers" value={p.counts.teacherAdded} /><Tile label="Competencies rated" value={`${p.counts.rated} of ${p.competencies.length}`} /><Tile label="Reflections" value={p.counts.reflections} /></div>
              <DataNote>{p.note}</DataNote>
              <ErrorNote error={error} />
            </SectionCard>
            {['Core', 'Subject'].map((g) => (
              <SectionCard key={g} title={g === 'Core' ? 'Core competencies' : 'Subject competencies'}>
                <div className="pf-grid">{p.competencies.filter((c) => c.group === g).map((c) => <Competency key={c.key} c={c} p={p} onChanged={() => void state.reload()} />)}</div>
              </SectionCard>
            ))}
          </>
        )}</Loadable>
      )}
    </div>
  );
}
