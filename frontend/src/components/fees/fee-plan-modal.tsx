'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button, DateField, rupees } from '../ui';
import { api, errorMessage } from '@/lib/api';
import type { FeePlanMode, StudentListItem } from '@/lib/types';

/**
 * Configuring how a student's fee may be paid.
 *
 * The one rule the form is built around is that the installments must add up
 * to the total payable — shown live, because a mismatch found at submit time
 * means retyping a schedule. The server checks it again and refuses anything
 * that does not balance, so this is convenience, not the guarantee.
 *
 * Creating a plan never bills anyone: it starts as a draft and goes through
 * finance review and admin approval before any invoice exists.
 */

const MODES: { value: FeePlanMode; label: string; hint: string; defaultCount: number }[] = [
  { value: 'ONE_TIME', label: 'One-time payment', hint: 'The whole fee is due on a single date.', defaultCount: 1 },
  { value: 'PARTIAL', label: 'Partial payment', hint: 'A first payment now and the balance later.', defaultCount: 2 },
  { value: 'INSTALLMENT', label: 'Installment payment', hint: 'A fixed schedule of equal or custom installments.', defaultCount: 3 },
];

type Row = { amount: string; dueOn: string; label: string };

const emptyRow = (i: number): Row => ({ amount: '', dueOn: '', label: `Installment ${i + 1}` });

export function FeePlanModal({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [studentId, setStudentId] = useState('');
  const [name, setName] = useState('Tuition fee');
  const [mode, setMode] = useState<FeePlanMode>('INSTALLMENT');
  const [total, setTotal] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow(0), emptyRow(1), emptyRow(2)]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.students().then((res) => setStudents(res.items)).catch(() => setStudents([]));
  }, []);

  // A plan hangs off an enrollment — the student *in one academic year* — which
  // is what makes a plan year-specific without carrying a second copy of the
  // year on it. Students with no active enrollment cannot be given one.
  const chosen = (students ?? []).find((s) => s.id === studentId);
  const enrollmentId = chosen?.enrollment?.id ?? '';

  const totalPaise = Math.round(parseFloat(total || '0') * 100);
  const sumPaise = useMemo(
    () => rows.reduce((acc, r) => acc + Math.round(parseFloat(r.amount || '0') * 100), 0),
    [rows]
  );
  const balanced = totalPaise > 0 && sumPaise === totalPaise;

  const setCount = (n: number) => {
    setRows((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(emptyRow(next.length));
      return next.slice(0, n);
    });
  };

  const changeMode = (next: FeePlanMode) => {
    setMode(next);
    setCount(MODES.find((m) => m.value === next)!.defaultCount);
  };

  /** Splits the total evenly, giving any leftover paise to the first row. */
  const splitEvenly = () => {
    if (!totalPaise || rows.length === 0) return;
    const each = Math.floor(totalPaise / rows.length);
    const remainder = totalPaise - each * rows.length;
    setRows(rows.map((r, i) => ({ ...r, amount: (((i === 0 ? each + remainder : each)) / 100).toFixed(2) })));
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!enrollmentId) { setErr('Pick a student with an active enrollment.'); return; }
    if (!balanced) { setErr('The installments must add up to the total payable.'); return; }
    if (rows.some((r) => !r.dueOn)) { setErr('Every installment needs a due date.'); return; }

    setBusy(true);
    try {
      await api.createFeePlan({
        enrollmentId,
        name: name.trim() || 'Fee plan',
        mode,
        totalPaise,
        notes: notes.trim() || undefined,
        installments: rows.map((r, i) => ({
          amountPaise: Math.round(parseFloat(r.amount) * 100),
          dueOn: r.dueOn,
          label: r.label.trim() || `Installment ${i + 1}`,
        })),
      });
      onDone('Plan created as a draft. Submit it for finance review when it is ready.');
    } catch (e) {
      setErr(errorMessage(e, 'Could not create the plan.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <div className="modal-title">Configure a fee plan</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit}>
          <div className="pay-form-grid">
            <div>
              <div className="field-label">Student *</div>
              <select
                className="field-input"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                required
                disabled={students === null}
              >
                <option value="">{students === null ? 'Loading…' : 'Select a student…'}</option>
                {(students ?? []).map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.enrollment}>
                    {s.name} — {s.admissionNo}{s.enrollment ? ` (${s.enrollment.class})` : ' — not enrolled'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="field-label">Plan name *</div>
              <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>

          <div className="pay-form-grid">
            <div>
              <div className="field-label">Payment mode *</div>
              <select className="field-input" value={mode} onChange={(e) => changeMode(e.target.value as FeePlanMode)}>
                {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: -6, marginBottom: 10 }}>
                {MODES.find((m) => m.value === mode)?.hint}
              </div>
            </div>
            <div>
              <div className="field-label">Total fee (₹) *</div>
              <input
                className="field-input" type="number" min="1" step="0.01"
                value={total} onChange={(e) => setTotal(e.target.value)} required
              />
            </div>
          </div>

          {mode !== 'ONE_TIME' && (
            <div className="plan-builder-controls">
              <label className="field-label" htmlFor="plan-count" style={{ marginBottom: 0 }}>Number of installments</label>
              <input
                id="plan-count"
                className="field-input"
                type="number"
                min="2"
                max="24"
                value={rows.length}
                onChange={(e) => setCount(Math.max(2, Math.min(24, Number(e.target.value) || 2)))}
                style={{ width: 90, marginBottom: 0 }}
              />
              <Button type="button" small variant="soft" onClick={splitEvenly} disabled={!totalPaise}>
                Split evenly
              </Button>
            </div>
          )}

          <table className="data-table data-table-cards" style={{ marginBottom: 8 }}>
            <thead>
              <tr><th>Installment</th><th>Amount (₹)</th><th>Due date</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td data-label="Installment">
                    <input
                      className="field-input" style={{ marginBottom: 0 }}
                      value={r.label} onChange={(e) => update(i, { label: e.target.value })}
                      aria-label={`Installment ${i + 1} label`}
                    />
                  </td>
                  <td data-label="Amount (₹)">
                    <input
                      className="field-input" style={{ marginBottom: 0 }} type="number" min="0.01" step="0.01"
                      value={r.amount} onChange={(e) => update(i, { amount: e.target.value })}
                      aria-label={`Installment ${i + 1} amount`} required
                    />
                  </td>
                  <td data-label="Due date">
                    <DateField
                      inputClassName="field-input"
                      ariaLabel={`Installment ${i + 1} due date`}
                      required
                      value={r.dueOn}
                      onChange={(v) => update(i, { dueOn: v })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* The running total, which is the check the server will make. */}
          <div className={`plan-balance ${balanced ? 'is-balanced' : ''}`}>
            <span>Installments total</span>
            <strong>{rupees(sumPaise)}</strong>
            <span>of</span>
            <strong>{rupees(totalPaise)}</strong>
            <span>{balanced ? '✓ balanced' : `· ${rupees(Math.abs(totalPaise - sumPaise))} ${sumPaise > totalPaise ? 'over' : 'short'}`}</span>
          </div>

          <div className="field-label">Notes (optional)</div>
          <input className="field-input" value={notes} onChange={(e) => setNotes(e.target.value)} />

          {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }} role="alert">{err}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Button type="submit" disabled={busy || !balanced} style={{ flex: 1 }}>
              {busy ? 'Creating…' : 'Create draft plan'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
