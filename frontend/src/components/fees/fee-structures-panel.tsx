'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { AcademicYearDto, FeeHeadDto, FeeStructureDto, GenerateInvoicesResult, GradeDto } from '@/lib/types';
import { Button, Card, DateField, EmptyState, Field, Modal, SkeletonRows, rupees, useToast } from '../ui';

/**
 * Fee plans + bulk invoice generation.
 *
 * Before this, fee heads and structures could be created via the API but never
 * listed, and invoices could only be made one at a time or from a CSV. This is
 * the "define the plan for a class, then bill everyone in it" path.
 */
export function FeeStructuresPanel() {
  const generatingRef = useRef(false);
  const [heads, setHeads] = useState<FeeHeadDto[] | null>(null);
  const [structures, setStructures] = useState<FeeStructureDto[] | null>(null);
  const [grades, setGrades] = useState<GradeDto[]>([]);
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [yearId, setYearId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [showHead, setShowHead] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<GenerateInvoicesResult | null>(null);
  const toast = useToast();

  const reload = () => {
    api.feeHeads().then(setHeads).catch(() => setHeads([]));
    api.feeStructures(yearId || undefined, gradeId || undefined).then(setStructures).catch(() => setStructures([]));
  };

  useEffect(() => {
    api.listGrades().then(setGrades).catch(() => setGrades([]));
    api.academicYears().then((y) => {
      setYears(y);
      // Default to the year the school marks current, else the first listed.
      const current = y.find((x) => x.isCurrent) ?? y[0];
      if (current) setYearId(current._id);
    }).catch(() => setYears([]));
  }, []);

  useEffect(reload, [yearId, gradeId]);

  async function generate(dryRun: boolean) {
    if (!yearId) { toast('Pick an academic year first.', 'error'); return; }
    // Generation writes an invoice per enrolled student, so a second click
    // landing before `generating` re-renders must be dropped outright.
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    try {
      const res = await api.generateInvoices({ academicYearId: yearId, gradeId: gradeId || null, dryRun });
      if (dryRun) {
        setPreview(res);
      } else {
        setPreview(null);
        toast(`${res.generated} invoice(s) generated · ${res.skipped} already billed`, 'success');
      }
    } catch (x) {
      toast(x instanceof ApiError ? x.message : 'Could not generate invoices.', 'error');
    } finally {
      setGenerating(false);
      generatingRef.current = false;
    }
  }

  return (
    <>
      <Card pad={false}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end',
          justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--hairline)',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Academic year
              <select className="input" value={yearId} onChange={(e) => setYearId(e.target.value)} style={{ display: 'block', marginTop: 4, minWidth: 150 }}>
                {years.map((y) => <option key={y._id} value={y._id}>{y.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Grade
              <select className="input" value={gradeId} onChange={(e) => setGradeId(e.target.value)} style={{ display: 'block', marginTop: 4, minWidth: 150 }}>
                <option value="">All grades</option>
                {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="ghost" small onClick={() => setShowHead(true)}>+ Fee head</Button>
            <Button variant="soft" small onClick={() => setShowStructure(true)}>+ Fee plan</Button>
            <Button small onClick={() => void generate(true)} disabled={generating || !structures?.length}>
              {generating ? 'Working…' : 'Preview billing'}
            </Button>
          </div>
        </div>

        {heads && heads.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
            padding: '10px 20px', background: 'var(--bg-card-subtle, #fafafa)', borderBottom: '1px solid var(--hairline)',
            fontSize: 12, color: 'var(--text-2)',
          }}>
            <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>Fee heads ({heads.length}):</span>
            {heads.map((h) => (
              <span key={h._id} style={{
                background: 'var(--bg-chip, #f0f0f0)', padding: '2px 8px', borderRadius: 4,
                border: '1px solid var(--hairline)', fontWeight: 500, color: 'var(--text-1)',
              }}>
                {h.name}
              </span>
            ))}
          </div>
        )}

        {preview && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)', background: '#FBF6EC' }}>
            <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600, marginBottom: 4 }}>
              {preview.generated} invoice(s) would be created · {preview.skipped} already billed
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 10 }}>
              Total {rupees(preview.totalPaise)}. Students already billed for these plans are skipped, so running
              this again after adding a plan only charges the new one.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button small onClick={() => void generate(false)} disabled={generating || preview.generated === 0}>
                Generate {preview.generated} invoice(s)
              </Button>
              <Button variant="ghost" small onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          </div>
        )}

        {structures === null ? (
          <div style={{ padding: 20 }}><SkeletonRows rows={3} /></div>
        ) : structures.length === 0 ? (
          <EmptyState
            icon="₹"
            title="No fee plans yet"
            sub="Create a fee head (Tuition, Transport…) then a plan for a grade and term. You can then bill every student in that grade at once."
          />
        ) : (
          <table className="data-table data-table-cards">
            <thead>
              <tr><th>Plan</th><th>Head</th><th>Applies to</th><th>Amount</th><th>Due</th></tr>
            </thead>
            <tbody>
              {structures.map((s) => (
                <tr key={s._id}>
                  <td className="cell-primary" data-label="Plan">{s.name}</td>
                  <td data-label="Head">{s.feeHeadId?.name ?? '—'}</td>
                  <td data-label="Applies to">{s.gradeId?.name ?? 'All grades'}</td>
                  <td data-label="Amount">{rupees(s.amountPaise)}</td>
                  <td data-label="Due">{new Date(s.dueOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showHead && (
        <FeeHeadModal onClose={() => setShowHead(false)} onSaved={() => { setShowHead(false); reload(); toast('Fee head created'); }} />
      )}
      {showStructure && (
        <FeeStructureModal
          heads={heads ?? []}
          grades={grades}
          yearId={yearId}
          onClose={() => setShowStructure(false)}
          onSaved={() => { setShowStructure(false); reload(); toast('Fee plan created'); }}
        />
      )}
    </>
  );
}

function FeeHeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('TUITION');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createFeeHead({ name: name.trim(), category });
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not create the fee head.');
      setBusy(false);
    }
  };

  return (
    <Modal title="New fee head" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name" required hint="e.g. Tuition, Transport, Lab" error={err ?? undefined}>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="TUITION">Tuition</option>
            <option value="TRANSPORT">Transport</option>
            <option value="HOSTEL">Hostel</option>
            <option value="LIBRARY">Library</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function FeeStructureModal({
  heads, grades, yearId, onClose, onSaved,
}: {
  heads: FeeHeadDto[]; grades: GradeDto[]; yearId: string; onClose: () => void; onSaved: () => void;
}) {
  const [feeHeadId, setFeeHeadId] = useState(heads[0]?._id ?? '');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createFeeStructure({
        feeHeadId,
        academicYearId: yearId,
        gradeId: gradeId || null,
        name: name.trim(),
        amountPaise: Math.round(Number(amount) * 100),
        dueOn,
      });
      onSaved();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not create the fee plan.');
      setBusy(false);
    }
  };

  if (!heads.length) {
    return (
      <Modal title="New fee plan" onClose={onClose}>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Create a fee head first — a plan always belongs to one (Tuition, Transport, and so on).
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <Button onClick={onClose}>Got it</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New fee plan" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Fee head" required>
          <select className="field-input" value={feeHeadId} onChange={(e) => setFeeHeadId(e.target.value)}>
            {heads.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
          </select>
        </Field>
        <Field label="Plan name" required hint="e.g. Term 1, Annual">
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Amount (₹)" required error={err ?? undefined}>
          <input className="field-input" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Applies to" hint="Leave as all grades to bill the whole school">
          <select className="field-input" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            <option value="">All grades</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="Due date" required>
          <DateField inputClassName="field-input" ariaLabel="Due date" value={dueOn} onChange={setDueOn} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !name.trim() || !amount || !dueOn}>{busy ? 'Saving…' : 'Create plan'}</Button>
        </div>
      </form>
    </Modal>
  );
}
