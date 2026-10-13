'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { MeetingDto } from '@/lib/ops-types';
import { Drawer } from './drawer';
import { DataNote, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, fmtDate, fmtDateTime, humanize, useAction, useLoad, useQueryParam } from './kit';

/**
 * Governance: board/trustee, SMC, governing body and committee meetings —
 * availability, scheduling, agenda and papers, RSVP and conflicts, quorum,
 * attendance, minutes (approved by the chair), resolutions with votes, and
 * actions tracked to completion. Members who opted in get WhatsApp updates
 * that link back here; papers are never sent over WhatsApp.
 */
const BODIES = ['TRUST_BOARD', 'SCHOOL_MANAGEMENT_COMMITTEE', 'GOVERNING_BODY', 'ACADEMIC_COUNCIL', 'IQAC', 'FINANCE_COMMITTEE', 'PURCHASE_COMMITTEE', 'PTA_EXECUTIVE', 'OTHER'];

function MeetingDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['governance.manage']);
  const state = useLoad(() => opsApi.meeting(id), [id]);
  const [tab, setTab] = useState<'overview' | 'agenda' | 'record'>('overview');
  const [agenda, setAgenda] = useState<Array<{ title: string; presenter: string; decisionNeeded: boolean }> | null>(null);
  const [rec, setRec] = useState<{ attendance: Record<string, boolean>; minutes: string; resolutions: Array<{ text: string; votesFor: string; votesAgainst: string; abstentions: string }>; actions: Array<{ title: string; ownerName: string; dueOn: string }> } | null>(null);
  const [slots, setSlots] = useState<number[]>([]);
  const [prompt, setPrompt] = useState<null | 'cancel'>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const reload = async () => { await state.reload(); onChanged(); };
  const m = state.data;
  const act = (action: string, body: unknown, msg: string) => run(async () => { await opsApi.meetingAction(id, action, body); toast(msg, 'success'); await reload(); });
  const startRecord = (d: MeetingDto) => setRec({
    attendance: Object.fromEntries(d.members.map((x) => [x._id, x.attended ?? false])),
    minutes: d.minutes.body ?? '',
    resolutions: d.resolutions.length ? d.resolutions.map((r) => ({ text: r.text, votesFor: String(r.votesFor), votesAgainst: String(r.votesAgainst), abstentions: String(r.abstentions) })) : [],
    actions: d.actions.map((a) => ({ title: a.title, ownerName: a.ownerName ?? '', dueOn: a.dueOn?.slice(0, 10) ?? '' })),
  });
  return (
    <Drawer title={m?.title ?? 'Meeting'} sub={m ? `${m.refNo} · ${humanize(m.body)}` : undefined} onClose={onClose}
      footer={m && canManage && m.status !== 'CANCELLED' && <Button variant="ghost" onClick={() => setPrompt('cancel')}>Cancel meeting</Button>}>
      <Loadable state={state}>{(d) => (
        <>
          <div className="ops-inline"><StatusPill status={d.status} /><StatusPill status={d.agendaStatus === 'CIRCULATED' ? 'PUBLISHED' : 'DRAFT'} label={`Agenda ${humanize(d.agendaStatus)}`} />{d.quorumMet !== null && <StatusPill status={d.quorumMet ? 'CLEARED' : 'PENDING'} label={d.quorumMet ? 'Quorum met' : `Quorum ${d.presentVoting}/${d.quorum}`} />}{d.minutes.status === 'APPROVED' && <StatusPill status="APPROVED" label="Minutes approved" />}</div>
          <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'agenda', label: `Agenda (${d.agenda.length})` }, ...(canManage ? [{ key: 'record' as const, label: 'Minutes & resolutions' }] : [])]} value={tab} onChange={(t) => { setTab(t); if (t === 'record' && !rec) startRecord(d); }} />
          {tab === 'overview' && (
            <>
              <KeyValues rows={[['When', d.scheduledAt ? fmtDateTime(d.scheduledAt) : 'Being scheduled'], ['Mode', humanize(d.mode)], ['Where', d.location ?? (d.meetingLink ? 'Online' : '—')], ['Quorum', d.quorum ? String(d.quorum) : 'Not set'], ['Accepted', `${d.accepted}/${d.members.length}`]]} />
              {d.meetingLink && <p><a href={d.meetingLink} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>Join link ↗</a></p>}
              {d.status === 'PLANNING' && d.proposedSlots.length > 0 && (
                <SectionCard title="When can members attend?">
                  {d.proposedSlots.map((s, i) => (
                    <label key={i} className="ops-row" style={{ cursor: 'pointer' }}>
                      {d.isMember && <input type="checkbox" checked={slots.includes(i)} onChange={(e) => setSlots((x) => (e.target.checked ? [...x, i] : x.filter((y) => y !== i)))} />}
                      <div className="ops-row-main">{fmtDateTime(s.at)}</div><b>{s.available.length} available</b>
                      {canManage && <Button small variant="soft" onClick={(e) => { e.preventDefault(); void act('schedule', { slotIndex: i }, 'Scheduled — members notified'); }}>Choose</Button>}
                    </label>
                  ))}
                  {d.isMember && <Button small disabled={busy} onClick={() => void act('availability', { slotIndexes: slots }, 'Availability saved')}>Save my availability</Button>}
                </SectionCard>
              )}
              {d.isMember && d.status === 'SCHEDULED' && (
                <div className="ops-inline"><span>Will you attend?</span>{['ACCEPTED', 'TENTATIVE', 'DECLINED'].map((r) => <Button key={r} small variant="soft" onClick={() => void act('rsvp', { rsvp: r }, 'Response saved')}>{humanize(r)}</Button>)}</div>
              )}
              <SectionCard title="Members">
                <ul className="ops-list">{d.members.map((x) => <li key={x._id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{x.name}</div><div className="ops-row-sub">{humanize(x.role)}{x.voting ? '' : ' · non-voting'}</div></div><StatusPill status={x.rsvp === 'ACCEPTED' ? 'ACCEPTED' : x.rsvp === 'DECLINED' ? 'REJECTED' : 'PENDING'} label={humanize(x.rsvp)} />{x.attended !== null && <StatusPill status={x.attended ? 'CLEARED' : 'DRAFT'} label={x.attended ? 'Present' : 'Absent'} />}</li>)}</ul>
              </SectionCard>
              {d.minutes.body && <SectionCard title={`Minutes (${humanize(d.minutes.status)})`}><p style={{ whiteSpace: 'pre-wrap' }}>{d.minutes.body}</p>{d.minutes.status === 'DRAFT' && <Button small onClick={() => void act('minutes/approve', {}, 'Minutes approved')}>Approve minutes (chair / principal)</Button>}</SectionCard>}
              {d.resolutions.length > 0 && <SectionCard title="Resolutions"><ul className="ops-list">{d.resolutions.map((r) => <li key={r.number} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{r.number}</div><div>{r.text}</div><div className="ops-row-sub">For {r.votesFor} · Against {r.votesAgainst} · Abstain {r.abstentions}</div></div><StatusPill status={r.outcome === 'PASSED' ? 'APPROVED' : r.outcome === 'FAILED' ? 'REJECTED' : 'PENDING'} label={humanize(r.outcome)} /></li>)}</ul></SectionCard>}
              {d.actions.length > 0 && <SectionCard title="Actions"><ul className="ops-list">{d.actions.map((a) => <li key={a._id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{a.title}</div><div className="ops-row-sub">{a.ownerName ?? '—'} · due {fmtDate(a.dueOn)}</div></div><StatusPill status={a.status === 'OPEN' ? 'PENDING' : a.status === 'DONE' ? 'COMPLETED' : 'CANCELLED'} label={humanize(a.status)} />{a.status === 'OPEN' && <Button small variant="soft" onClick={() => void act(`actions/${a._id}`, { status: 'DONE' }, 'Action done')}>Done</Button>}</li>)}</ul></SectionCard>}
            </>
          )}
          {tab === 'agenda' && (
            <>
              {(agenda ?? d.agenda.map((a) => ({ title: a.title, presenter: a.presenter ?? '', decisionNeeded: a.decisionNeeded }))).map((a, i, arr) => (
                canManage && d.agendaStatus !== 'CIRCULATED' ? (
                  <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
                    <b>{i + 1}.</b>
                    <input className="input" value={a.title} onChange={(e) => setAgenda(arr.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} style={{ flex: 1 }} aria-label={`Agenda item ${i + 1}`} />
                    <input className="input" value={a.presenter} onChange={(e) => setAgenda(arr.map((y, j) => (j === i ? { ...y, presenter: e.target.value } : y)))} placeholder="Presenter" aria-label="Presenter" />
                    <label className="ops-chip"><input type="checkbox" checked={a.decisionNeeded} onChange={(e) => setAgenda(arr.map((y, j) => (j === i ? { ...y, decisionNeeded: e.target.checked } : y)))} />decision</label>
                  </div>
                ) : <div key={i} className="ops-row"><b>{i + 1}.</b><div className="ops-row-main">{a.title}{a.presenter ? ` — ${a.presenter}` : ''}</div>{a.decisionNeeded && <StatusPill status="PENDING" label="Decision" />}</div>
              ))}
              {canManage && d.agendaStatus !== 'CIRCULATED' && (
                <div className="ops-inline">
                  <Button small variant="ghost" onClick={() => setAgenda([...(agenda ?? d.agenda.map((a) => ({ title: a.title, presenter: a.presenter ?? '', decisionNeeded: a.decisionNeeded }))), { title: '', presenter: '', decisionNeeded: false }])}>+ Item</Button>
                  <Button small variant="soft" disabled={busy || !agenda} onClick={() => void act('agenda', { items: (agenda ?? []).filter((a) => a.title.trim()) }, 'Agenda saved').then(() => setAgenda(null))}>Save agenda</Button>
                  <Button small disabled={busy || !d.agenda.length} onClick={() => void act('agenda', { status: 'CIRCULATED' }, 'Agenda circulated to members')}>Circulate to members</Button>
                </div>
              )}
            </>
          )}
          {tab === 'record' && rec && (
            <>
              <SectionCard title="Attendance">{d.members.map((x) => <label key={x._id} className="ops-row"><input type="checkbox" checked={rec.attendance[x._id] ?? false} onChange={(e) => setRec({ ...rec, attendance: { ...rec.attendance, [x._id]: e.target.checked } })} /><span className="ops-row-main">{x.name}{x.voting ? '' : ' (non-voting)'}</span></label>)}</SectionCard>
              <Field label="Minutes"><textarea className="input" rows={8} value={rec.minutes} disabled={d.minutes.status === 'APPROVED'} onChange={(e) => setRec({ ...rec, minutes: e.target.value })} style={{ width: '100%' }} /></Field>
              <SectionCard title="Resolutions">
                {rec.resolutions.map((r, i) => (
                  <div key={i} className="ops-form-grid">
                    <Field label={`Resolution ${i + 1}`}><input className="input" value={r.text} onChange={(e) => setRec({ ...rec, resolutions: rec.resolutions.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} /></Field>
                    <Field label="For"><input className="input" inputMode="numeric" value={r.votesFor} onChange={(e) => setRec({ ...rec, resolutions: rec.resolutions.map((y, j) => (j === i ? { ...y, votesFor: e.target.value } : y)) })} /></Field>
                    <Field label="Against"><input className="input" inputMode="numeric" value={r.votesAgainst} onChange={(e) => setRec({ ...rec, resolutions: rec.resolutions.map((y, j) => (j === i ? { ...y, votesAgainst: e.target.value } : y)) })} /></Field>
                    <Field label="Abstain"><input className="input" inputMode="numeric" value={r.abstentions} onChange={(e) => setRec({ ...rec, resolutions: rec.resolutions.map((y, j) => (j === i ? { ...y, abstentions: e.target.value } : y)) })} /></Field>
                  </div>
                ))}
                <Button small variant="ghost" onClick={() => setRec({ ...rec, resolutions: [...rec.resolutions, { text: '', votesFor: '0', votesAgainst: '0', abstentions: '0' }] })}>+ Resolution</Button>
              </SectionCard>
              <SectionCard title="Actions">
                {rec.actions.map((a, i) => (
                  <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
                    <input className="input" value={a.title} onChange={(e) => setRec({ ...rec, actions: rec.actions.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)) })} placeholder="Action" style={{ flex: 1 }} aria-label={`Action ${i + 1}`} />
                    <input className="input" value={a.ownerName} onChange={(e) => setRec({ ...rec, actions: rec.actions.map((y, j) => (j === i ? { ...y, ownerName: e.target.value } : y)) })} placeholder="Owner" aria-label="Owner" />
                    <input type="date" className="input" value={a.dueOn} onChange={(e) => setRec({ ...rec, actions: rec.actions.map((y, j) => (j === i ? { ...y, dueOn: e.target.value } : y)) })} aria-label="Due" />
                  </div>
                ))}
                <Button small variant="ghost" onClick={() => setRec({ ...rec, actions: [...rec.actions, { title: '', ownerName: '', dueOn: '' }] })}>+ Action</Button>
              </SectionCard>
              <Button disabled={busy} onClick={() => void act('record', {
                attendance: Object.entries(rec.attendance).map(([memberId, attended]) => ({ memberId, attended })),
                ...(d.minutes.status !== 'APPROVED' && rec.minutes.trim() ? { minutes: rec.minutes } : {}),
                resolutions: rec.resolutions.filter((r) => r.text.trim()).map((r) => ({ text: r.text, votesFor: Number(r.votesFor), votesAgainst: Number(r.votesAgainst), abstentions: Number(r.abstentions) })),
                actions: rec.actions.filter((a) => a.title.trim()).map((a) => ({ ...a, dueOn: a.dueOn || null })),
              }, 'Recorded')}>Save record</Button>
            </>
          )}
          <ErrorNote error={error} />
        </>
      )}</Loadable>
      {prompt === 'cancel' && <PromptModal title="Cancel this meeting" label="Reason (members are told)" danger onClose={() => setPrompt(null)} onSubmit={(v) => opsApi.meetingAction(id, 'cancel', { reason: v }).then(reload)} />}
    </Drawer>
  );
}

