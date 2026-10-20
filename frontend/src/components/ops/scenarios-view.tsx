'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Field, useToast } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';
import { scenarioApi, type AssumptionDto, type ProjectionDto, type ProjectionRow } from '@/lib/p2-api';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, Tile, fmtDate, money, useAction, useLoad } from './kit';

/**
 * Scenario planning: what-if projections 1–5 years ahead from the school's
 * current actuals (enrolment, fees, staffing, transport, budget). Every
 * figure is labelled a projection, and every assumption is shown with where
 * its starting value came from (actual records, a stated default, or edited).
 */
const GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Enrolment', keys: ['intake', 'retentionPct', 'lateralPerGrade'] },
  { title: 'Fees', keys: ['feePerStudentPaise', 'feeIncreasePct', 'concessionPct', 'collectionPct'] },
  { title: 'Staffing', keys: ['studentsPerTeacher', 'extraHiresPerYear', 'costPerStaffPaise', 'salaryIncrementPct'] },
  { title: 'Transport', keys: ['riderPct', 'seatsPerVehicle', 'targetLoadPct', 'costPerVehiclePaise'] },
  { title: 'Budget', keys: ['otherCostsPaise', 'otherCostsGrowthPct'] },
];
const SOURCE_LABEL = { ACTUAL: 'from records', DEFAULT: 'default', EDITED: 'edited' } as const;
const toInput = (a: AssumptionDto) => (a.unit === 'paise' ? String(a.value / 100) : String(a.value));
const fromInput = (a: AssumptionDto, v: string) => (a.unit === 'paise' ? Math.round(Number(v) * 100) : Number(v));
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** A small bar chart, one bar per year, with the value written on each bar. */
function Bars({ rows, pick, title, format }: { rows: ProjectionRow[]; pick: (r: ProjectionRow) => number; title: string; format: (n: number) => string }) {
  const vals = rows.map(pick);
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  return (
    <figure className="sc-chart" aria-label={title}>
      <figcaption>{title}</figcaption>
      <div className="sc-bars">{rows.map((r, i) => (
        <div key={r.year} className="sc-bar-col">
          <div className="sc-bar-val">{format(vals[i])}</div>
          <div className={`sc-bar ${vals[i] < 0 ? 'is-neg' : ''} ${r.actual ? 'is-actual' : ''}`} style={{ height: `${Math.max(4, (Math.abs(vals[i]) / max) * 100)}%` }} />
          <div className="sc-bar-label">{r.actual ? 'Now' : `Y${r.year}`}</div>
        </div>
      ))}</div>
    </figure>
  );
}

