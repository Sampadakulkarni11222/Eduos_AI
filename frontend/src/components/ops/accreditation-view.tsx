'use client';
import { useState } from 'react';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { opsApi } from '@/lib/ops-api';
import type { AccreditationCycleDto, AccreditationItemDto, Attachment } from '@/lib/ops-types';
import { AttachUpload } from './attach';
import {
  Attachments, DataNote, ErrorNote, Loadable, PromptModal, SectionCard, StatusPill, fmtDate, humanize, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * Accreditation preparation: evidence by criterion, with an owner and proof
 * for each item. The page tracks readiness; it does not score the institution
 * or submit to an agency.
 */
const ITEM_STATUS: Record<string, string> = { NOT_STARTED: 'DRAFT', IN_PROGRESS: 'PENDING', READY: 'CLEARED', NOT_APPLICABLE: 'CLOSED' };
const pct = (n: number | null) => (n === null ? 'Not available' : `${n}%`);

/** One evidence item: its status, proof and the actions its owner or a manager may take. */
export function EvidenceItemRow({ cycleId, item, canEdit, locked, onChanged }: { cycleId: string; item: AccreditationItemDto; canEdit: boolean; locked: boolean; onChanged: (c: AccreditationCycleDto) => void }) {
  const { run, busy, error } = useAction();
  const [ruleOut, setRuleOut] = useState(false);
  const save = (body: Record<string, unknown>) => run(async () => { onChanged(await opsApi.updateAccreditationItem(cycleId, item.id, body)); });
  const addProof = (a: Attachment) => void save({ evidence: [...item.evidence, { name: a.name, url: a.url }], ...(item.status === 'NOT_STARTED' ? { status: 'IN_PROGRESS' } : {}) });
  return (
    <li className="ops-row" style={{ alignItems: 'flex-start' }}>
      <div className="ops-row-main">
        <div className="ops-row-title">{item.metric}</div>
        <div className="ops-row-sub">{item.ownerName ? `Owner: ${item.ownerName}` : 'No owner yet'}{item.dueOn ? ` · due ${fmtDate(item.dueOn)}` : ''}{item.note ? ` · ${item.note}` : ''}</div>
        <Attachments items={item.evidence} />
        {canEdit && !locked && (
          <div className="ops-inline" style={{ marginTop: 6 }}>
            <AttachUpload label="Attach evidence" onUploaded={addProof} />
            {item.status !== 'READY' && <Button small disabled={busy || !item.evidence.length} title={item.evidence.length ? undefined : 'Attach the evidence first'} onClick={() => void save({ status: 'READY' })}>Mark ready</Button>}
            {item.status === 'READY' && <Button small variant="soft" disabled={busy} onClick={() => void save({ status: 'IN_PROGRESS' })}>Reopen</Button>}
            {item.status !== 'NOT_APPLICABLE' && <Button small variant="ghost" disabled={busy} onClick={() => setRuleOut(true)}>Does not apply</Button>}
          </div>
        )}
        <ErrorNote error={error} />
      </div>
      <StatusPill status={ITEM_STATUS[item.status]} label={humanize(item.status)} />
      {ruleOut && (
        <PromptModal
          title="This item does not apply"
          label="Why it does not apply to your institution"
          hint="It is left out of the readiness figure, and the reason is kept on record."
          confirmLabel="Rule out"
          onClose={() => setRuleOut(false)}
          onSubmit={async (v) => { onChanged(await opsApi.updateAccreditationItem(cycleId, item.id, { status: 'NOT_APPLICABLE', note: v })); }}
        />
      )}
    </li>
  );
}

function CycleDetail({ id, canManage, onBack }: { id: string; canManage: boolean; onBack: () => void }) {
  const state = useLoad(() => opsApi.accreditationCycle(id), [id]);
  const staff = useLoad(() => (canManage ? api.listTeachers().catch(() => []) : Promise.resolve([])), [canManage]);
  const [cycle, setCycle] = useState<AccreditationCycleDto | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [f, setF] = useState({ metric: '', ownerProfileId: '', dueOn: '' });
  const [prompt, setPrompt] = useState<null | 'criterion' | 'submit' | 'outcome'>(null);
  const [crit, setCrit] = useState({ code: '', title: '' });
  const [sub, setSub] = useState({ reference: '', acknowledgeIncomplete: false });
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(loaded) => {
      const c = cycle ?? loaded;
      const locked = c.status !== 'PREPARING';
      const owners = (staff.data ?? []).flatMap((s) => s.profiles.map((p) => ({ id: p.profileId, name: p.displayName })));
      return (
        <div className="ops-stack">
          <div className="ops-inline"><Button small variant="ghost" onClick={onBack}>← All cycles</Button><StatusPill status={c.status === 'PREPARING' ? 'PENDING' : 'CLEARED'} label={humanize(c.status)} /></div>
          <SectionCard title={c.title} sub={`${c.frameworkLabel}${c.programme ? ` · ${c.programme}` : ''}${c.targetDate ? ` · target ${fmtDate(c.targetDate)}` : ''}`}
            actions={canManage && !locked ? <><Button small variant="soft" onClick={() => setPrompt('criterion')}>Add criterion</Button><Button small onClick={() => setPrompt('submit')}>Record submission</Button></> : canManage && c.status === 'SUBMITTED' ? <Button small onClick={() => setPrompt('outcome')}>Record outcome</Button> : undefined}>
            <div className="ops-inline">
              <span><b>{pct(c.progress.readyPct)}</b> ready</span>
              <span className="ops-muted">{c.progress.ready} of {c.progress.counted} items · {c.progress.inProgress} in progress · {c.progress.notStarted} not started{c.progress.overdue ? ` · ${c.progress.overdue} overdue` : ''}</span>
            </div>
            {!c.templateVerified && (
              <div className="ops-callout is-warn" style={{ marginTop: 10 }}>
                <b>Check these criteria against the agency&apos;s current manual.</b> {c.templateNote}
                {canManage && !locked && <div style={{ marginTop: 6 }}><Button small variant="soft" disabled={busy} onClick={() => void run(async () => { setCycle(await opsApi.verifyAccreditationTemplate(c.id)); toast('Recorded as checked', 'success'); })}>We have checked them</Button></div>}
              </div>
            )}
            {c.submission?.reference && <p className="ops-muted" style={{ marginTop: 8 }}>Submitted {fmtDate(c.submission.at)} · reference {c.submission.reference}{c.outcome ? ` · outcome: ${c.outcome}` : ''}</p>}
            <ErrorNote error={error} />
          </SectionCard>

          {!c.criteria.length && <EmptyState title="No criteria yet" sub="Add the criteria from your framework, then the evidence each one needs." />}
          {c.criteria.map((cr) => (
            <SectionCard key={cr.id} title={`${cr.code} · ${cr.title}`} sub={cr.counted ? `${cr.ready} of ${cr.counted} ready` : 'No evidence items yet'}
              actions={canManage && !locked ? <Button small variant="soft" onClick={() => { setAdding(cr.id); setF({ metric: '', ownerProfileId: '', dueOn: '' }); }}>Add evidence item</Button> : undefined}>
              {!cr.items.length ? <p className="ops-muted">Add the metrics from your manual that fall under this criterion.</p> : (
                <ul className="ops-list">{cr.items.map((i) => <EvidenceItemRow key={i.id} cycleId={c.id} item={i} canEdit={canManage} locked={locked} onChanged={setCycle} />)}</ul>
              )}
            </SectionCard>
          ))}
          <DataNote>This page tracks whether your evidence is ready. It does not score the institution, predict a grade or submit anything to the agency.</DataNote>

          {adding && (
            <Modal title="Add evidence item" onClose={() => setAdding(null)} footer={<><Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button><Button disabled={busy || !f.metric.trim()} onClick={() => void run(async () => { setCycle(await opsApi.addAccreditationItem(c.id, adding, { metric: f.metric, ownerProfileId: f.ownerProfileId || undefined, dueOn: f.dueOn || undefined })); setAdding(null); })}>Add</Button></>}>
              <Field label="What must be shown" required hint="The metric or requirement, in the words of your manual."><textarea className="input" rows={3} value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} /></Field>
              <Field label="Owner" hint="The person who collects the evidence. They are notified and can update the item themselves.">
                <select className="input" value={f.ownerProfileId} onChange={(e) => setF({ ...f, ownerProfileId: e.target.value })}><option value="">No owner yet</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
              </Field>
              <Field label="Due on"><input className="input" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Field>
              <ErrorNote error={error} />
            </Modal>
          )}
          {prompt === 'criterion' && (
            <Modal title="Add criterion" onClose={() => setPrompt(null)} footer={<><Button variant="ghost" onClick={() => setPrompt(null)}>Cancel</Button><Button disabled={busy || !crit.code.trim() || !crit.title.trim()} onClick={() => void run(async () => { setCycle(await opsApi.addAccreditationCriterion(c.id, crit)); setPrompt(null); setCrit({ code: '', title: '' }); })}>Add</Button></>}>
              <Field label="Code" required><input className="input" value={crit.code} onChange={(e) => setCrit({ ...crit, code: e.target.value })} placeholder="e.g. C8" /></Field>
              <Field label="Title" required><input className="input" value={crit.title} onChange={(e) => setCrit({ ...crit, title: e.target.value })} /></Field>
              <ErrorNote error={error} />
            </Modal>
          )}
          {prompt === 'submit' && (
            <Modal title="Record the submission" onClose={() => setPrompt(null)} footer={<><Button variant="ghost" onClick={() => setPrompt(null)}>Cancel</Button><Button disabled={busy || !sub.reference.trim()} onClick={() => void run(async () => { setCycle(await opsApi.recordAccreditationSubmission(c.id, sub)); setPrompt(null); toast('Submission recorded', 'success'); })}>Record</Button></>}>
              <p className="ops-muted">Submit to the agency yourself, then record its reference here. Recording locks the evidence.</p>
              <Field label="Agency reference or acknowledgement number" required><input className="input" value={sub.reference} onChange={(e) => setSub({ ...sub, reference: e.target.value })} /></Field>
              {c.progress.ready < c.progress.counted && <label className="ops-chip"><input type="checkbox" checked={sub.acknowledgeIncomplete} onChange={(e) => setSub({ ...sub, acknowledgeIncomplete: e.target.checked })} />{c.progress.counted - c.progress.ready} item(s) are not ready; record it anyway</label>}
              <ErrorNote error={error} />
            </Modal>
          )}
          {prompt === 'outcome' && (
            <PromptModal title="Record the outcome" label="What the agency decided" confirmLabel="Record" onClose={() => setPrompt(null)} onSubmit={async (v) => { setCycle(await opsApi.recordAccreditationOutcome(c.id, v)); }} />
          )}
        </div>
      );
    }}</Loadable>
  );
}

