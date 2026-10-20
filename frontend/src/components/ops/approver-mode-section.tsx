'use client';
import { useState } from 'react';
import { Button, Field, Pill } from '@/components/ui';
import { request } from '@/lib/api';
import { put } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import { DataNote, ErrorNote, Loadable, SectionCard, fmtDateTime, useAction, useLoad } from './kit';

interface ApproverModeDto { singleApproverMode: boolean; changedBy: string | null; changedAt: string | null; reason: string | null; appliesTo: string[]; roles: string[] }

/**
 * Single-approver mode (part 3). Off by default: a second person reviews
 * showcase entries, approves fixture results and offline campaigns, and
 * confirms bill payments. A small school with no second approver can switch it
 * on, with a reason; then the principal or administrator may approve their own,
 * and each such record is marked "single-approver". Changes are audit-logged.
 */
export function ApproverModeSection() {
  const { permissions } = usePermissions();
  const canManage = permissions['settings.manage'] === 'ALL';
  const state = useLoad(() => request<ApproverModeDto>('/school-policy/approver-mode'), []);
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  return (
    <SectionCard title="Single-approver mode" sub="For a small school with no second approver. Off by default.">
      <Loadable state={state}>{(m) => (
        <>
          <div className="ops-inline">
            <Pill tone={m.singleApproverMode ? 'amber' : 'green'}>{m.singleApproverMode ? 'On: the principal or administrator may approve their own' : 'Off: a second person approves'}</Pill>
            {m.changedAt && <span className="ops-muted">Changed by {m.changedBy ?? 'someone'} on {fmtDateTime(m.changedAt)}{m.reason ? `: ${m.reason}` : ''}</span>}
          </div>
          <DataNote>Applies to: {m.appliesTo.join(', ')}. Every approval made this way is marked &quot;single-approver&quot; and written to the audit log.</DataNote>
          {canManage && (m.singleApproverMode
            ? <Button variant="soft" disabled={busy} onClick={() => void run(async () => state.setData(await put<ApproverModeDto>('/school-policy/approver-mode', { enabled: false })))}>Switch off</Button>
            : (
              <div>
                <Field label="Why does the school have no second approver?" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%' }} /></Field>
                <Button disabled={busy || !reason.trim()} onClick={() => void run(async () => { state.setData(await put<ApproverModeDto>('/school-policy/approver-mode', { enabled: true, reason })); setReason(''); })}>Switch on</Button>
              </div>
            ))}
          <ErrorNote error={error} />
        </>
      )}</Loadable>
    </SectionCard>
  );
}
