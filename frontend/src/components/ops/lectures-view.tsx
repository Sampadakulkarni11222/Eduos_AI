'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { Attachment, LectureDto, LectureOptionsDto } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import { Drawer } from './drawer';
import {
  Attachments, DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Tile, fmtDateTime, humanize, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * Digital lectures and online meetings. Teachers schedule for their classes,
 * the principal and administration for anyone; students, parents and staff see
 * what they are invited to and join from here. The video call runs on a
 * meeting service; EduOS schedules, tells people, hands out the link and keeps
 * the recording and material afterwards.
 */
type Tab = 'upcoming' | 'past' | 'mine' | 'all';
const STATUS_PILL: Record<string, string> = { SCHEDULED: 'PENDING', LIVE: 'LIVE', ENDED: 'CLOSED', CANCELLED: 'CANCELLED' };
const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function JoinButton({ c, small }: { c: LectureDto; small?: boolean }) {
  const { run, busy, error } = useAction();
  if (c.status === 'CANCELLED' || c.status === 'ENDED') return null;
  const open = () => run(async () => {
    // Open the tab first so a pop-up blocker treats it as the user's click.
    const tab = window.open('about:blank', '_blank');
    try {
      const door = await opsApi.joinLecture(c.id);
      if (tab) { tab.opener = null; tab.location.href = door.joinUrl; } else window.location.href = door.joinUrl;
    } catch (e) { tab?.close(); throw e; }
  });
  return (
    <span className="ops-inline">
      <Button small={small} disabled={busy || (!c.joinOpen && !c.isHost)} title={c.joinOpen || c.isHost ? undefined : `Opens at ${fmtDateTime(c.joinOpensAt)}`} onClick={() => void open()}>
        {c.isHost ? (c.status === 'LIVE' ? 'Rejoin as host' : 'Start class') : c.status === 'LIVE' ? 'Join now' : 'Join'}
      </Button>
      <ErrorNote error={error} />
    </span>
  );
}

function ScheduleModal({ onClose, onDone }: { onClose: () => void; onDone: (c: LectureDto) => void }) {
  const opts = useLoad(() => opsApi.lectureOptions(), []);
  const start = new Date(Date.now() + 60 * 60_000); start.setMinutes(0, 0, 0);
  const [f, setF] = useState({ title: '', kind: 'LECTURE', description: '', sectionIds: [] as string[], inviteeRoles: [] as string[], includeGuardians: false, startsAt: isoLocal(start), durationMinutes: '45', repeatWeekly: '1', provider: 'JITSI', joinUrl: '', passcode: '' });
  const { run, busy, error } = useAction();
  const toast = useToast();
  const toggle = (key: 'sectionIds' | 'inviteeRoles', v: string) => setF({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] });
  return (
    <Loadable state={opts}>{(o: LectureOptionsDto) => {
      const provider = o.providers.find((p) => p.key === f.provider);
      const submit = () => run(async () => {
        const c = await opsApi.createLecture({
          title: f.title, kind: f.kind, description: f.description || undefined, sectionIds: f.sectionIds, inviteeRoles: f.inviteeRoles, includeGuardians: f.includeGuardians,
          startsAt: new Date(f.startsAt).toISOString(), durationMinutes: Number(f.durationMinutes), repeatWeekly: Number(f.repeatWeekly),
          provider: f.provider, joinUrl: provider?.needsLink ? f.joinUrl : undefined, passcode: f.passcode || undefined,
        });
        const sent = c.delivery?.recipients ?? 0;
        toast(`Scheduled${(c.occurrences ?? 1) > 1 ? ` (${c.occurrences} weeks)` : ''}. ${sent} ${sent === 1 ? 'person was' : 'people were'} told.`, 'success');
        onDone(c);
      });
      return (
        <Modal title="Schedule an online class or meeting" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !f.title.trim() || (!f.sectionIds.length && !f.inviteeRoles.length) || (provider?.needsLink && !f.joinUrl.trim())} onClick={() => void submit()}>Schedule and notify</Button></>}>
          <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Class 10 Physics: Light, reflection" /></Field>
          <div className="ops-grid-2">
            <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, includeGuardians: e.target.value === 'PARENT_MEETING' ? true : f.includeGuardians })}>{o.kinds.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
            <Field label="Starts" required><input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
            <Field label="Duration (minutes)"><input className="input" type="number" min={5} max={480} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /></Field>
            <Field label="Repeat weekly" hint="1 means once. Up to 20 weeks."><input className="input" type="number" min={1} max={20} value={f.repeatWeekly} onChange={(e) => setF({ ...f, repeatWeekly: e.target.value })} /></Field>
          </div>
          <Field label="For which classes" hint={o.sections.length ? 'Students of these classes are invited.' : 'You have no classes to schedule for.'}>
            <div className="ops-chips">{o.sections.map((s) => <label key={s.id} className="ops-chip"><input type="checkbox" checked={f.sectionIds.includes(s.id)} onChange={() => toggle('sectionIds', s.id)} />{s.label}</label>)}</div>
          </Field>
          {f.sectionIds.length > 0 && <label className="ops-chip"><input type="checkbox" checked={f.includeGuardians} onChange={(e) => setF({ ...f, includeGuardians: e.target.checked })} />Invite their parents too</label>}
          {o.canInviteRoles && (
            <Field label="Staff to invite" hint="Every person with the role is invited.">
              <div className="ops-chips">{o.staffRoles.map((r) => <label key={r} className="ops-chip"><input type="checkbox" checked={f.inviteeRoles.includes(r)} onChange={() => toggle('inviteeRoles', r)} />{humanize(r)}</label>)}</div>
            </Field>
          )}
          <Field label="Where the call happens">
            <select className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>{o.providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          </Field>
          {provider && <p className="ops-muted">{provider.note}</p>}
          {provider?.needsLink && <Field label="Meeting link" required><input className="input" value={f.joinUrl} onChange={(e) => setF({ ...f, joinUrl: e.target.value })} placeholder="https://" /></Field>}
          {provider?.needsLink && <Field label="Passcode (if any)"><input className="input" value={f.passcode} onChange={(e) => setF({ ...f, passcode: e.target.value })} /></Field>}
          <Field label="What it covers"><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <DataNote>Everyone invited is told in EduOS, by email and on WhatsApp where they have agreed to it, and reminded shortly before it starts. Messages show their real delivery status under Messages Sent.</DataNote>
          <ErrorNote error={error} />
        </Modal>
      );
    }}</Loadable>
  );
}

function LectureDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => opsApi.lecture(id), [id]);
  const report = useLoad(() => (state.data?.canManage ? opsApi.lectureAttendance(id) : Promise.resolve(null)), [id, state.data?.canManage]);
  const [prompt, setPrompt] = useState<null | 'cancel' | 'move'>(null);
  const [wrap, setWrap] = useState<null | { recordingUrl: string; summary: string; materials: Attachment[] }>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  const c = state.data;
  const after = async () => { await state.reload(); onChanged(); };
  return (
    <Drawer title={c?.title ?? 'Online class'} sub={c ? `${c.refNo} · ${humanize(c.kind)} · ${c.when}` : undefined} onClose={onClose}
      footer={c && (
        <>
          {c.canManage && c.status === 'SCHEDULED' && <Button variant="ghost" onClick={() => setPrompt('move')}>Move</Button>}
          {c.canManage && ['SCHEDULED', 'LIVE'].includes(c.status) && <Button variant="ghost" onClick={() => setPrompt('cancel')}>Cancel class</Button>}
          {c.canManage && c.status !== 'CANCELLED' && <Button variant="soft" onClick={() => setWrap({ recordingUrl: c.recordingUrl ?? '', summary: c.summary ?? '', materials: c.materials })}>{c.status === 'ENDED' ? 'Edit notes' : 'End and add notes'}</Button>}
          <JoinButton c={c} />
        </>
      )}>
      <Loadable state={state}>{(d) => (
        <div className="ops-stack">
          <div className="ops-inline"><StatusPill status={STATUS_PILL[d.status]} label={humanize(d.status)} /><span className="ops-muted">{d.durationMinutes} min · host {d.hostName ?? '—'} · {humanize(d.provider)}</span></div>
          {d.cancelReason && <p className="ops-callout is-warn">Cancelled: {d.cancelReason}</p>}
          {d.description && <p>{d.description}</p>}
          {!d.joinOpen && ['SCHEDULED'].includes(d.status) && !d.isHost && <p className="ops-muted">You can join from {fmtDateTime(d.joinOpensAt)}.</p>}
          {d.recordingUrl && <p><a className="btn btn-soft btn-sm" href={d.recordingUrl} target="_blank" rel="noopener noreferrer">Watch the recording</a></p>}
          {d.summary && <SectionCard title="Class notes"><p style={{ whiteSpace: 'pre-wrap' }}>{d.summary}</p></SectionCard>}
          {d.materials.length > 0 && <SectionCard title="Material"><Attachments items={d.materials} /></SectionCard>}
          {report.data && (
            <SectionCard title={`Joined: ${report.data.joined} of ${report.data.invited}`} sub={report.data.note}>
              <ul className="ops-list">{report.data.rows.map((r, i) => <li key={i} className="ops-row"><div className="ops-row-main">{r.name}</div>{r.joined ? <StatusPill status="CLEARED" label={`Joined${r.times > 1 ? ` ×${r.times}` : ''}`} /> : <StatusPill status="DRAFT" label="Not joined" />}</li>)}</ul>
            </SectionCard>
          )}
          <ErrorNote error={error} />
        </div>
      )}</Loadable>
      {prompt === 'cancel' && <PromptModal title="Cancel this class" label="Reason (everyone invited is told)" confirmLabel="Cancel class" danger onClose={() => setPrompt(null)} onSubmit={async (v) => { await opsApi.cancelLecture(id, v); toast('Cancelled, and people told', 'info'); await after(); }} />}
      {prompt === 'move' && c && <PromptModal title="Move this class" label="New start (YYYY-MM-DD HH:MM)" multiline={false} confirmLabel="Move and notify" onClose={() => setPrompt(null)} onSubmit={async (v) => { await opsApi.updateLecture(id, { startsAt: new Date(v.replace(' ', 'T')).toISOString() }); toast('Moved, and people told', 'success'); await after(); }} />}
      {wrap && (
        <Modal title="After the class" onClose={() => setWrap(null)} footer={<><Button variant="ghost" onClick={() => setWrap(null)}>Cancel</Button><Button disabled={busy} onClick={() => void run(async () => { await opsApi.finishLecture(id, { recordingUrl: wrap.recordingUrl || null, summary: wrap.summary, materials: wrap.materials }); setWrap(null); toast('Saved', 'success'); await after(); })}>Save</Button></>}>
          <Field label="Recording link" hint="Where the recording is stored, e.g. your drive or the meeting service."><input className="input" value={wrap.recordingUrl} onChange={(e) => setWrap({ ...wrap, recordingUrl: e.target.value })} placeholder="https://" /></Field>
          <Field label="Class notes"><textarea className="input" rows={5} value={wrap.summary} onChange={(e) => setWrap({ ...wrap, summary: e.target.value })} placeholder="What was covered, and any homework." /></Field>
          <Attachments items={wrap.materials} />
          <AttachUpload label="Add material" onUploaded={(a) => setWrap({ ...wrap, materials: [...wrap.materials, { name: a.name, url: a.url }] })} />
          <ErrorNote error={error} />
        </Modal>
      )}
    </Drawer>
  );
}

