'use client';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Button, EmptyState, Field, Modal, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { ApprovalDto, ApprovalPolicyDto } from '@/lib/ops-types';
import { Drawer } from './drawer';
import {
  Attachments, ErrorNote, KeyValues, Loadable, PromptModal, SectionCard, StatusPill, Tabs, Timeline,
  fmtDate, fmtDateTime, humanize, isoDay, money, useAction, useLoad, useQueryParam,
} from './kit';

/**
 * Approvals: what is waiting on me, what I asked for, and (for the principal)
 * everything, plus delegations and approval rules. Decisions are explicit
 * button presses with a reason where one is required; the server enforces
 * who may decide (maker-checker, current stage, conflicts).
 */
type Tab = 'inbox' | 'mine' | 'all' | 'delegation' | 'rules';

export function ApprovalDecisionButtons({ req, onDone, compact }: { req: ApprovalDto; onDone: (r: ApprovalDto) => void; compact?: boolean }) {
  const toast = useToast();
  const { run, busy, error } = useAction();
  const [prompt, setPrompt] = useState<null | 'REJECT' | 'RETURN'>(null);
  if (!req.canDecide) return null;
  const approve = () => run(async () => { const r = await opsApi.decide(req.id, 'APPROVE'); toast(`Approved: ${req.title}`, 'success'); onDone(r); });
  return (
    <>
      <div className="ops-decision-actions">
        <Button small={compact} onClick={() => void approve()} disabled={busy}>Approve</Button>
        <Button small={compact} variant="soft" onClick={() => setPrompt('RETURN')} disabled={busy}>Return</Button>
        <Button small={compact} variant="ghost" onClick={() => setPrompt('REJECT')} disabled={busy}>Reject</Button>
      </div>
      <ErrorNote error={error} />
      {prompt && (
        <PromptModal
          title={prompt === 'REJECT' ? `Reject "${req.title}"` : `Return "${req.title}" for changes`}
          label={prompt === 'REJECT' ? 'Reason for rejecting' : 'What needs to change'}
          hint="The requester sees this."
          confirmLabel={prompt === 'REJECT' ? 'Reject' : 'Return'}
          danger={prompt === 'REJECT'}
          onClose={() => setPrompt(null)}
          onSubmit={async (v) => { const r = await opsApi.decide(req.id, prompt, v); toast(prompt === 'REJECT' ? 'Rejected' : 'Returned to requester', 'info'); onDone(r); }}
        />
      )}
    </>
  );
}

function ApprovalDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const state = useLoad(() => opsApi.approval(id), [id]);
  const [prompt, setPrompt] = useState<null | 'conflict' | 'escalate' | 'withdraw' | 'resubmit'>(null);
  const toast = useToast();
  const r = state.data;
  return (
    <Drawer title={r ? r.title : 'Approval'} sub={r ? `${r.refNo} · ${humanize(r.category)}` : undefined} onClose={onClose}
      footer={r && (
        <>
          {r.isRequester && ['PENDING', 'RETURNED'].includes(r.status) && <Button variant="ghost" onClick={() => setPrompt('withdraw')}>Withdraw</Button>}
          {r.isRequester && r.status === 'RETURNED' && <Button onClick={() => setPrompt('resubmit')}>Resubmit</Button>}
          {r.status === 'PENDING' && (r.isOverdue || r.priority === 'URGENT') && <Button variant="soft" onClick={() => setPrompt('escalate')}>Escalate</Button>}
          {r.canDecide && <Button variant="ghost" onClick={() => setPrompt('conflict')}>Declare conflict</Button>}
        </>
      )}>
      <Loadable state={state}>{(d) => (
        <>
          <div className="ops-inline"><StatusPill status={d.status} />{d.isOverdue && <span className="ops-flag-overdue">OVERDUE</span>}<StatusPill status={d.priority} label={`${humanize(d.priority)} priority`} />{d.riskLevel !== 'LOW' && <StatusPill status="OVERDUE" label={`${humanize(d.riskLevel)} risk`} />}</div>
          <KeyValues rows={[
            ['Requested by', d.requesterName], ['Department', d.department], ['Amount', d.amountPaise ? money(d.amountPaise) : '—'],
            ['Due', fmtDate(d.dueAt)], ['Current stage', d.currentStageName ?? '—'], ['Version', `v${d.version}`],
          ]} />
          {d.summary && <div className="ops-callout" style={{ whiteSpace: 'pre-wrap' }}>{d.summary}</div>}
          {d.changeNote && <p className="ops-muted">Changes in this version: {d.changeNote}</p>}
          {d.conflictDeclarations?.length > 0 && <div className="ops-callout is-warn">Conflicts declared: {d.conflictDeclarations.map((c) => `${c.name} — ${c.declaration}`).join('; ')}</div>}
          <div>
            <h3 className="ops-section-title">Stages</h3>
            <ol className="ops-list">
              {d.stages.map((s) => (
                <li key={s.order} className="ops-row">
                  <div className="ops-row-main"><div className="ops-row-title">{s.order + 1}. {s.name}</div><div className="ops-row-sub">{humanize(s.approverRole)}{s.decidedByName ? ` · ${s.decidedByName}${s.onBehalfOfRole ? ` (delegated)` : ''} · ${fmtDateTime(s.decidedAt)}` : ''}{s.comment ? ` — “${s.comment}”` : ''}</div></div>
                  <StatusPill status={s.status === 'WAITING' ? 'DRAFT' : s.status} label={humanize(s.status)} />
                </li>
              ))}
            </ol>
          </div>
          <div><h3 className="ops-section-title">Documents</h3><Attachments items={d.attachments} /></div>
          <ApprovalDecisionButtons req={d} onDone={() => { void state.reload(); onChanged(); }} />
          <div><h3 className="ops-section-title">History</h3><Timeline items={d.history} /></div>
        </>
      )}</Loadable>
      {prompt && r && (
        <PromptModal
          title={{ conflict: 'Declare a conflict of interest', escalate: 'Escalate this request', withdraw: 'Withdraw this request', resubmit: 'Resubmit after changes' }[prompt]}
          label={{ conflict: 'Your relationship to this matter', escalate: 'Why it needs attention now', withdraw: 'Reason', resubmit: 'What you changed' }[prompt]}
          hint={prompt === 'conflict' ? 'You will no longer be able to decide this request; another approver will.' : undefined}
          onClose={() => setPrompt(null)}
          onSubmit={async (v) => {
            if (prompt === 'conflict') await opsApi.declareConflict(r.id, v);
            if (prompt === 'escalate') await opsApi.escalate(r.id, v);
            if (prompt === 'withdraw') await opsApi.withdraw(r.id, v);
            if (prompt === 'resubmit') await opsApi.resubmit(r.id, { changeNote: v });
            toast('Done', 'success');
            await state.reload(); onChanged();
          }}
        />
      )}
    </Drawer>
  );
}

function ApprovalList({ items, onOpen, onChanged, showDecide }: { items: ApprovalDto[]; onOpen: (id: string) => void; onChanged: () => void; showDecide?: boolean }) {
  if (!items.length) return <EmptyState title="Nothing here" sub="Requests will appear here as they come in." icon="✓" />;
  return (
    <ul className="ops-list">
      {items.map((r) => (
        <li key={r.id} className="ops-row">
          <div className="ops-row-main">
            <button type="button" className="ops-row-link" onClick={() => onOpen(r.id)}>
              <div className="ops-row-title">{r.title}</div>
              <div className="ops-row-sub">{r.refNo} · {humanize(r.category)} · {r.requesterName ?? '—'}{r.amountPaise ? ` · ${money(r.amountPaise)}` : ''} · due {fmtDate(r.dueAt)}{r.currentStageName ? ` · at ${r.currentStageName}` : ''}</div>
            </button>
          </div>
          {r.isOverdue && <span className="ops-flag-overdue">OVERDUE</span>}
          <StatusPill status={r.status} />
          {showDecide && <ApprovalDecisionButtons req={r} compact onDone={onChanged} />}
        </li>
      ))}
    </ul>
  );
}

const ROLES = ['PRINCIPAL', 'FINANCE', 'TRUSTEE', 'ADMIN', 'HR', 'COMPLIANCE'];

