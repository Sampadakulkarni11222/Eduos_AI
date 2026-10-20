'use client';
import { useState } from 'react';
import { Button, Field, useToast } from '@/components/ui';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, fmtDate, humanize, useAction, useLoad } from '@/components/ops/kit';
import { leadershipApi, type BoardPackView } from '@/lib/leadership-api';

/**
 * The board pack inside a meeting: what members read before the meeting
 * (agenda, previous minutes, action register, finance, budget, compliance
 * exceptions, decisions waiting) and questions suggested from the figures.
 * The secretariat freezes a version for circulation; members read that
 * version and their opens are listed. Download as PDF for printing.
 */
const inr = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function BoardPackPanel({ meetingId, canManage }: { meetingId: string; canManage: boolean }) {
  const [live, setLive] = useState(false);
  const [note, setNote] = useState('');
  const state = useLoad(() => leadershipApi.boardPack(meetingId, live), [meetingId, live]);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(v: BoardPackView) => {
      const p = v.pack;
      return (
        <div className="ops-stack">
          <div className="lead-pack-head">
            <div>
              <StatusPill status={v.mode === 'FROZEN' ? 'PUBLISHED' : 'DRAFT'} label={v.mode === 'FROZEN' ? `Version ${v.version}` : 'Live preview'} />
              <span className="ops-muted" style={{ marginLeft: 8, fontSize: 12.5 }}>
                {v.mode === 'FROZEN' ? `Frozen ${fmtDate(v.frozenAt)}${v.frozenBy ? ` by ${v.frozenBy}` : ''}${v.note ? ` · ${v.note}` : ''}` : 'Built from the records now; not yet circulated.'}
              </span>
            </div>
            <div className="ops-inline">
              <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await leadershipApi.boardPackPdf(meetingId, p.meeting.refNo, live); })}>Download PDF</Button>
              {canManage && v.versions.length > 0 && <Button small variant="ghost" onClick={() => setLive((x) => !x)}>{live ? 'Show circulated version' : 'Show live figures'}</Button>}
            </div>
          </div>
          {v.mode === 'FROZEN' && (
            <p className="ops-muted" style={{ fontSize: 12.5 }}>
              Read by {v.reads?.length ? v.reads.map((r) => `${r.name} (${fmtDate(r.at)})`).join(', ') : 'nobody yet'}.
            </p>
          )}

          {p.questions.length > 0 && (
            <SectionCard title="Questions to consider" sub={p.questionsNote}>
              {p.questions.map((q, i) => <div key={i} className="lead-pack-q"><b>{q.question}</b><span>Based on: {q.basis}</span></div>)}
            </SectionCard>
          )}

          <SectionCard title="Previous meeting">
            {!p.previous.available ? <p className="ops-muted">{p.previous.reason}</p> : (
              <>
                <p>{p.previous.title} ({p.previous.refNo}), held {fmtDate(p.previous.heldOn)}. Minutes: {humanize(p.previous.minutesStatus)}.</p>
                {p.previous.minutesNote && <p className="ops-muted">{p.previous.minutesNote}</p>}
                {p.previous.minutes && <p style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{p.previous.minutes}</p>}
                {p.previous.resolutions.length > 0 && <ul className="ops-list">{p.previous.resolutions.map((r) => <li key={r.number} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.number}</div><div>{r.text}</div><div className="ops-row-sub">For {r.votesFor} · Against {r.votesAgainst} · Abstain {r.abstentions}</div></div><StatusPill status={r.outcome === 'PASSED' ? 'APPROVED' : 'REJECTED'} label={humanize(r.outcome)} /></li>)}</ul>}
              </>
            )}
          </SectionCard>

          <SectionCard title="Action register">
            {!p.actions.available ? <p className="ops-muted">{p.actions.reason}</p> : !p.actions.items.length ? <p className="ops-muted">No open actions.</p> : (
              <ul className="ops-list">{p.actions.items.map((a) => <li key={a.actionId} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.title}</div><div className="ops-row-sub">{a.meeting} · {a.ownerName ?? 'Unassigned'} · due {fmtDate(a.dueOn)}</div></div>{a.overdue && <span className="ops-flag-overdue">OVERDUE</span>}</li>)}</ul>
            )}
          </SectionCard>

          <SectionCard title="Finance, this financial year" sub={p.finance.available ? `${p.finance.period.label}${p.finance.comparison ? ` against ${p.finance.comparison.label}` : ''}` : undefined}>
            {!p.finance.available ? <p className="ops-muted">{p.finance.reason}</p> : (
              <div className="table-scroll"><table className="data-table data-table-cards">
                <thead><tr><th>Measure</th><th style={{ textAlign: 'right' }}>This year</th><th style={{ textAlign: 'right' }}>Last year</th><th style={{ textAlign: 'right' }}>Change</th></tr></thead>
                <tbody>{p.finance.metrics.map((m) => <tr key={m.key}><td className="cell-primary" data-label="Measure" title={m.definition}>{m.label}</td><td data-label="This year" style={{ textAlign: 'right' }}>{m.text}</td><td data-label="Last year" style={{ textAlign: 'right' }}>{m.comparisonText ?? '—'}</td><td data-label="Change" style={{ textAlign: 'right' }}>{m.changePct === null ? '—' : `${m.changePct > 0 ? '+' : ''}${m.changePct}%`}</td></tr>)}</tbody>
              </table></div>
            )}
          </SectionCard>

          <SectionCard title="Budget" sub={p.budget.available ? `${p.budget.name} · ${humanize(p.budget.status)} · ${p.budget.yearElapsedPct}% of the year gone` : undefined}>
            {!p.budget.available ? <p className="ops-muted">{p.budget.reason}</p> : (
              <>
                <div className="table-scroll"><table className="data-table data-table-cards">
                  <thead><tr><th>Line</th><th style={{ textAlign: 'right' }}>Planned</th><th style={{ textAlign: 'right' }}>Committed</th><th style={{ textAlign: 'right' }}>Spent</th><th style={{ textAlign: 'right' }}>Used</th></tr></thead>
                  <tbody>{p.budget.lines.map((l) => <tr key={l.code}><td className="cell-primary" data-label="Line">{l.code} {l.head}</td><td data-label="Planned" style={{ textAlign: 'right' }}>{inr(l.plannedPaise)}</td><td data-label="Committed" style={{ textAlign: 'right' }}>{inr(l.committedPaise)}</td><td data-label="Spent" style={{ textAlign: 'right' }}>{inr(l.actualPaise)}</td><td data-label="Used" style={{ textAlign: 'right' }}>{l.utilisationPct === null ? '—' : `${l.utilisationPct}%`}</td></tr>)}</tbody>
                </table></div>
                {p.budget.previousYear && (
                  <p style={{ fontSize: 13, marginTop: 8 }}>
                    Last year ({p.budget.previousYear.fiscalYear}): planned {inr(p.budget.previousYear.planned)}, spent {inr(p.budget.previousYear.actual)}.
                    {p.budget.previousYear.overruns.length > 0 && ` Over budget: ${p.budget.previousYear.overruns.map((o) => `${o.head} (+${o.overPct}%${o.explanation ? `: ${o.explanation}` : ', no explanation recorded'})`).join('; ')}.`}
                  </p>
                )}
              </>
            )}
          </SectionCard>

          <SectionCard title="Compliance exceptions">
            {!p.compliance.available ? <p className="ops-muted">{p.compliance.reason}</p> : (
              <>
                {!p.compliance.overdue.length ? <p>Nothing overdue.</p> : <ul className="ops-list">{p.compliance.overdue.map((i, n) => <li key={n} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{i.title}</div><div className="ops-row-sub">{humanize(i.kind)} · {fmtDate(i.date)}</div></div><span className="ops-flag-overdue">OVERDUE</span></li>)}</ul>}
                {p.compliance.dueIn30Days.length > 0 && <p className="ops-muted" style={{ marginTop: 6 }}>Due in the next 30 days: {p.compliance.dueIn30Days.map((i) => i.title).join('; ')}.</p>}
              </>
            )}
          </SectionCard>

          <SectionCard title="Decisions waiting for the board" sub={p.decisions.available ? p.decisions.note : undefined}>
            {!p.decisions.available ? <p className="ops-muted">{p.decisions.reason}</p> : !p.decisions.items.length ? <p className="ops-muted">None.</p> : (
              <ul className="ops-list">{p.decisions.items.map((d) => <li key={d.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{d.title}</div><div className="ops-row-sub">{d.refNo}{d.amountPaise ? ` · ${inr(d.amountPaise)}` : ''} · {d.stage} · due {fmtDate(d.dueAt)}</div></div></li>)}</ul>
            )}
          </SectionCard>

          {p.enrolment.available && <p className="ops-muted">{plural(p.enrolment.studentsOnRoll, 'student')} on roll.</p>}

          {canManage && (
            <SectionCard title="Circulate" sub="Freezing takes the figures as they stand now; members then read the same papers and their opens are listed above.">
              <Field label="Note for this version (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={{ width: '100%' }} /></Field>
              <Button small disabled={busy} onClick={() => void run(async () => { await leadershipApi.freezeBoardPack(meetingId, note || undefined); setNote(''); setLive(false); toast('Board pack frozen for circulation', 'success'); await state.reload(); })}>{v.versions.length ? `Freeze version ${v.versions[0].version + 1}` : 'Freeze version 1'}</Button>
            </SectionCard>
          )}
          <ErrorNote error={error} />
          <DataNote>Questions are suggested from the figures by fixed rules, with the figure behind each; they are prompts, not findings. Trustees decide in the meeting.</DataNote>
        </div>
      );
    }}</Loadable>
  );
}
