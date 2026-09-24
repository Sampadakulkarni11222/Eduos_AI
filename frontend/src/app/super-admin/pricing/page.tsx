'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import {
  Button, Card, EmptyState, Field, Input, Modal, Pill, SkeletonRows, useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { clearActingSchool } from '@/lib/acting-school';
import type { SchoolSeatPriceDto, SeatPriceDto } from '@/lib/types';

/**
 * Super Admin — per-seat pricing.
 *
 * What each school pays for a seat, set school by school: School A at ₹100,
 * School B at ₹120, School C at ₹90.
 *
 * The screen is built around the one thing that is easy to get wrong about
 * pricing, which is that changing it must not rewrite what has already been
 * charged. So a price here is a *version*: setting a new one closes the old one
 * and both stay on the history, and the page says so where the operator is
 * about to act rather than in documentation they will not read. Nothing on this
 * page computes money — the amount a school is charged is calculated by the
 * server from the rate it resolves, and this only shows the rate and sends a
 * new one.
 */

const money = (paise: number, currency: string) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(paise / 100);

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const isFuture = (iso: string) => new Date(iso).getTime() > Date.now();

export default function SuperAdminPricingPage() {
  const [schools, setSchools] = useState<SchoolSeatPriceDto[] | null>(null);
  const [err, setErr] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<SeatPriceDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showSet, setShowSet] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setErr(false);
    // The platform table spans every school; an `X-School-Id` left over from a
    // school that was opened earlier would narrow it to one. PortalShell clears
    // it too, but its effect runs after this one.
    clearActingSchool();
    try {
      const rows = await api.listSchoolSeatPrices();
      setSchools(rows);
      setSelected((cur) => cur ?? rows[0]?.tenantId ?? null);
    } catch {
      setErr(true);
      setSchools([]);
    }
  }, []);

  const loadHistory = useCallback(async (tenantId: string) => {
    setHistory(null);
    try {
      setHistory(await api.schoolSeatPriceHistory(tenantId));
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) void loadHistory(selected); }, [selected, loadHistory]);

  const current = schools?.find((s) => s.tenantId === selected) ?? null;

  const setStatus = async (price: SeatPriceDto, status: 'ACTIVE' | 'INACTIVE') => {
    setBusyId(price.id);
    try {
      await api.updateSeatPrice(price.id, { status });
      toast(
        status === 'INACTIVE'
          ? 'Price deactivated. This school falls back to the platform default until another applies.'
          : 'Price reactivated.',
        'success',
      );
      await load();
      if (selected) await loadHistory(selected);
    } catch (e) {
      toast(errorMessage(e, 'Could not change this price.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PortalShell
      expectedSlug="super-admin"
      topbar={{
        title: 'Per-Seat Pricing',
        desc: 'What each school pays for a seat. Changing a price never alters what has already been charged.',
        actions: <Button small disabled={!current} onClick={() => setShowSet(true)}>Set price</Button>,
      }}
    >
      <div className="console-split is-pricing">
        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Schools</strong>
          </div>
          {schools === null && <div style={{ padding: 18 }}><SkeletonRows rows={4} /></div>}
          {err && <EmptyState title="Couldn't load pricing" sub="Failed to fetch from the server." />}
          {schools !== null && !err && schools.length === 0 && (
            <EmptyState title="No schools yet" sub="Register a school before pricing it." />
          )}
          {schools?.map((s) => (
            <button
              key={s.tenantId}
              type="button"
              onClick={() => setSelected(s.tenantId)}
              aria-current={s.tenantId === selected ? 'true' : undefined}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '12px 18px',
                border: 0, borderBottom: '1px solid var(--hairline)', cursor: 'pointer',
                background: s.tenantId === selected ? 'var(--surface-2, rgba(0,0,0,0.04))' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.tenantName}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                {money(s.unitPricePaise, s.currency)} <span style={{ color: 'var(--text-2)' }}>per seat</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                {s.source === 'SCHOOL'
                  ? `${s.versionCount} price version${s.versionCount === 1 ? '' : 's'}`
                  : 'Platform default — not priced specifically'}
              </div>
            </button>
          ))}
        </Card>

        <Card pad={false}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>
              {current ? `Pricing history — ${current.tenantName}` : 'Pricing history'}
            </strong>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
              Every version is kept. A superseded price still explains the requests it priced.
            </div>
          </div>

          {!current && <EmptyState title="Select a school" sub="Pick a school on the left to see how it has been priced." />}
          {current && history === null && <div style={{ padding: 18 }}><SkeletonRows rows={3} /></div>}
          {current && history !== null && history.length === 0 && (
            <EmptyState
              title="Never priced specifically"
              sub={`${current.tenantName} is charged the platform default of ${money(current.unitPricePaise, current.currency)} a seat.`}
            />
          )}
          {current && history && history.length > 0 && (
            <table className="data-table data-table-cards">
              <thead>
                <tr>
                  <th>Price</th>
                  <th>In force</th>
                  <th>Status</th>
                  <th>Set by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-primary" style={{ fontWeight: 600 }} data-label="Price">
                      {money(p.unitPricePaise, p.currency)}
                      <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-faint)' }}>
                        per seat · {p.currency}
                      </div>
                    </td>
                    <td data-label="In force">
                      <div>{when(p.effectiveFrom)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                        {p.effectiveTo ? `until ${when(p.effectiveTo)}` : 'current'}
                      </div>
                    </td>
                    <td data-label="Status">
                      <Pill tone={p.status === 'ACTIVE' ? 'green' : 'gray'}>{p.status.toLowerCase()}</Pill>
                      {isFuture(p.effectiveFrom) && (
                        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>scheduled</div>
                      )}
                      {p.note && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{p.note}</div>}
                    </td>
                    <td data-label="Set by">{p.setBy ?? '—'}</td>
                    <td data-label="Actions">
                      {p.status === 'ACTIVE' ? (
                        <Button variant="ghost" small disabled={busyId === p.id} onClick={() => void setStatus(p, 'INACTIVE')}>
                          Deactivate
                        </Button>
                      ) : (
                        <Button variant="soft" small disabled={busyId === p.id} onClick={() => void setStatus(p, 'ACTIVE')}>
                          Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {showSet && current && (
        <SetPriceModal
          school={current}
          onClose={() => setShowSet(false)}
          onDone={async () => {
            setShowSet(false);
            await load();
            await loadHistory(current.tenantId);
          }}
        />
      )}
    </PortalShell>
  );
}

function SetPriceModal({
  school, onClose, onDone,
}: { school: SchoolSeatPriceDto; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(school.currency);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    // Entered in whole currency units, sent in the minor unit the server works
    // in. The server validates it again and is the only thing that decides
    // whether it is acceptable — this check is here to save a round trip, not
    // to be the rule.
    const major = Number(amount);
    if (!Number.isFinite(major) || major <= 0) {
      toast('Enter a price greater than zero.', 'error');
      return;
    }
    const unitPricePaise = Math.round(major * 100);
    setBusy(true);
    try {
      await api.setSchoolSeatPrice(school.tenantId, {
        unitPricePaise,
        currency,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
        note: note || undefined,
      });
      toast(`${school.tenantName} is now priced at ${money(unitPricePaise, currency)} a seat.`, 'success');
      await onDone();
    } catch (e) {
      toast(errorMessage(e, 'Could not set this price.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Set per-seat price — ${school.tenantName}`}
      onClose={onClose}
      footer={<Button disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Set price'}</Button>}
    >
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 0 }}>
        Currently {money(school.unitPricePaise, school.currency)} a seat
        {school.source === 'PLATFORM_DEFAULT' ? ' (the platform default — never priced specifically)' : ''}.
        Setting a new price writes a new version and closes this one: requests already quoted or paid keep the
        price they were charged.
      </p>
      <Field label={`Price per seat (${currency})`} required>
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="100" />
      </Field>
      <Field label="Currency" hint="Three-letter ISO code, e.g. INR.">
        <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
      </Field>
      <Field label="Effective from" hint="Leave blank to apply now. A future date schedules the change; it cannot be backdated.">
        <Input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
      </Field>
      <Field label="Note" hint="Optional. Kept on the version, so the history explains itself.">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Renewal rate agreed for 2026-27" />
      </Field>
    </Modal>
  );
}