function PolicyEditor({ p, onClose, onSaved }: { p: ApprovalPolicyDto; onClose: () => void; onSaved: () => void }) {
  const [stages, setStages] = useState(p.stages.map((s) => ({ ...s, minRupees: String(s.minAmountPaise / 100) })));
  const [dueDays, setDueDays] = useState(String(p.dueDays));
  const { run, busy, error } = useAction();
  return (
    <Modal title={`Approval rule: ${humanize(p.category)}`} onClose={onClose} wide footer={<>
      {p.custom && <Button variant="ghost" onClick={() => void run(async () => { await opsApi.resetApprovalPolicy(p.category); onSaved(); onClose(); })}>Reset to default</Button>}
      <Button variant="soft" onClick={onClose}>Cancel</Button>
      <Button disabled={busy} onClick={() => void run(async () => { await opsApi.setApprovalPolicy(p.category, { dueDays: Number(dueDays), stages: stages.map((s) => ({ name: s.name, approverRole: s.approverRole, minAmountPaise: Math.round(Number(s.minRupees || 0) * 100) })) }); onSaved(); onClose(); })}>Save rule</Button>
    </>}>
      <p className="ops-muted">A stage applies when the request amount is at least its threshold. At least one stage must apply to every amount (threshold 0).</p>
      {stages.map((s, i) => (
        <div key={i} className="ops-form-grid">
          <Field label={`Stage ${i + 1} name`}><input className="input" value={s.name} onChange={(e) => setStages((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /></Field>
          <Field label="Decided by"><select className="input" value={s.approverRole} onChange={(e) => setStages((x) => x.map((y, j) => (j === i ? { ...y, approverRole: e.target.value } : y)))}>{ROLES.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select></Field>
          <Field label="Applies from (₹)"><input className="input" inputMode="decimal" value={s.minRupees} onChange={(e) => setStages((x) => x.map((y, j) => (j === i ? { ...y, minRupees: e.target.value } : y)))} /></Field>
        </div>
      ))}
      <div className="ops-inline">
        <Button small variant="soft" onClick={() => setStages((x) => [...x, { name: 'New stage', approverRole: 'PRINCIPAL', minAmountPaise: 0, minRupees: '0' }])} disabled={stages.length >= 6}>+ Stage</Button>
        {stages.length > 1 && <Button small variant="ghost" onClick={() => setStages((x) => x.slice(0, -1))}>− Last stage</Button>}
      </div>
      <Field label="Default days to decide"><input className="input" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></Field>
      <ErrorNote error={error} />
    </Modal>
  );
}

function DelegationPanel() {
  const state = useLoad(() => Promise.all([opsApi.delegations(), opsApi.orgStaff()]), []);
  const [form, setForm] = useState({ toProfileId: '', categories: '', maxRupees: '', startsOn: isoDay(), endsOn: isoDay(new Date(Date.now() + 7 * 86_400_000)), reason: '' });
  const { run, busy, error } = useAction();
  return (
    <Loadable state={state}>{([dels, staff]) => (
      <div className="ops-stack">
        <SectionCard title="Delegate my approvals" sub="For leave or absence. Up to 90 days. You can limit it to categories and an amount.">
          <div className="ops-form-grid">
            <Field label="Delegate to" required><select className="input" value={form.toProfileId} onChange={(e) => setForm({ ...form, toProfileId: e.target.value })}><option value="">Choose…</option>{staff.map((s) => <option key={s.profileId} value={s.profileId}>{s.name} ({humanize(s.roleKey)})</option>)}</select></Field>
            <Field label="From"><input type="date" className="input" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></Field>
            <Field label="Until"><input type="date" className="input" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></Field>
            <Field label="Only categories (comma separated)" hint="Leave empty for all"><input className="input" value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} placeholder="STAFF_LEAVE, EVENT" /></Field>
            <Field label="Up to amount (₹)" hint="Leave empty for no limit"><input className="input" inputMode="decimal" value={form.maxRupees} onChange={(e) => setForm({ ...form, maxRupees: e.target.value })} /></Field>
            <Field label="Reason"><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          </div>
          <div><Button disabled={busy || !form.toProfileId} onClick={() => void run(async () => {
            await opsApi.delegate({ toProfileId: form.toProfileId, startsOn: new Date(form.startsOn).toISOString(), endsOn: new Date(`${form.endsOn}T23:59:59`).toISOString(), reason: form.reason, categories: form.categories ? form.categories.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : [], maxAmountPaise: form.maxRupees ? Math.round(Number(form.maxRupees) * 100) : null });
            await state.reload();
          })}>Delegate</Button></div>
          <ErrorNote error={error} />
        </SectionCard>
        <SectionCard title="Delegations">
          {!dels.length ? <p className="ops-muted">None.</p> : (
            <ul className="ops-list">{dels.map((d) => (
              <li key={d.id} className="ops-row">
                <div className="ops-row-main"><div className="ops-row-title">{humanize(d.fromRole)} → {d.toName}</div><div className="ops-row-sub">{fmtDate(d.startsOn)} – {fmtDate(d.endsOn)}{d.categories.length ? ` · ${d.categories.map(humanize).join(', ')}` : ' · all categories'}{d.maxAmountPaise !== null ? ` · up to ${money(d.maxAmountPaise)}` : ''}</div></div>
                {d.revokedAt ? <StatusPill status="CANCELLED" label="Revoked" /> : <Button small variant="ghost" onClick={() => void run(async () => { await opsApi.revokeDelegation(d.id); await state.reload(); })}>Revoke</Button>}
              </li>
            ))}</ul>
          )}
        </SectionCard>
      </div>
    )}</Loadable>
  );
}

export function ApprovalsView() {
  const { permissions } = usePermissions();
  const canAll = permissions['approvals.read'] === 'ALL';
  const canDecide = Boolean(permissions['approvals.decide']);
  const canConfigure = Boolean(permissions['approvals.configure']);
  const [tab, setTab] = useState<Tab>(canDecide ? 'inbox' : 'mine');
  const openId = useQueryParam('id');
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<string | null>(openId);
  const inbox = useLoad(() => (canDecide ? opsApi.approvalInbox() : Promise.resolve([] as ApprovalDto[])), [canDecide]);
  const list = useLoad(() => (tab === 'mine' || tab === 'all' ? opsApi.approvals({ mine: tab === 'mine' ? 'true' : undefined, pageSize: 100 }) : Promise.resolve(null)), [tab]);
  const policies = useLoad(() => (tab === 'rules' ? opsApi.approvalPolicies() : Promise.resolve([] as ApprovalPolicyDto[])), [tab]);
  const [editing, setEditing] = useState<ApprovalPolicyDto | null>(null);
  const refresh = () => { void inbox.reload(); void list.reload(); };
  const close = () => { setSelected(null); if (openId) router.replace(pathname); };

  const tabs: Array<{ key: Tab; label: string; count?: number | null }> = [
    ...(canDecide ? [{ key: 'inbox' as Tab, label: 'Waiting on me', count: inbox.data?.length ?? null }] : []),
    { key: 'mine', label: 'My requests' },
    ...(canAll ? [{ key: 'all' as Tab, label: 'All requests' }] : []),
    ...(canDecide ? [{ key: 'delegation' as Tab, label: 'Delegation' }] : []),
    ...(canConfigure ? [{ key: 'rules' as Tab, label: 'Approval rules' }] : []),
  ];

  return (
    <div className="ops-stack">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'inbox' && <Loadable state={inbox}>{(d) => <SectionCard title="Decisions waiting on you" sub="Overdue first. You cannot decide a request you raised, and conflicts remove you from a request."><ApprovalList items={d} onOpen={setSelected} onChanged={refresh} showDecide /></SectionCard>}</Loadable>}
      {(tab === 'mine' || tab === 'all') && <Loadable state={list}>{(d) => <SectionCard title={tab === 'mine' ? 'Requests I raised' : 'All approval requests'}><ApprovalList items={d?.items ?? []} onOpen={setSelected} onChanged={refresh} /></SectionCard>}</Loadable>}
      {tab === 'delegation' && <DelegationPanel />}
      {tab === 'rules' && <Loadable state={policies}>{(d) => (
        <SectionCard title="Approval rules" sub="Who decides each kind of request, by amount. Defaults put the principal as the accountable approver, Finance first for money, and the governing body above thresholds.">
          <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Category</th><th>Stages</th><th className="num">Days</th><th /></tr></thead><tbody>
            {d.map((p) => (
              <tr key={p.category}><td>{humanize(p.category)}{p.custom && <> <StatusPill status="ASSIGNED" label="Custom" /></>}</td><td>{p.stages.map((s) => `${s.name} (${humanize(s.approverRole)}${s.minAmountPaise ? ` ≥ ${money(s.minAmountPaise)}` : ''})`).join(' → ')}</td><td className="num">{p.dueDays}</td><td><Button small variant="soft" onClick={() => setEditing(p)}>Edit</Button></td></tr>
            ))}
          </tbody></table></div>
        </SectionCard>
      )}</Loadable>}
      {selected && <ApprovalDetail id={selected} onClose={close} onChanged={refresh} />}
      {editing && <PolicyEditor p={editing} onClose={() => setEditing(null)} onSaved={() => void policies.reload()} />}
    </div>
  );
}
