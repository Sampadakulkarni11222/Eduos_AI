'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Field } from '@/components/ui';
import { usePortalHref } from '@/lib/school-path';
import {
  automationsApi, REPORT_OPTIONS, WEEKDAY_LABELS,
  type AutomationDto, type AutomationDraftDto, type PersonalScheduleInput,
} from '@/lib/automations-api';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, fmtDateTime, useAction, useLoad } from './kit';

/**
 * Automations (Part 7): one page for every role.
 *
 *   What needs you today   from the same records as Today, Tasks and Approvals
 *   Drafts to check        what an automation prepared; nothing is done until you confirm
 *   Your reminders         personal reminders and reports (also set up in Ask AI)
 *   Your choices           opt-ins (weekly child digest, birthday greetings)
 *   School automations     on/off, hour, weekday, audience and a preview of the message;
 *                          editable only by someone who manages school settings
 */

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 .. 20:00, never in quiet hours
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const ROLE_LABEL: Record<string, string> = { TEACHER: 'Teachers', PRINCIPAL: 'Principal', ADMIN: 'Administrators', STUDENT: 'Students', PARENT: 'Parents', FINANCE: 'Finance office', NURSE: 'Nurse', MARKETING: 'Admissions', LIBRARIAN: 'Librarian' };

function Today() {
  const state = useLoad(() => automationsApi.today(), []);
  const link = usePortalHref();
  return (
    <SectionCard title="What needs you today" sub="From your tasks, approvals, registers, drafts and reminders. Ask AI: “what needs me today”.">
      <Loadable state={state}>{(d) => (d.items.length ? (
        <ul className="ops-list">
          {d.items.map((i, n) => (
            <li key={n} className="ops-row">
              <div className="ops-row-main">
                {i.link ? <Link className="ops-row-title" href={link(i.link)}>{i.title}</Link> : <span className="ops-row-title">{i.title}</span>}
                {!!i.examples?.length && <div className="ops-row-sub">{i.examples.join(' · ')}</div>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="ops-muted">Nothing needs you right now.</p>)}</Loadable>
    </SectionCard>
  );
}

function draftLines(d: AutomationDraftDto) {
  if (d.detail.kind === 'COVER') return (d.detail.periods ?? []).map((p) => `Period ${p.periodNo} · ${p.class}${p.subject ? ` (${p.subject})` : ''} → ${p.suggested ? p.suggested.name : 'no free substitute'}`);
  if (d.detail.kind === 'PURCHASE') return (d.detail.items ?? []).map((i) => `${i.name}: ${i.quantity} left (reorder at ${i.reorderLevel}) → order ${i.suggestedQty} ${i.unit}`);
  return [];
}

function Drafts() {
  const state = useLoad(() => automationsApi.drafts(), []);
  const { run, busy, error } = useAction();
  const [note, setNote] = useState<string | null>(null);
  const act = (id: string, confirm: boolean) => void run(async () => {
    if (confirm) {
      const out = await automationsApi.confirmDraft(id);
      setNote(`Done: ${out.outcome.created.length} carried out${out.outcome.failed.length ? `, ${out.outcome.failed.length} could not be done (${out.outcome.failed.map((f) => f.reason).join('; ')})` : ''}.`);
    } else {
      await automationsApi.dismissDraft(id);
      setNote('Draft dismissed; nothing in it was done.');
    }
    await state.reload();
  });
  return (
    <SectionCard title="Drafts to check" sub="Prepared by an automation for you. Nothing is done until you confirm.">
      <Loadable state={state}>{(rows) => (rows.length ? (
        <ul className="ops-list">
          {rows.map((d) => (
            <li key={d.id} className="ops-row automation-draft">
              <div className="ops-row-main">
                <div className="ops-row-title">{d.title}</div>
                <ul className="automation-draft-lines">{draftLines(d).map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
              <div className="automation-actions">
                <Button small disabled={busy} onClick={() => act(d.id, true)}>Confirm</Button>
                <Button small variant="soft" disabled={busy} onClick={() => act(d.id, false)}>Dismiss</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="ops-muted">No drafts waiting for you.</p>)}</Loadable>
      {note && <p className="ops-muted" role="status">{note}</p>}
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function AddReminder({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState<PersonalScheduleInput>({ kind: 'REMINDER', text: '', frequency: 'WEEKLY', weekdays: [5], hour: 16 });
  const [onDate, setOnDate] = useState('');
  const { run, busy, error } = useAction();
  const set = (patch: Partial<PersonalScheduleInput>) => setForm((f) => ({ ...f, ...patch }));
  const save = () => void run(async () => {
    const body: PersonalScheduleInput = { ...form, ...(form.frequency === 'ONCE' && { onDate }), ...(form.kind === 'REPORT' && { reportKey: form.reportKey ?? REPORT_OPTIONS[0].value }) };
    await automationsApi.addReminder(body);
    set({ text: '' });
    onAdded();
  });
  return (
    <div className="automation-form">
      <Field label="Type">
        <select className="input" value={form.kind} onChange={(e) => set({ kind: e.target.value as PersonalScheduleInput['kind'] })}>
          <option value="REMINDER">Reminder</option>
          <option value="REPORT">Report</option>
        </select>
      </Field>
      {form.kind === 'REMINDER' ? (
        <Field label="Remind me to"><input className="input" value={form.text ?? ''} maxLength={300} onChange={(e) => set({ text: e.target.value })} placeholder="submit lesson plans" /></Field>
      ) : (
        <Field label="Report">
          <select className="input" value={form.reportKey ?? REPORT_OPTIONS[0].value} onChange={(e) => set({ reportKey: e.target.value })}>
            {REPORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      )}
      <Field label="How often">
        <select className="input" value={form.frequency} onChange={(e) => set({ frequency: e.target.value as PersonalScheduleInput['frequency'] })}>
          <option value="DAILY">Every day</option>
          <option value="WEEKDAYS">Every weekday</option>
          <option value="WEEKLY">Every week</option>
          <option value="MONTHLY">Every month</option>
          <option value="ONCE">Once</option>
        </select>
      </Field>
      {form.frequency === 'WEEKLY' && (
        <Field label="Day">
          <select className="input" value={String(form.weekdays?.[0] ?? 5)} onChange={(e) => set({ weekdays: [Number(e.target.value)] })}>
            {WEEKDAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
      )}
      {form.frequency === 'MONTHLY' && (
        <Field label="Day of month"><input className="input" type="number" min={1} max={28} value={form.dayOfMonth ?? 1} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} /></Field>
      )}
      {form.frequency === 'ONCE' && <Field label="Date"><input className="input" type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} /></Field>}
      <Field label="Time">
        <select className="input" value={String(form.hour)} onChange={(e) => set({ hour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
        </select>
      </Field>
      <div className="automation-actions"><Button disabled={busy || (form.kind === 'REMINDER' && !form.text?.trim())} onClick={save}>{busy ? 'Saving…' : 'Add'}</Button></div>
      <ErrorNote error={error} />
    </div>
  );
}

function Reminders() {
  const state = useLoad(() => automationsApi.reminders(), []);
  const { run, busy, error } = useAction();
  return (
    <SectionCard title="Your reminders and reports" sub="Only you receive them, in the app (and on WhatsApp if you opted in; reports also by email). Ask AI: “remind me every Friday to submit lesson plans”.">
      <Loadable state={state}>{(rows) => (rows.length ? (
        <ul className="ops-list">
          {rows.map((r) => (
            <li key={r.id} className="ops-row">
              <div className="ops-row-main">
                <div className="ops-row-title">{r.kind === 'REPORT' ? `Report: ${r.text}` : r.text}</div>
                <div className="ops-row-sub">{r.when}{r.nextRunAt ? ` · next ${fmtDateTime(r.nextRunAt)}` : ''}</div>
              </div>
              <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await automationsApi.stopReminder(r.id); await state.reload(); })}>Stop</Button>
            </li>
          ))}
        </ul>
      ) : <p className="ops-muted">You have no reminders yet.</p>)}</Loadable>
      <ErrorNote error={error} />
      <AddReminder onAdded={() => void state.reload()} />
    </SectionCard>
  );
}

function OptIns() {
  const state = useLoad(() => automationsApi.optIns(), []);
  const { run, busy, error } = useAction();
  if (state.data && !state.data.length) return null;
  return (
    <SectionCard title="Your choices" sub="Automations that reach you only if you say yes.">
      <Loadable state={state}>{(rows) => (
        <ul className="ops-list">
          {rows.map((o) => (
            <li key={o.key} className="ops-row">
              <div className="ops-row-main">
                <div className="ops-row-title">{o.label}</div>
                <div className="ops-row-sub">“{o.preview}”{!o.schoolEnabled ? ' · switched off by the school for now' : ''}</div>
              </div>
              <label className="automation-switch">
                <input type="checkbox" checked={o.optedIn} disabled={busy} onChange={(e) => void run(async () => { await automationsApi.setOptIn(o.key, e.target.checked); await state.reload(); })} />
                <span>{o.optedIn ? 'On' : 'Off'}</span>
              </label>
            </li>
          ))}
        </ul>
      )}</Loadable>
      <ErrorNote error={error} />
    </SectionCard>
  );
}

function AutomationCard({ a, canManage, onSaved }: { a: AutomationDto; canManage: boolean; onSaved: () => void }) {
  const { run, busy, error } = useAction();
  const [ran, setRan] = useState<string | null>(null);
  const save = (body: Parameters<typeof automationsApi.update>[1]) => void run(async () => { await automationsApi.update(a.key, body); onSaved(); });
  const toggleAudience = (role: string, on: boolean) => {
    const next = on ? [...new Set([...a.audience, role])] : a.audience.filter((r) => r !== role);
    if (next.length) save({ audience: next });
  };
  return (
    <li className="automation-card" data-testid={`automation-${a.key}`}>
      <div className="automation-card-head">
        <div>
          <div className="ops-row-title">{a.label}</div>
          <div className="ops-row-sub">{a.description}</div>
        </div>
        <StatusPill status={a.effective ? 'ACTIVE' : 'INACTIVE'} label={a.effective ? 'On' : a.enabled && !a.featureOn ? 'Module off' : 'Off'} />
      </div>
      <div className="automation-meta">
        <span>{a.schedule}</span><span>{a.channels}</span>
        {a.familyFacing && <span>Reaches families</span>}
        {a.optIn && <span>Only people who opt in</span>}
        {a.lastRun && <span>Last ran {fmtDateTime(a.lastRun.at)}</span>}
      </div>
      <blockquote className="automation-preview" aria-label="Message preview">{a.preview}</blockquote>
      {canManage && (
        <div className="automation-controls">
          <label className="automation-switch">
            <input type="checkbox" checked={a.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} aria-label={`${a.label}: on or off`} />
            <span>{a.enabled ? 'On' : 'Off'}</span>
          </label>
          <label className="automation-inline">From
            <select className="input" value={String(a.hour)} disabled={busy} onChange={(e) => save({ hour: Number(e.target.value) })} aria-label={`${a.label}: hour`}>
              {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </label>
          {a.cadence === 'WEEKLY' && (
            <label className="automation-inline">On
              <select className="input" value={String(a.weekday ?? 1)} disabled={busy} onChange={(e) => save({ weekday: Number(e.target.value) })} aria-label={`${a.label}: day`}>
                {WEEKDAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          )}
          {a.audiences.length > 1 && (
            <fieldset className="automation-audience">
              <legend>Reaches</legend>
              {a.audiences.map((r) => (
                <label key={r}><input type="checkbox" checked={a.audience.includes(r)} disabled={busy} onChange={(e) => toggleAudience(r, e.target.checked)} /> {ROLE_LABEL[r] ?? r}</label>
              ))}
            </fieldset>
          )}
          <Button small variant="soft" disabled={busy || !a.effective} onClick={() => void run(async () => { const out = await automationsApi.runNow(a.key); setRan(out && 'skipped' in out ? `Not run: ${String(out.skipped)}` : 'Run finished. Messages already sent today are not sent again.'); })}>Run now</Button>
        </div>
      )}
      {ran && <p className="ops-muted" role="status">{ran}</p>}
      <ErrorNote error={error} />
    </li>
  );
}

function SchoolAutomations() {
  const state = useLoad(() => automationsApi.list(), []);
  const link = usePortalHref();
  return (
    <Loadable state={state}>{(d) => (
      <>
        <SectionCard title="School automations" sub={d.canManage ? 'Switch each one on or off, choose when it runs and who it reaches.' : 'Set by the school office. Ask your administrator to change one.'}>
          <DataNote>Nothing is sent between {hh(d.quietHours.from)} and {hh(d.quietHours.to)}. WhatsApp goes only to people who opted in; without a WhatsApp or email provider, messages are recorded as Simulated and still appear in the app.</DataNote>
          <ul className="automation-cards">
            {d.automations.map((a) => <AutomationCard key={a.key} a={a} canManage={d.canManage} onSaved={() => void state.reload()} />)}
          </ul>
        </SectionCard>
        <SectionCard title="Already automatic" sub="Run by their own modules.">
          <ul className="ops-list">
            {d.builtIn.map((b) => (
              <li key={b.key} className="ops-row"><div className="ops-row-main"><Link className="ops-row-title" href={link(b.link)}>{b.label}</Link><div className="ops-row-sub">{b.where}</div></div></li>
            ))}
          </ul>
        </SectionCard>
      </>
    )}</Loadable>
  );
}

export function AutomationsView() {
  return (
    <div className="ops-stack automations-view">
      <Today />
      <Drafts />
      <Reminders />
      <OptIns />
      <SchoolAutomations />
    </div>
  );
}
