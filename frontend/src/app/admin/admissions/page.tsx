'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, Pill, SkeletonRows, useToast } from '@/components/ui';
import { BulkUploadModal } from '@/components/bulk-upload-modal';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import type { LeadDetailDto } from '@/lib/types';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', TOUR_SCHEDULED: 'Tour scheduled', APPLICATION: 'Application', ENROLLED: 'Enrolled', LOST: 'Lost',
};
const SOURCE_TONE: Record<string, 'green' | 'blue' | 'amber' | 'gray'> = {
  WHATSAPP: 'green', WEB: 'blue', REFERRAL: 'amber', WALK_IN: 'gray',
};
const STAGE_TONE: Record<string, 'green' | 'blue' | 'amber' | 'gray' | 'red'> = {
  NEW: 'gray', CONTACTED: 'blue', TOUR_SCHEDULED: 'amber', APPLICATION: 'amber', ENROLLED: 'green', LOST: 'red',
};

const normalizeStage = (s: string): string => {
  const upper = (s || '').toUpperCase();
  if (upper === 'APPLIED' || upper === 'APPLICATION') return 'APPLICATION';
  if (upper === 'TOUR' || upper === 'TOUR_SCHEDULED') return 'TOUR_SCHEDULED';
  if (upper === 'NEW') return 'NEW';
  if (upper === 'CONTACTED') return 'CONTACTED';
  if (upper === 'ENROLLED') return 'ENROLLED';
  if (upper === 'LOST') return 'LOST';
  return 'NEW';
};

const STAGES = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];

export default function AdmissionsPage() {
  const [pipeline, setPipeline] = useState<any>(null);
  const [pipelineErr, setPipelineErr] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [enrolledToast, setEnrolledToast] = useState<string | null>(null);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  const reload = () => {
    setPipelineErr(false);
    api.pipeline().then(setPipeline).catch(() => { setPipeline(null); setPipelineErr(true); });
  };
  useEffect(() => { reload(); }, []);

  const advance = async (leadId: string, stage: string, childName?: string) => {
    await api.updateLead({ leadId, stage });
    if (stage === 'ENROLLED' && childName) {
      setEnrolledToast(childName);
      setTimeout(() => setEnrolledToast(null), 5000);
    }
    reload();
  };
  const nextStage = (s: string) => {
    const order = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED'];
    const i = order.indexOf(s);
    return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  };

  const stages = STAGES;
  const byStage: Record<string, any[]> = {
    NEW: [], CONTACTED: [], TOUR_SCHEDULED: [], APPLICATION: [], ENROLLED: [], LOST: [],
  };

  if (Array.isArray(pipeline)) {
    // Flat array of leads
    pipeline.forEach((lead: any) => {
      const st = normalizeStage(lead.stage || lead.status || 'NEW');
      byStage[st].push(lead);
    });
  } else if (pipeline && typeof pipeline === 'object') {
    // Backend returns { stages: [...], byStage: { NEW: [...], CONTACTED: [...], ... } }
    const rawByStage: Record<string, any[]> = (pipeline as any).byStage || {};
    Object.keys(rawByStage).forEach((s) => {
      const norm = normalizeStage(s);
      const list = Array.isArray(rawByStage[s]) ? rawByStage[s] : [];
      if (byStage[norm]) byStage[norm].push(...list);
    });
  }

  const totalLeads = stages.reduce((n, s) => n + byStage[s].length, 0);

  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  const canAssign = hasAccess(me?.profile?.role, 'assign_leads');

  return (
    <PortalShell expectedSlug="admin" topbar={{
      title: 'Admission CRM', desc: 'Prospective families and their journey.',
      actions: canAssign ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="soft" onClick={() => setShowBulk(true)}>⇧ Bulk upload</Button>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ Add lead'}</Button>
        </div>
      ) : undefined,
    }}>
      {showForm && <NewLead onDone={() => { setShowForm(false); reload(); }} />}
      {showBulk && (
        <BulkUploadModal
          title="Bulk import leads"
          description="Upload a CSV of prospective families to add them straight into the pipeline as NEW leads."
          templateHeaders={['childName', 'guardianName', 'phone', 'email', 'gradeApplying', 'source', 'stage', 'notes']}
          templateSampleRow={['Aarav Sharma', 'Rohit Sharma', '+919876500001', 'rohit@example.com', 'Class 5', 'WALK_IN', 'NEW', 'Interested in sports']}
          onSubmit={(file) => api.bulkImportLeads(file)}
          onClose={() => setShowBulk(false)}
          onImported={() => reload()}
        />
      )}
      {enrolledToast && (
        <div style={{ marginBottom: 14, padding: '12px 16px', background: '#dcf5e7', border: '1px solid #a3dbb8', borderRadius: 8, fontSize: 13.5, color: '#1a6636', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <span><strong>{enrolledToast}</strong> has been enrolled and added to the Student List.</span>
        </div>
      )}
      {pipeline === null && !pipelineErr && <Card><SkeletonRows rows={5} /></Card>}
      {pipelineErr && <Card><div style={{ padding: 20, textAlign: 'center', color: 'var(--red)', fontSize: 13.5 }}>Failed to load pipeline. <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }} onClick={reload}>Retry</button></div></Card>}
      {pipeline && (
        <>
          <div className="kanban-hint">
            <span aria-hidden="true">↔</span>
            <span>
              {stages.length} pipeline stages · {totalLeads} lead{totalLeads === 1 ? '' : 's'} — scroll sideways to see every stage, and select a lead to open its details.
            </span>
          </div>
          <KanbanBoard
            stages={stages}
            byStage={byStage}
            canAssign={canAssign}
            nextStage={nextStage}
            onAdvance={advance}
            onOpenLead={setOpenLeadId}
          />
        </>
      )}

      {openLeadId && (
        <LeadDetailDrawer
          leadId={openLeadId}
          canManage={canAssign}
          onClose={() => setOpenLeadId(null)}
          onChanged={reload}
        />
      )}
    </PortalShell>
  );
}

