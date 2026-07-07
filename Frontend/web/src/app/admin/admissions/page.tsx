'use client';
import { FormEvent, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Button, Card, Pill, SkeletonRows } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import type { Pipeline } from '@/lib/types';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', TOUR_SCHEDULED: 'Tour scheduled', APPLICATION: 'Application', ENROLLED: 'Enrolled', LOST: 'Lost',
};
const SOURCE_TONE: Record<string, 'green' | 'blue' | 'amber' | 'gray'> = {
  WHATSAPP: 'green', WEB: 'blue', REFERRAL: 'amber', WALK_IN: 'gray',
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

export default function AdmissionsPage() {
  const [pipeline, setPipeline] = useState<any>(null);
  const [pipelineErr, setPipelineErr] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [enrolledToast, setEnrolledToast] = useState<string | null>(null);

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

  const stages = ['NEW', 'CONTACTED', 'TOUR_SCHEDULED', 'APPLICATION', 'ENROLLED', 'LOST'];
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

  const { me } = useAuth();
  const { hasAccess } = usePermissions();
  const canAssign = hasAccess(me?.profile?.role, 'assign_leads');

  return (
    <PortalShell expectedSlug="admin" topbar={{
      title: 'Admission CRM', desc: 'Prospective families and their journey.',
      actions: canAssign ? <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close' : '+ Add lead'}</Button> : undefined,
    }}>
      {showForm && <NewLead onDone={() => { setShowForm(false); reload(); }} />}
      {enrolledToast && (
        <div style={{ marginBottom: 14, padding: '12px 16px', background: '#dcf5e7', border: '1px solid #a3dbb8', borderRadius: 8, fontSize: 13.5, color: '#1a6636', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <span><strong>{enrolledToast}</strong> has been enrolled and added to the Student List.</span>
        </div>
      )}
      {pipeline === null && !pipelineErr && <Card><SkeletonRows rows={5} /></Card>}
      {pipelineErr && <Card><div style={{ padding: 20, textAlign: 'center', color: 'var(--red)', fontSize: 13.5 }}>Failed to load pipeline. <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }} onClick={reload}>Retry</button></div></Card>}
      {pipeline && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, alignItems: 'start', overflowX: 'auto' }}>
          {stages.map((stage) => (
            <div key={stage} style={{ minWidth: 180 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-2b)', textTransform: 'uppercase' }}>{STAGE_LABEL[stage]}</span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{byStage[stage]?.length ?? 0}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {byStage[stage].map((lead) => {
                  const next = nextStage(stage);
                  return (
                    <Card key={lead.id} style={{ padding: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{lead.childName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{lead.guardianName} · {lead.gradeApplying ?? '—'}</div>
                      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Pill tone={SOURCE_TONE[lead.source] ?? 'gray'}>{(lead.source || '').toLowerCase()}</Pill>
                        {next && canAssign && <button onClick={() => advance(lead.id, next, lead.childName)} title={`Advance to ${STAGE_LABEL[next]}`}
                          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 16 }}>→</button>}
                      </div>
                    </Card>
                  );
                })}
                {byStage[stage].length === 0 && <div style={{ fontSize: 11.5, color: 'var(--text-faint)', padding: 8 }}>—</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalShell>
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