export function LecturesView() {
  const { permissions } = usePermissions();
  const canSchedule = Boolean(permissions['lectures.manage']);
  const seesAll = permissions['lectures.read'] === 'ALL';
  const [tab, setTab] = useState<Tab>('upcoming');
  const [open, setOpen] = useState<string | null>(useQueryParam('id'));
  const [scheduling, setScheduling] = useState(false);
  const state = useLoad(() => opsApi.lectures({ tab }), [tab]);
  const stats = useLoad(() => opsApi.lectureStats(), []);
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past & recordings' }, ...(canSchedule ? [{ key: 'mine' as const, label: 'Hosted by me' }] : []), ...(seesAll ? [{ key: 'all' as const, label: 'All' }] : [])];
  return (
    <div className="ops-stack">
      <Loadable state={stats}>{(s) => (
        <div className="kpi-grid">
          <Tile label="Live now" value={s.liveNow} tone={s.liveNow ? 'good' : 'neutral'} />
          <Tile label="In the next 24 hours" value={s.next24Hours} />
          <Tile label="In the next 7 days" value={s.next7Days} />
        </div>
      )}</Loadable>
      <div className="ops-inline"><Tabs tabs={tabs} value={tab} onChange={setTab} />{canSchedule && <Button onClick={() => setScheduling(true)}>Schedule a class</Button>}</div>
      <Loadable state={state}>{(rows) => (
        !rows.length ? <EmptyState title={tab === 'past' ? 'No past classes' : 'Nothing scheduled'} sub={canSchedule ? 'Schedule a lecture, a doubt session or a parent meeting.' : 'Classes you are invited to appear here.'} /> : (
          <ul className="ops-list card card-pad">{rows.map((c) => (
            <li key={c.id} className="ops-row">
              <div className="ops-row-main">
                <button type="button" className="ops-row-link" onClick={() => setOpen(c.id)}>
                  <div className="ops-row-title">{c.title}</div>
                  <div className="ops-row-sub">{c.when} · {c.durationMinutes} min · {humanize(c.kind)}{c.hostName ? ` · ${c.hostName}` : ''}{c.subjectName ? ` · ${c.subjectName}` : ''}{c.recordingUrl ? ' · recording' : ''}</div>
                </button>
              </div>
              <StatusPill status={STATUS_PILL[c.status]} label={humanize(c.status)} />
              {tab !== 'past' && <JoinButton c={c} small />}
            </li>
          ))}</ul>
        )
      )}</Loadable>
      <DataNote>Joined means a person opened the meeting link from EduOS. The meeting service, not EduOS, knows how long they stayed.</DataNote>
      {scheduling && <ScheduleModal onClose={() => setScheduling(false)} onDone={(c) => { setScheduling(false); setTab('upcoming'); void state.reload(); void stats.reload(); setOpen(c.id); }} />}
      {open && <LectureDetail id={open} onClose={() => setOpen(null)} onChanged={() => { void state.reload(); void stats.reload(); }} />}
    </div>
  );
}
