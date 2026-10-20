'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, EmptyState, Field, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { code128Bars } from '@/lib/code128';
import { libraryCopiesApi, type CopyDto, type ScanDto } from '@/lib/green-api';
import type { BookDto } from '@/lib/types';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, fmtDate, humanize, isoDay, useAction, useLoad } from './kit';

/**
 * Library labels and the scan desk.
 *
 * Every copy has an accession number from the school's one running series.
 * Labels print the number as text and as a Code 128 barcode drawn here as SVG.
 * A keyboard-wedge scanner types the code and presses Enter, so the desk is
 * an input box: scan the book, then the student's admission number, to issue;
 * scan the book alone to return it.
 */

export function Code128({ value, height = 44 }: { value: string; height?: number }) {
  let drawn: ReturnType<typeof code128Bars> | null = null;
  try { drawn = code128Bars(value); } catch { drawn = null; }
  if (!drawn) return <span className="ops-error">Cannot draw {value}</span>;
  return (
    <svg className="code128" viewBox={`0 0 ${drawn.width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`}>
      <rect x="0" y="0" width={drawn.width} height={height} fill="#fff" />
      {drawn.bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
    </svg>
  );
}

function Label({ copy, school }: { copy: CopyDto; school: string | null }) {
  return (
    <div className="lib-label">
      <div className="lib-label-school">{school ?? 'Library'}</div>
      <div className="lib-label-title">{copy.title}</div>
      <Code128 value={copy.accessionNo} />
      <div className="lib-label-code">{copy.accessionNo}</div>
      {copy.category && <div className="lib-label-meta">{copy.category}{copy.shelf ? ` · ${copy.shelf}` : ''}</div>}
    </div>
  );
}

function Labels() {
  const books = useLoad(() => api.listBooks({ resourceType: 'PHYSICAL', resourceKind: 'BOOK' }), []);
  const [bookId, setBookId] = useState('');
  const [count, setCount] = useState('');
  const [sheet, setSheet] = useState<{ school: string | null; labels: CopyDto[] } | null>(null);
  const { run, busy, error } = useAction();
  const loadSheet = (params: Record<string, string>) => void run(async () => setSheet(await libraryCopiesApi.labels(params)));
  return (
    <Loadable state={books}>
      {(list: BookDto[]) => {
        return (
          <>
            <SectionCard title="Accession numbers" sub="Give each physical copy its number. Without a count, every copy in the catalogue that has no number gets one; with a count, that many new copies are added.">
              <div className="green-inline">
                <Select label="Book" value={bookId} onChange={setBookId} placeholder="Choose a book" options={list.map((b) => ({ value: b.id, label: `${b.title} (${b.totalCopies ?? 0} copies)` }))} />
                <Field label="New copies (optional)"><input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
                <Button disabled={busy || !bookId} onClick={() => void run(async () => { await libraryCopiesApi.generate({ bookId, ...(count ? { count: Number(count) } : {}) }); setCount(''); setSheet(await libraryCopiesApi.labels({ bookId })); })}>Number copies</Button>
              </div>
              <div className="green-inline">
                <Button variant="soft" disabled={busy || !bookId} onClick={() => loadSheet({ bookId })}>Labels for this book</Button>
                <Button variant="soft" disabled={busy} onClick={() => loadSheet({})}>All labels not yet printed</Button>
              </div>
              <ErrorNote error={error} />
            </SectionCard>
            {sheet && (
              <SectionCard title={`Label sheet (${sheet.labels.length})`} actions={sheet.labels.length ? <>
                <Button small onClick={() => window.print()}>Print</Button>
                <Button small variant="soft" onClick={() => void run(async () => { await libraryCopiesApi.markPrinted(sheet.labels.map((l) => l.id)); })}>Mark as printed</Button>
              </> : null}>
                {sheet.labels.length === 0 ? <p className="ops-muted">No labels to print.</p> : <div className="lib-label-sheet">{sheet.labels.map((c) => <Label key={c.id} copy={c} school={sheet.school} />)}</div>}
                <DataNote>Print at 100% scale on A4 label sheets. Each barcode is Code 128 and carries the accession number shown under it.</DataNote>
              </SectionCard>
            )}
          </>
        );
      }}
    </Loadable>
  );
}

type DeskLog = { at: Date; ok: boolean; text: string };

function ScanDesk() {
  const [mode, setMode] = useState<'issue' | 'return'>('issue');
  const [code, setCode] = useState('');
  const [copy, setCopy] = useState<ScanDto | null>(null);
  const [student, setStudent] = useState('');
  const [due, setDue] = useState(isoDay(new Date(Date.now() + 14 * 86_400_000)));
  const [log, setLog] = useState<DeskLog[]>([]);
  const { run, busy, error, clearError } = useAction();
  const studentRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const note = (ok: boolean, text: string) => setLog((l) => [{ at: new Date(), ok, text }, ...l].slice(0, 20));
  const reset = () => { setCode(''); setCopy(null); setStudent(''); codeRef.current?.focus(); };
  // The desk is for scanning: the book box is ready as soon as the page opens.
  useEffect(() => { codeRef.current?.focus(); }, []);

  const onCode = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !code.trim()) return;
    e.preventDefault(); clearError();
    void run(async () => {
      if (mode === 'return') {
        const r = await libraryCopiesApi.ret(code);
        note(true, `Returned ${r.issue.bookTitle} (${r.copy.accessionNo})${r.issue.finePaise ? ` · fine ₹${r.issue.finePaise / 100}` : ''}`);
        reset();
        return;
      }
      const c = await libraryCopiesApi.scan(code);
      setCopy(c);
      if (c.status !== 'AVAILABLE') note(false, `${c.accessionNo} is ${humanize(c.status).toLowerCase()}${c.loan ? ` (with ${c.loan.borrowerName}, due ${fmtDate(c.loan.dueDate)})` : ''}`);
      else studentRef.current?.focus();
    });
  };
  const onStudent = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !student.trim() || !copy) return;
    e.preventDefault();
    void run(async () => {
      const r = await libraryCopiesApi.issue({ code: copy.accessionNo, student, dueAt: due });
      note(true, `Issued ${r.issue.bookTitle} (${copy.accessionNo}) to ${r.issue.studentName}, due ${fmtDate(r.issue.dueAt)}`);
      reset();
    });
  };
  return (
    <SectionCard title="Scan desk" sub="Click in the box and scan. The scanner types the code and presses Enter.">
      <Tabs tabs={[{ key: 'issue', label: 'Issue' }, { key: 'return', label: 'Return' }]} value={mode} onChange={(m) => { setMode(m); reset(); }} />
      <div className="lib-scan">
        <Field label={mode === 'issue' ? '1. Scan the book' : 'Scan the book being returned'}>
          <input ref={codeRef} className="input lib-scan-input" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onCode} placeholder="ACC-000123" aria-label="Book barcode" />
        </Field>
        {mode === 'issue' && copy && copy.status === 'AVAILABLE' && (
          <>
            <p><b>{copy.title}</b> · {copy.author} · <StatusPill status="ACTIVE" label="On the shelf" /></p>
            <div className="green-inline">
              <Field label="2. Scan or type the student's admission number">
                <input ref={studentRef} className="input lib-scan-input" autoComplete="off" value={student} onChange={(e) => setStudent(e.target.value)} onKeyDown={onStudent} aria-label="Student admission number" />
              </Field>
              <Field label="Due back"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            </div>
          </>
        )}
        {busy && <p className="ops-muted">Working…</p>}
        <ErrorNote error={error} />
      </div>
      {log.length > 0 ? (
        <ul className="lib-scan-log" aria-live="polite">{log.map((l, i) => <li key={i} className={l.ok ? 'is-ok' : 'is-warn'}>{l.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {l.text}</li>)}</ul>
      ) : <EmptyState icon="▥" title="Ready to scan" sub="Scanned issues and returns appear here." />}
    </SectionCard>
  );
}

export function LibraryLabelsView() {
  const [tab, setTab] = useState<'desk' | 'labels'>('desk');
  return (
    <div className="lib-labels-view">
      <Tabs tabs={[{ key: 'desk', label: 'Scan desk' }, { key: 'labels', label: 'Accession numbers & labels' }]} value={tab} onChange={setTab} />
      {tab === 'desk' ? <ScanDesk /> : <Labels />}
    </div>
  );
}