function ProjectionTable({ rows }: { rows: ProjectionRow[] }) {
  const lines: Array<[string, (r: ProjectionRow) => string]> = [
    ['Students', (r) => r.students.toLocaleString('en-IN')],
    ['Fee per student', (r) => money(r.feePerStudentPaise)],
    ['Fee income (after concessions, collected)', (r) => money(r.feeRevenuePaise)],
    ['Teachers needed', (r) => `${r.teachersNeeded}${r.actual ? '' : ` (${signed(r.newTeachersVsNow)})`}`],
    ['Students per teacher', (r) => (r.studentsPerTeacher === null ? '—' : String(r.studentsPerTeacher))],
    ['Staff cost', (r) => money(r.staffCostPaise)],
    ['Transport riders', (r) => r.riders.toLocaleString('en-IN')],
    ['Vehicles needed', (r) => `${r.vehiclesNeeded}${r.actual ? '' : ` (${signed(r.newVehiclesVsNow)})`}`],
    ['Transport cost', (r) => money(r.transportCostPaise)],
    ['Other costs', (r) => money(r.otherCostsPaise)],
    ['Surplus / (deficit)', (r) => money(r.surplusPaise)],
  ];
  return (
    <div className="sc-table-wrap">
      <table className="sc-table">
        <thead><tr><th scope="col">Projection</th>{rows.map((r) => <th key={r.year} scope="col">{r.label}{r.actual ? ' (actual)' : ''}</th>)}</tr></thead>
        <tbody>{lines.map(([label, f]) => <tr key={label}><th scope="row">{label}</th>{rows.map((r) => <td key={r.year} className={label.startsWith('Surplus') && r.surplusPaise < 0 ? 'is-neg' : undefined}>{f(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Builder({ onSaved }: { onSaved: () => void }) {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['scenarios.manage']);
  const base = useLoad(() => scenarioApi.baseline(), []);
  const [years, setYears] = useState(3);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ProjectionDto | null>(null);
  const [name, setName] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  // Labels, starting values and their source come from the actuals; edits sit on top.
  const byKey = useMemo(() => new Map((base.data?.assumptions ?? []).map((a) => [a.key, a])), [base.data]);
  const numbers = () => Object.fromEntries(Object.entries(edits).filter(([, v]) => v !== '').map(([k, v]) => [k, fromInput(byKey.get(k)!, v)]));
  const recompute = () => void run(async () => setResult(await scenarioApi.preview(years, numbers())));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- first projection once actuals arrive
  useEffect(() => { if (base.data && !result) recompute(); }, [base.data]);
  return (
    <Loadable state={base}>{(b) => (
      <div className="ops-stack">
        <SectionCard title="Current actuals" sub={`As of ${fmtDate(b.baseline.asOf)}${b.baseline.academicYear ? ` · ${b.baseline.academicYear}` : ''}`}>
          <div className="kpi-grid">
            <Tile label="Students" value={b.baseline.enrolment.students} />
            <Tile label="Teachers" value={b.baseline.staffing.teachers} />
            <Tile label="Students per teacher" value={b.baseline.staffing.studentsPerTeacher ?? '—'} />
            <Tile label="Fees billed" value={money(b.baseline.fees.billedPaise)} />
            <Tile label="Bus riders / vehicles" value={`${b.baseline.transport.riders} / ${b.baseline.transport.vehicles}`} />
            <Tile label="Budget planned" value={money(b.baseline.budget.plannedPaise)} />
          </div>
          <DataNote>Based on: {b.baseline.sources.join('; ')}.</DataNote>
        </SectionCard>
        <div className="sc-layout">
          <SectionCard title="Assumptions" sub="Edit any value; each shows where its starting value came from.">
            <Field label="Years ahead"><select className="input" value={years} onChange={(e) => setYears(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
            {GROUPS.map((g) => (
              <fieldset key={g.title} className="sc-group"><legend>{g.title}</legend>
                {g.keys.map((k) => { const a = byKey.get(k); if (!a) return null; return (
                  <Field key={k} label={`${a.label}${a.unit === 'paise' ? ' (₹)' : a.unit === '%' ? ' (%)' : ''}`} hint={edits[k] !== undefined && edits[k] !== toInput(a) ? `Edited; started at ${a.unit === 'paise' ? money(a.value) : a.value} (${SOURCE_LABEL[a.source]})` : `Starting value ${SOURCE_LABEL[a.source]}`}>
                    <input className="input" inputMode="decimal" value={edits[k] ?? toInput(a)} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
                  </Field>
                ); })}
              </fieldset>
            ))}
            <div className="ops-inline"><Button disabled={busy} onClick={recompute}>{busy ? 'Projecting…' : 'Project'}</Button><Button variant="ghost" onClick={() => { setEdits({}); setResult(null); }}>Reset to actuals</Button></div>
          </SectionCard>
          <div className="ops-stack">
            <ErrorNote error={error} />
            {result && (
              <SectionCard title="Projection" sub={result.label}>
                <p className="sc-label"><StatusPill status="DRAFT" label="Projection, not a forecast" /></p>
                <div className="sc-charts">
                  <Bars rows={result.rows} pick={(r) => r.students} title="Students" format={(n) => n.toLocaleString('en-IN')} />
                  <Bars rows={result.rows} pick={(r) => r.surplusPaise / 100} title="Surplus / (deficit), ₹" format={(n) => `${Math.round(n / 100000) / 10}L`} />
                  <Bars rows={result.rows} pick={(r) => r.teachersNeeded} title="Teachers needed" format={String} />
                  <Bars rows={result.rows} pick={(r) => r.vehiclesNeeded} title="Vehicles needed" format={String} />
                </div>
                <ProjectionTable rows={result.rows} />
                {canManage && (
                  <div className="ops-inline sc-save">
                    <Field label="Save as"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 8% fee rise, two new buses" /></Field>
                    <Button disabled={busy || !name.trim()} onClick={() => void run(async () => { await scenarioApi.create({ name, years, assumptions: numbers() }); toast('Scenario saved', 'success'); setName(''); onSaved(); })}>Save scenario</Button>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </div>
      </div>
    )}</Loadable>
  );
}

function Saved() {
  const list = useLoad(() => scenarioApi.list(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const cmp = useLoad(() => (picked.length >= 2 ? scenarioApi.compare(picked) : Promise.resolve(null)), [picked.join(',')]);
  const { permissions } = usePermissions();
  const { run, error } = useAction();
  return (
    <div className="ops-stack">
      <Loadable state={list}>{(rows) => !rows.length ? <EmptyState title="No saved scenarios" sub="Build a projection and save it to compare it with others." /> : (
        <SectionCard title="Saved scenarios" sub="Tick two to four to compare them side by side.">
          <ul className="ops-list">{rows.map((s) => (
            <li key={s.id} className="ops-row">
              <label className="ops-row-main"><input type="checkbox" checked={picked.includes(s.id)} disabled={!picked.includes(s.id) && picked.length >= 4} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /> <span className="ops-row-title">{s.name}</span> <span className="ops-row-sub">{s.years} year(s) · {s.edited} assumption(s) changed · {s.createdByName} · {fmtDate(s.updatedAt)}</span></label>
              {permissions['scenarios.manage'] && <Button small variant="ghost" onClick={() => void run(async () => { await scenarioApi.remove(s.id); setPicked(picked.filter((x) => x !== s.id)); await list.reload(); })}>Remove</Button>}
            </li>
          ))}</ul>
        </SectionCard>
      )}</Loadable>
      <ErrorNote error={error} />
      {picked.length >= 2 && (
        <Loadable state={cmp}>{(c) => c && (
          <SectionCard title="Side by side" sub={c.label}>
            <div className="sc-compare">{c.scenarios.map((s) => {
              const last = s.rows[s.rows.length - 1];
              return (
                <div key={s.id} className="sc-compare-col">
                  <h3>{s.name}</h3>
                  <Bars rows={s.rows} pick={(r) => r.surplusPaise / 100} title="Surplus / (deficit), ₹" format={(n) => `${Math.round(n / 100000) / 10}L`} />
                  <dl className="ops-kv">
                    <div><dt>Students in year {last.year}</dt><dd>{last.students}</dd></div>
                    <div><dt>Fee income</dt><dd>{money(last.feeRevenuePaise)}</dd></div>
                    <div><dt>Teachers needed</dt><dd>{last.teachersNeeded} ({signed(last.newTeachersVsNow)})</dd></div>
                    <div><dt>Vehicles needed</dt><dd>{last.vehiclesNeeded} ({signed(last.newVehiclesVsNow)})</dd></div>
                    <div><dt>Surplus</dt><dd>{money(last.surplusPaise)}</dd></div>
                  </dl>
                  <details><summary>Assumptions</summary><ul className="sc-assumptions">{s.assumptions.map((a) => <li key={a.key} className={a.source === 'EDITED' ? 'is-edited' : undefined}>{a.label}: <b>{a.unit === 'paise' ? money(a.value) : `${a.value}${a.unit === '%' ? '%' : ''}`}</b> ({SOURCE_LABEL[a.source]})</li>)}</ul></details>
                </div>
              );
            })}</div>
          </SectionCard>
        )}</Loadable>
      )}
    </div>
  );
}

export function ScenariosView() {
  const [tab, setTab] = useState<'build' | 'saved'>('build');
  return (
    <div className="ops-stack">
      <DataNote>Projections from the assumptions shown, starting from this school&apos;s current records. They are not forecasts and do not change any record.</DataNote>
      <Tabs tabs={[{ key: 'build', label: 'Build a projection' }, { key: 'saved', label: 'Saved and compare' }]} value={tab} onChange={setTab} />
      {tab === 'build' ? <Builder onSaved={() => setTab('saved')} /> : <Saved />}
    </div>
  );
}