export function AccreditationTab({ canManage }: { canManage: boolean }) {
  const state = useLoad(() => opsApi.accreditationCycles(), []);
  const frameworks = useLoad(() => opsApi.accreditationFrameworks(), []);
  const [open, setOpen] = useState<string | null>(useQueryParam('id'));
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ framework: 'NAAC', title: '', programme: '', targetDate: '' });
  const { run, busy, error } = useAction();
  if (open) return <CycleDetail id={open} canManage={canManage} onBack={() => { setOpen(null); void state.reload(); }} />;
  return (
    <Loadable state={state}>{(rows) => (
      <SectionCard title="Accreditation and inspections" sub="Evidence by criterion, with an owner and proof for each item." actions={canManage ? <Button small onClick={() => setCreating(true)}>New cycle</Button> : undefined}>
        {!rows.length ? <EmptyState title="No accreditation cycle yet" sub="Start one for NAAC, NBA, a board or university inspection, or your own framework." /> : (
          <ul className="ops-list">{rows.map((c) => (
            <li key={c.id} className="ops-row"><div className="ops-row-main"><button type="button" className="ops-row-link" onClick={() => setOpen(c.id)}><div className="ops-row-title">{c.title}</div><div className="ops-row-sub">{c.frameworkLabel} · {pct(c.progress.readyPct)} ready ({c.progress.ready} of {c.progress.counted}){c.targetDate ? ` · target ${fmtDate(c.targetDate)}` : ''}</div></button></div>
              <StatusPill status={c.status === 'PREPARING' ? 'PENDING' : 'CLEARED'} label={humanize(c.status)} /></li>
          ))}</ul>
        )}
        {creating && (
          <Modal title="New accreditation cycle" onClose={() => setCreating(false)} footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !f.title.trim()} onClick={() => void run(async () => { const c = await opsApi.createAccreditationCycle({ framework: f.framework, title: f.title, programme: f.programme || undefined, targetDate: f.targetDate || undefined }); setCreating(false); setOpen(c.id); })}>Create</Button></>}>
            <Field label="Framework" required>
              <select className="input" value={f.framework} onChange={(e) => setF({ ...f, framework: e.target.value })}>{(frameworks.data ?? []).map((fw) => <option key={fw.key} value={fw.key}>{fw.label}</option>)}</select>
            </Field>
            <p className="ops-muted">{(frameworks.data ?? []).find((fw) => fw.key === f.framework)?.note}</p>
            <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. NAAC cycle 2027" /></Field>
            <Field label="Programme" hint="For programme accreditation such as NBA."><input className="input" value={f.programme} onChange={(e) => setF({ ...f, programme: e.target.value })} /></Field>
            <Field label="Target date"><input className="input" type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></Field>
            <ErrorNote error={error} />
          </Modal>
        )}
      </SectionCard>
    )}</Loadable>
  );
}

/** For anyone given an evidence item: their own items, wherever they sit. */
export function MyEvidencePanel() {
  const state = useLoad(() => opsApi.myAccreditationItems(), []);
  const [openCycle, setOpenCycle] = useState<AccreditationCycleDto | null>(null);
  if (!state.data?.length) return null;
  return (
    <SectionCard title="Accreditation evidence assigned to you" sub="Attach the proof for each item, then mark it ready.">
      <ul className="ops-list">{state.data.map((i) => {
        const live = openCycle?.criteria.flatMap((c) => c.items).find((x) => x.id === i.itemId);
        // The row is built from what the server holds, so adding a file never drops the files already there.
        const item: AccreditationItemDto = live ?? { id: i.itemId, metric: `${i.criterion}: ${i.metric}`, ownerProfileId: null, ownerName: null, dueOn: i.dueOn, status: i.status, note: i.note, evidence: i.evidence };
        return <EvidenceItemRow key={i.itemId} cycleId={i.cycleId} item={item} canEdit locked={false} onChanged={(c) => { setOpenCycle(c); }} />;
      })}</ul>
    </SectionCard>
  );
}
