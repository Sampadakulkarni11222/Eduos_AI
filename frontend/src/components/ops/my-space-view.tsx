'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { fileHref } from '@/lib/api';
import { opsApi } from '@/lib/ops-api';
import type { MyPolicyDto } from '@/lib/ops-types';
import { ConsentsPanel } from './newsroom-view';
import { Attachments, DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, fmtDate, fmtDateTime, humanize, useAction, useLoad } from './kit';

/**
 * Everything addressed to the person: policies to read and acknowledge,
 * their trainings, media consent for their children, and how the institution
 * may contact them (WhatsApp opt-in is theirs alone to give or withdraw).
 */
export function MySpaceView() {
  const policies = useLoad(() => opsApi.myPolicies(), []);
  const trainings = useLoad(() => opsApi.myTrainings(), []);
  const prefs = useLoad(() => opsApi.preferences(), []);
  const [reading, setReading] = useState<MyPolicyDto | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <Loadable state={policies}>{(rows) => (
        <SectionCard title="Policies for you" sub="Read each policy; where asked, confirm you have read it.">
          {!rows.length ? <p className="ops-muted">No policies addressed to you.</p> : (
            <ul className="ops-list">{rows.map((p) => (
              <li key={p.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setReading(p)}><div className="ops-row-title">{p.title}</div><div className="ops-row-sub">{p.code} · version {p.version} · effective {fmtDate(p.effectiveFrom)}</div></button></div>
                {p.requiresAcknowledgement ? (p.acknowledged ? <StatusPill status="CLEARED" label="Acknowledged" /> : <StatusPill status="PENDING" label="To acknowledge" />) : null}</li>
            ))}</ul>
          )}
        </SectionCard>
      )}</Loadable>
      <Loadable state={trainings}>{(rows) => (
        <SectionCard title="My trainings">
          {!rows.length ? <p className="ops-muted">No trainings assigned.</p> : (
            <ul className="ops-list">{rows.map((t) => (
              <li key={t.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{t.title}</div><div className="ops-row-sub">{humanize(t.topic)} · {fmtDateTime(t.scheduledAt)}{t.location ? ` · ${t.location}` : ''}</div><Attachments items={t.materials} /></div>
                {t.mandatory && <StatusPill status="PENDING" label="Mandatory" />}<StatusPill status={t.myStatus} />
                {t.status === 'COMPLETED' && t.myStatus === 'ATTENDED' && !t.acknowledgedAt && <Button small variant="soft" disabled={busy} onClick={() => void run(async () => { await opsApi.acknowledgeTraining(t.id); toast('Acknowledged', 'success'); await trainings.reload(); })}>I attended and understood</Button>}
              </li>
            ))}</ul>
          )}
        </SectionCard>
      )}</Loadable>
      <ConsentsPanel />
      <Loadable state={prefs}>{(p) => (
        <SectionCard title="How we contact you" sub="WhatsApp messages are sent only if you opt in. They say that something needs your attention and link here — they never carry confidential details or documents.">
          <label className="ops-inline"><input type="checkbox" checked={p.whatsappOptIn.status === 'OPTED_IN'} disabled={busy} onChange={(e) => void run(async () => { const r = await opsApi.savePreferences({ whatsappOptIn: e.target.checked }); prefs.setData(r); toast(e.target.checked ? 'WhatsApp updates on' : 'WhatsApp updates off', 'success'); })} /> Send me WhatsApp updates</label>
          <div className="ops-form-grid">
            <Field label="Quiet hours from"><select className="input" value={p.quietHours.startHour} disabled={busy} onChange={(e) => void run(async () => prefs.setData(await opsApi.savePreferences({ quietHours: { ...p.quietHours, startHour: Number(e.target.value) } })))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}</select></Field>
            <Field label="until"><select className="input" value={p.quietHours.endHour} disabled={busy} onChange={(e) => void run(async () => prefs.setData(await opsApi.savePreferences({ quietHours: { ...p.quietHours, endHour: Number(e.target.value) } })))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}</select></Field>
          </div>
          <DataNote>During quiet hours, non-urgent messages wait until morning. You always see them in the notification bell.</DataNote>
        </SectionCard>
      )}</Loadable>
      <ErrorNote error={error} />
      {reading && (
        <Modal title={`${reading.code}: ${reading.title}`} onClose={() => setReading(null)} wide footer={<>
          <Button variant="soft" onClick={() => setReading(null)}>Close</Button>
          {reading.requiresAcknowledgement && !reading.acknowledged && <Button disabled={busy} onClick={() => void run(async () => { await opsApi.acknowledgePolicy(reading.id); toast('Thank you — acknowledged', 'success'); setReading(null); await policies.reload(); })}>I have read and understood this policy</Button>}
        </>}>
          {reading.summary && <p className="ops-callout">{reading.summary}</p>}
          {reading.body && <div style={{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto', fontSize: 14, lineHeight: 1.6 }}>{reading.body}</div>}
          {reading.documentUrl && <p><a href={fileHref(reading.documentUrl)} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>Open the policy document ↗</a></p>}
        </Modal>
      )}
    </div>
  );
}

export function MessagingView() {
  const [status, setStatus] = useState('');
  const channels = useLoad(() => opsApi.channels(), []);
  const out = useLoad(() => opsApi.outbox({ status: status || undefined, pageSize: 100 }), [status]);
  return (
    <div className="ops-stack">
      <Loadable state={channels}>{(c) => (
        <SectionCard title="Channels" sub={c.whatsapp.mode === 'LIVE' ? 'WhatsApp is live.' : 'WhatsApp is not configured — messages are recorded as SIMULATED and nothing leaves the server.'}>
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Template</th><th>Category</th><th>Approved Meta template name</th></tr></thead><tbody>
            {c.whatsapp.templates.map((t) => <tr key={t.key}><td>{humanize(t.key)}</td><td>{humanize(t.category)}</td><td>{t.configuredName ?? <span className="ops-muted">not configured (WA_TEMPLATE_{t.key})</span>}</td></tr>)}
          </tbody></table></div>
          <p className="ops-muted">SMS: {humanize(c.sms.mode)} · Email: {humanize(c.email.mode)}</p>
        </SectionCard>
      )}</Loadable>
      <Tabs tabs={[{ key: '', label: 'All' }, { key: 'SENT', label: 'Sent' }, { key: 'DELIVERED', label: 'Delivered' }, { key: 'READ', label: 'Read' }, { key: 'FAILED', label: 'Failed' }, { key: 'SKIPPED_NO_CONSENT', label: 'No consent' }, { key: 'SIMULATED', label: 'Simulated' }, { key: 'DEFERRED', label: 'Quiet hours' }]} value={status} onChange={setStatus} />
      <Loadable state={out}>{(d) => !d.items.length ? <EmptyState title="No messages" sub="Operational messages appear here with their real delivery status." /> : (
        <SectionCard title="Outbound messages">
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead><tbody>
            {d.items.map((m) => <tr key={m.id}><td>{fmtDateTime(m.createdAt)}</td><td>{m.recipientMasked ?? '—'}</td><td>{m.preview}<div className="ops-muted">{humanize(m.templateKey)} · {humanize(m.channel)}</div></td><td><StatusPill status={m.status} />{m.statusReason && <div className="ops-muted">{m.statusReason}</div>}</td></tr>)}
          </tbody></table></div>
        </SectionCard>
      )}</Loadable>
      <DataNote>Statuses come from the provider: sent, delivered and read only when WhatsApp reports them. Nothing is marked delivered on our side alone.</DataNote>
    </div>
  );
}