/* ─── kanban board ───────────────────────────────────────────────
   A horizontal strip of fixed-width columns with its own scroll container.
   The edge fades are driven by the real scroll position so they only appear
   on the side that actually has more columns. */
function KanbanBoard({
  stages, byStage, canAssign, nextStage, onAdvance, onOpenLead,
}: {
  stages: string[];
  byStage: Record<string, any[]>;
  canAssign: boolean;
  nextStage: (s: string) => string | null;
  onAdvance: (leadId: string, stage: string, childName?: string) => void;
  onOpenLead: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const syncEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    syncEdges();
    window.addEventListener('resize', syncEdges);
    return () => window.removeEventListener('resize', syncEdges);
  }, [syncEdges, stages.length]);

  return (
    <div className="kanban-scroll">
      {edges.left && <div className="kanban-fade left" aria-hidden="true" />}
      {edges.right && <div className="kanban-fade right" aria-hidden="true" />}
      <div className="kanban-board" ref={scrollRef} onScroll={syncEdges}>
        {stages.map((stage) => (
          <section key={stage} className="kanban-col" aria-label={`${STAGE_LABEL[stage]} stage`}>
            <div className="kanban-col-head">
              <span className="kanban-col-title">{STAGE_LABEL[stage]}</span>
              <span className="kanban-count">{byStage[stage]?.length ?? 0}</span>
            </div>
            <div className="kanban-cards">
              {byStage[stage].map((lead) => {
                const next = nextStage(stage);
                return (
                  <div key={lead.id} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="lead-card"
                      onClick={() => onOpenLead(lead.id)}
                      aria-label={`Open details for ${lead.childName}`}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{lead.childName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{lead.guardianName} · {lead.gradeApplying ?? '—'}</div>
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Pill tone={SOURCE_TONE[lead.source] ?? 'gray'}>{(lead.source || '').toLowerCase()}</Pill>
                      </div>
                    </button>
                    {next && canAssign && (
                      <button
                        onClick={() => onAdvance(lead.id, next, lead.childName)}
                        title={`Advance to ${STAGE_LABEL[next]}`}
                        aria-label={`Advance ${lead.childName} to ${STAGE_LABEL[next]}`}
                        style={{
                          position: 'absolute', right: 8, bottom: 8, background: 'none',
                          border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
                        }}
                      >
                        →
                      </button>
                    )}
                  </div>
                );
              })}
              {byStage[stage].length === 0 && <div className="kanban-empty">No leads</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ─── lead detail drawer ─────────────────────────────────────────
   Everything shown here comes from GET /admissions/leads/:id — contact
   details, notes, stage and the recorded interaction history. Quick actions
   are limited to what the existing APIs support: tel:/mailto: hand-offs, and
   stage/notes/next-action edits through the same updateLead endpoint the
   board's advance arrow uses (so they need the same permission). */
function LeadDetailDrawer({
  leadId, canManage, onClose, onChanged,
}: {
  leadId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [lead, setLead] = useState<LeadDetailDto | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState('');
  const [notes, setNotes] = useState('');
  const [nextActionAt, setNextActionAt] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setErr(null);
    api.leadDetail(leadId)
      .then((d) => {
        setLead(d);
        setStage(d.stage);
        setNotes(d.notes ?? '');
        setNextActionAt(d.nextActionAt ? d.nextActionAt.slice(0, 10) : '');
      })
      .catch((e: any) => setErr(e?.message ?? 'Could not load this lead.'));
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previouslyFocused?.focus(); };
  }, [onClose]);

  const save = async (patch: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    try {
      await api.updateLead({ leadId, ...patch });
      toast(successMsg, 'success');
      setEditing(false);
      load();
      onChanged();
    } catch (e: any) {
      toast(e?.message ?? 'Could not update this lead.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return (
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Lead details"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="drawer-header">
          <div>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 20, fontWeight: 600, color: 'var(--text-1b)' }}>
              {lead?.childName ?? 'Lead'}
            </div>
            {lead && (
              <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 3, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill tone={STAGE_TONE[lead.stage] ?? 'gray'}>{STAGE_LABEL[lead.stage] ?? lead.stage}</Pill>
                <Pill tone={SOURCE_TONE[lead.source] ?? 'gray'}>{(lead.source || '').toLowerCase()}</Pill>
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close lead details">×</button>
        </div>

        {err && <p style={{ color: 'var(--red)', fontSize: 13 }}>⚠ {err}</p>}
        {!lead && !err && <SkeletonRows rows={5} />}

        {lead && (
          <>
            {/* Quick actions — only rendered when the underlying data/API exists. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {lead.phone && (
                <a className="btn btn-soft btn-sm" href={`tel:${lead.phone}`}>📞 Call</a>
              )}
              {lead.email && (
                <a className="btn btn-soft btn-sm" href={`mailto:${lead.email}`}>✉ Email</a>
              )}
              {canManage && !editing && (
                <Button small variant="soft" onClick={() => setEditing(true)}>✎ Edit</Button>
              )}
            </div>

            <div className="drawer-section">
              <div className="drawer-section-title">Contact</div>
              <dl>
                <div className="drawer-row"><dt>Guardian</dt><dd>{lead.guardianName || '—'}</dd></div>
                <div className="drawer-row"><dt>Phone</dt><dd>{lead.phone || '—'}</dd></div>
                <div className="drawer-row"><dt>Email</dt><dd>{lead.email || '—'}</dd></div>
                <div className="drawer-row"><dt>Grade applying</dt><dd>{lead.gradeApplying || '—'}</dd></div>
                <div className="drawer-row"><dt>Assigned to</dt><dd>{lead.assigneeName || 'Unassigned'}</dd></div>
                <div className="drawer-row"><dt>Next action</dt><dd>{lead.nextActionAt ? new Date(lead.nextActionAt).toLocaleDateString('en-IN') : '—'}</dd></div>
                <div className="drawer-row"><dt>Created</dt><dd>{fmtDate(lead.createdAt)}</dd></div>
              </dl>
            </div>

            {canManage && editing ? (
              <div className="drawer-section">
                <div className="drawer-section-title">Edit lead</div>
                <div className="field-label">Stage</div>
                <select className="field-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                <div className="field-label">Next action date</div>
                <input className="field-input" type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
                <div className="field-label">Notes</div>
                <textarea
                  className="field-input"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What was discussed with the family?"
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <Button
                    variant="soft"
                    onClick={() => {
                      setEditing(false);
                      setStage(lead.stage);
                      setNotes(lead.notes ?? '');
                      setNextActionAt(lead.nextActionAt ? lead.nextActionAt.slice(0, 10) : '');
                    }}
                    disabled={busy}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={busy}
                    style={{ flex: 1 }}
                    onClick={() => save(
                      {
                        stage,
                        notes,
                        nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null,
                      },
                      'Lead updated.',
                    )}
                  >
                    {busy ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="drawer-section">
                  <div className="drawer-section-title">Notes</div>
                  <p style={{ fontSize: 13, color: lead.notes ? 'var(--text-2)' : 'var(--text-faint)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {lead.notes || 'No notes recorded for this lead.'}
                  </p>
                </div>

                {canManage && (
                  <div className="drawer-section">
                    <div className="drawer-section-title">Move stage</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select
                        className="field-input"
                        style={{ marginBottom: 0, flex: 1 }}
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                        aria-label="Pipeline stage"
                      >
                        {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                      </select>
                      <Button
                        disabled={busy || stage === lead.stage}
                        onClick={() => save({ stage }, `Moved to ${STAGE_LABEL[stage] ?? stage}.`)}
                      >
                        {busy ? 'Moving…' : 'Move'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="drawer-section">
              <div className="drawer-section-title">Activity ({lead.interactions.length})</div>
              {lead.interactions.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No activity recorded yet.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lead.interactions.map((it) => (
                  <div key={it.id} style={{ borderLeft: '2px solid var(--hairline-2)', paddingLeft: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-2b)', textTransform: 'uppercase' }}>
                      {it.type.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-1)', marginTop: 2 }}>{it.body}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2 }}>
                      {fmtDate(it.createdAt)}{it.authorName ? ` · ${it.authorName}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NewLead({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ childName: '', guardianName: '', phoneE164: '+91', gradeApplying: '', source: 'WALK_IN' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.createLead(f); onDone(); }
    catch { setErr('Failed to add lead. Please check the details and try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
          <div><div className="field-label">Child name</div><input className="field-input" value={f.childName} onChange={(e) => setF({ ...f, childName: e.target.value })} required /></div>
          <div><div className="field-label">Guardian</div><input className="field-input" value={f.guardianName} onChange={(e) => setF({ ...f, guardianName: e.target.value })} required /></div>
          <div><div className="field-label">Phone</div><input className="field-input" value={f.phoneE164} onChange={(e) => setF({ ...f, phoneE164: e.target.value })} required /></div>
          <div><div className="field-label">Grade</div><input className="field-input" value={f.gradeApplying} onChange={(e) => setF({ ...f, gradeApplying: e.target.value })} /></div>
          <div><div className="field-label">Source</div>
            <select className="field-input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              <option value="WALK_IN">Walk-in</option><option value="WHATSAPP">WhatsApp</option><option value="WEB">Web</option><option value="REFERRAL">Referral</option>
            </select>
          </div>
        </div>
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{err}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add lead'}</Button>
      </form>
    </Card>
  );
}