export function GovernanceView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['governance.manage']);
  const openId = useQueryParam('id');
  const [selected, setSelected] = useState<string | null>(openId);
  const [creating, setCreating] = useState(false);
  const state = useLoad(() => Promise.all([opsApi.meetings(), opsApi.boardActions()]), []);
  const staff = useLoad(() => (canManage ? opsApi.orgStaff() : Promise.resolve([])), [canManage]);
  const [f, setF] = useState({ body: 'TRUST_BOARD', title: '', mode: 'IN_PERSON', location: '', meetingLink: '', quorum: '', members: [] as string[], chair: '', slots: ['', '', ''], external: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <div className="ops-stack">
      <div className="ops-inline">
        {canManage && <Button onClick={() => setCreating(true)}>+ New meeting</Button>}
        {canManage && <Button variant="soft" onClick={() => void run(async () => { const r = await opsApi.meetingReminders(); toast(`${r.messages} reminder(s) for ${r.meetings} meeting(s)`, 'info'); })}>Send reminders (next 48 h)</Button>}
      </div>
      <Loadable state={state}>{([meetings, actions]) => (
        <div className="ops-grid-main">
          <SectionCard title="Meetings">
            {!meetings.length ? <EmptyState title="No meetings" sub="Schedule a board, SMC or committee meeting." /> : (
              <ul className="ops-list">{meetings.map((m) => (
                <li key={m.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(m.id)}><div className="ops-row-title">{m.title}</div><div className="ops-row-sub">{humanize(m.body)} · {m.scheduledAt ? fmtDateTime(m.scheduledAt) : 'Being scheduled'} · {m.accepted}/{m.members.length} accepted{m.openActions ? ` · ${m.openActions} open action(s)` : ''}</div></button></div><StatusPill status={m.status} /></li>
              ))}</ul>
            )}
          </SectionCard>
          <SectionCard title="Open board actions">
            {!actions.length ? <p className="ops-muted">None.</p> : <ul className="ops-list">{actions.map((a) => <li key={a.actionId} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setSelected(a.meetingId)}><div className="ops-row-title">{a.title}</div><div className="ops-row-sub">{a.meeting} · {a.ownerName ?? '—'} · due {fmtDate(a.dueOn)}</div></button></div>{a.overdue && <span className="ops-flag-overdue">OVERDUE</span>}</li>)}</ul>}
          </SectionCard>
        </div>
      )}</Loadable>
      <DataNote>Members get WhatsApp updates only if they opted in; messages carry a link here, never the papers. Without WhatsApp credentials, messages are recorded as simulated.</DataNote>
      {creating && (
        <Modal title="New meeting" onClose={() => setCreating(false)} wide footer={<><Button variant="soft" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.title || !f.members.length} onClick={() => void run(async () => {
          const m = await opsApi.createMeeting({ body: f.body, title: f.title, mode: f.mode, location: f.location, meetingLink: f.meetingLink, quorum: f.quorum ? Number(f.quorum) : undefined, memberProfileIds: f.members, memberRoles: f.chair ? { [f.chair]: 'CHAIR' } : {}, proposedSlots: f.slots.filter(Boolean).map((s) => new Date(s).toISOString()), externalMembers: f.external.split(',').map((x) => x.trim()).filter(Boolean).map((name) => ({ name })) });
          setCreating(false); await state.reload(); setSelected(m.id);
        })}>Create & invite</Button></>}>
          <div className="ops-form-grid">
            <Field label="Body"><select className="input" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}>{BODIES.map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</select></Field>
            <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Mode"><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="IN_PERSON">In person</option><option value="ONLINE">Online</option><option value="HYBRID">Hybrid</option></select></Field>
            <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field label="Meeting link"><input className="input" value={f.meetingLink} onChange={(e) => setF({ ...f, meetingLink: e.target.value })} /></Field>
            <Field label="Quorum (members)"><input className="input" inputMode="numeric" value={f.quorum} onChange={(e) => setF({ ...f, quorum: e.target.value })} /></Field>
          </div>
          <fieldset style={{ border: 'none' }}><legend className="field-label">Members</legend>
            <div className="ops-inline">{(staff.data ?? []).filter((s) => ['TRUSTEE', 'PRINCIPAL', 'ADMIN', 'FINANCE', 'TEACHER', 'COMPLIANCE', 'HR'].includes(s.roleKey ?? '')).map((s) => <label key={s.profileId} className="ops-chip"><input type="checkbox" checked={f.members.includes(s.profileId)} onChange={(e) => setF({ ...f, members: e.target.checked ? [...f.members, s.profileId] : f.members.filter((x) => x !== s.profileId) })} />{s.name} <span className="ops-muted">{humanize(s.roleKey)}</span></label>)}</div>
          </fieldset>
          <Field label="Chair"><select className="input" value={f.chair} onChange={(e) => setF({ ...f, chair: e.target.value })}><option value="">—</option>{(staff.data ?? []).filter((s) => f.members.includes(s.profileId)).map((s) => <option key={s.profileId} value={s.profileId}>{s.name}</option>)}</select></Field>
          <Field label="Members without an account (comma separated)"><input className="input" value={f.external} onChange={(e) => setF({ ...f, external: e.target.value })} style={{ width: '100%' }} /></Field>
          <fieldset style={{ border: 'none' }}><legend className="field-label">Propose times (members mark availability)</legend>
            <div className="ops-inline">{f.slots.map((s, i) => <input key={i} type="datetime-local" className="input" value={s} onChange={(e) => setF({ ...f, slots: f.slots.map((y, j) => (j === i ? e.target.value : y)) })} aria-label={`Proposed time ${i + 1}`} />)}</div>
          </fieldset>
          <ErrorNote error={error} />
        </Modal>
      )}
      {selected && <MeetingDetail id={selected} onClose={() => setSelected(null)} onChanged={() => void state.reload()} />}
    </div>
  );
}
