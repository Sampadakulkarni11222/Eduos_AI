'use client';
import { useMemo, useState } from 'react';
import { Button, EmptyState, Field, Modal, SearchInput, useToast } from '@/components/ui';
import { opsApi } from '@/lib/ops-api';
import { usePermissions } from '@/lib/permissions';
import type { AffiliationDto, CampusDto, InstitutionDto, OrgChartDto, OrgPosition, OrgUnitNode } from '@/lib/ops-types';
import { DataNote, ErrorNote, Loadable, SectionCard, StatusPill, Tabs, Tile, humanize, useAction, useLoad } from './kit';

/**
 * Organisation map: generated from units, positions and appointments, never
 * drawn by hand. Select a position to highlight its reporting chain (the
 * dashboard reference's "who reads what" view, applied to reporting lines).
 * A list view is always available for screen readers and small screens.
 */

function Position({ p, highlighted, onSelect }: { p: OrgPosition; highlighted: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" className={`org-pos${p.isHead ? ' is-head' : ''}${highlighted ? ' is-highlight' : ''}`} onClick={() => onSelect(p.id)} aria-pressed={highlighted} style={{ textAlign: 'left' }}>
      <div className="org-pos-title">{p.title}</div>
      <div className="org-pos-people">
        {p.holders.length ? p.holders.map((h) => <div key={h.appointmentId}>{h.name}{h.kind !== 'PRIMARY' ? ` (${humanize(h.kind)})` : ''}{h.flagged ? ' ⚠' : ''}</div>) : null}
        {p.vacancies > 0 && <div className="org-vacant">{p.vacancies} vacant</div>}
      </div>
    </button>
  );
}

function Unit({ u, depth, chain, onSelect, open, toggle }: { u: OrgUnitNode; depth: number; chain: Set<string>; onSelect: (id: string) => void; open: Set<string>; toggle: (id: string) => void }) {
  const isOpen = open.has(u.id) || depth < 2;
  return (
    <li className="org-unit">
      <div className="org-unit-head">
        {u.children.length > 0 && <button type="button" className="org-unit-toggle" onClick={() => toggle(u.id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${u.name}`}>{isOpen ? '−' : '+'}</button>}
        <span>{u.name}</span><span className="ops-chip">{humanize(u.kind)}</span>
      </div>
      {u.positions.length > 0 && <div className="org-positions">{u.positions.map((p) => <Position key={p.id} p={p} highlighted={chain.has(p.id)} onSelect={onSelect} />)}</div>}
      {isOpen && u.children.length > 0 && <ul className="org-tree">{u.children.map((c) => <Unit key={c.id} u={c} depth={depth + 1} chain={chain} onSelect={onSelect} open={open} toggle={toggle} />)}</ul>}
    </li>
  );
}

function PositionModal({ chart, pos, onClose, onSaved }: { chart: OrgChartDto; pos: OrgPosition | null; onClose: () => void; onSaved: () => void }) {
  const staff = useLoad(() => opsApi.orgStaff(), []);
  const units: Array<{ id: string; name: string }> = [];
  const walk = (n: OrgUnitNode[], prefix = '') => n.forEach((u) => { units.push({ id: u.id, name: `${prefix}${u.name}` }); walk(u.children, `${prefix}— `); });
  walk(chart.tree);
  const [f, setF] = useState({ title: pos?.title ?? '', orgUnitId: pos?.orgUnitId ?? units[0]?.id ?? '', reportsToPositionId: pos?.reportsToPositionId ?? '', sanctioned: String(pos?.sanctioned ?? 1), isHead: pos?.isHead ?? false });
  const [appointee, setAppointee] = useState('');
  const { run, busy, error } = useAction();
  return (
    <Modal title={pos ? pos.title : 'New position'} onClose={onClose} wide footer={<><Button variant="soft" onClick={onClose}>Close</Button><Button disabled={busy || !f.title} onClick={() => void run(async () => { await opsApi.orgPosition({ ...f, reportsToPositionId: f.reportsToPositionId || null, sanctioned: Number(f.sanctioned) }, pos?.id); onSaved(); onClose(); })}>Save position</Button></>}>
      <div className="ops-form-grid">
        <Field label="Title" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Unit"><select className="input" value={f.orgUnitId} onChange={(e) => setF({ ...f, orgUnitId: e.target.value })}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Reports to"><select className="input" value={f.reportsToPositionId} onChange={(e) => setF({ ...f, reportsToPositionId: e.target.value })}><option value="">—</option>{chart.positions.filter((p) => p.id !== pos?.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
        <Field label="Sanctioned posts"><input className="input" inputMode="numeric" value={f.sanctioned} onChange={(e) => setF({ ...f, sanctioned: e.target.value })} /></Field>
      </div>
      <label className="ops-inline"><input type="checkbox" checked={f.isHead} onChange={(e) => setF({ ...f, isHead: e.target.checked })} /> Head of unit</label>
      {pos && (
        <SectionCard title="People">
          <ul className="ops-list">{pos.holders.map((h) => <li key={h.appointmentId} className="ops-row"><div className="ops-row-main">{h.name}{h.flagged ? ' — account inactive' : ''}</div><Button small variant="ghost" onClick={() => void run(async () => { await opsApi.orgEndAppointment(h.appointmentId); onSaved(); onClose(); })}>End appointment</Button></li>)}</ul>
          <div className="ops-inline"><select className="input" value={appointee} onChange={(e) => setAppointee(e.target.value)} aria-label="Appoint"><option value="">Appoint…</option>{(staff.data ?? []).map((s) => <option key={s.profileId} value={s.profileId}>{s.name} ({humanize(s.roleKey)})</option>)}</select><Button small disabled={!appointee || busy} onClick={() => void run(async () => { await opsApi.orgAppoint({ positionId: pos.id, profileId: appointee }); onSaved(); onClose(); })}>Appoint</Button></div>
        </SectionCard>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}

export function OrganizationView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['org.manage']);
  const state = useLoad(() => opsApi.orgChart(), []);
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<OrgPosition | null | 'new'>(null);
  const [unitName, setUnitName] = useState('');
  const { run, busy, error } = useAction();
  const toast = useToast();
  const chain = useMemo(() => {
    const ids = new Set<string>();
    if (!selected || !state.data) return ids;
    const byId = new Map(state.data.positions.map((p) => [p.id, p]));
    let cur: string | null = selected;
    for (let i = 0; cur && i < 50; i++) { ids.add(cur); cur = byId.get(cur)?.reportsToPositionId ?? null; }
    for (const p of state.data.positions) if (p.reportsToPositionId === selected || p.dottedLineToPositionIds.includes(selected)) ids.add(p.id);
    return ids;
  }, [selected, state.data]);
  return (
    <Loadable state={state}>{(chart) => (
      <div className="ops-stack">
        <div className="kpi-grid">
          <Tile label="Positions" value={chart.stats.positions} />
          <Tile label="Filled / sanctioned" value={`${chart.stats.filled}/${chart.stats.sanctioned}`} />
          <Tile label="Vacancies" value={chart.stats.vacancies} tone={chart.stats.vacancies ? 'warn' : 'good'} />
          <Tile label="Staff not placed" value={chart.stats.unplaced} tone={chart.stats.unplaced ? 'warn' : 'good'} />
          <Tile label="Flagged appointments" value={chart.stats.flagged} tone={chart.stats.flagged ? 'bad' : 'good'} />
        </div>
        {!chart.tree.length ? (
          <EmptyState title="No structure yet" sub="Generate it from the staff already in EduOS, then adjust." action={canManage ? <Button disabled={busy} onClick={() => void run(async () => { await opsApi.orgBootstrap(); toast('Structure created from staff records', 'success'); await state.reload(); })}>Generate from staff records</Button> : undefined} />
        ) : (
          <>
            <div className="ops-inline">
              <Tabs tabs={[{ key: 'map', label: 'Map' }, { key: 'list', label: 'List' }]} value={mode} onChange={setMode} />
              <SearchInput value={q} onChange={setQ} placeholder="Find a person or position" />
              {canManage && <Button small onClick={() => setEdit('new')}>+ Position</Button>}
              {canManage && <><input className="input" value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="New department name" aria-label="New department name" /><Button small variant="soft" disabled={!unitName || busy} onClick={() => void run(async () => { await opsApi.orgUnit({ name: unitName, kind: 'DEPARTMENT', parentId: chart.tree[0]?.children[0]?.id ?? chart.tree[0]?.id }); setUnitName(''); await state.reload(); })}>+ Department</Button></>}
              {selected && <Button small variant="ghost" onClick={() => setSelected(null)}>Clear highlight</Button>}
            </div>
            {q && (
              <SectionCard title="Matches">
                <ul className="ops-list">{chart.positions.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()) || p.holders.some((h) => h.name.toLowerCase().includes(q.toLowerCase()))).map((p) => <li key={p.id} className="ops-row"><button type="button" className="ops-row-link" onClick={() => { setSelected(p.id); setQ(''); }}><div className="ops-row-title">{p.title}</div><div className="ops-row-sub">{p.holders.map((h) => h.name).join(', ') || 'vacant'}</div></button></li>)}</ul>
              </SectionCard>
            )}
            {mode === 'map' ? (
              <SectionCard title="Organisation" sub="Select a position to highlight who it reports to and who reports to it.">
                <ul className="org-tree">{chart.tree.map((u) => <Unit key={u.id} u={u} depth={0} chain={chain} onSelect={(id) => { setSelected(id === selected ? null : id); if (canManage && id === selected) setEdit(chart.positions.find((p) => p.id === id) ?? null); }} open={open} toggle={(id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />)}</ul>
                {canManage && selected && <Button small variant="soft" onClick={() => setEdit(chart.positions.find((p) => p.id === selected) ?? null)}>Edit selected position</Button>}
              </SectionCard>
            ) : (
              <SectionCard title="Positions">
                <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Position</th><th>People</th><th>Reports to</th><th className="num">Vacant</th></tr></thead><tbody>
                  {chart.positions.map((p) => <tr key={p.id} className={canManage ? 'is-clickable' : undefined} onClick={canManage ? () => setEdit(p) : undefined}><td><b>{p.title}</b></td><td>{p.holders.map((h) => h.name).join(', ') || '—'}</td><td>{chart.positions.find((x) => x.id === p.reportsToPositionId)?.title ?? '—'}</td><td className="num">{p.vacancies}</td></tr>)}
                </tbody></table></div>
              </SectionCard>
            )}
            {chart.unplaced.length > 0 && (
              <SectionCard title="Staff not placed in the structure">
                <div className="ops-inline">{chart.unplaced.map((u) => <span key={u.profileId} className="ops-chip">{u.name} · {humanize(u.roleKey)}</span>)}</div>
              </SectionCard>
            )}
          </>
        )}
        <DataNote>The chart is built from appointments in EduOS and updates as people join, move or leave. It shows names and roles only — never salary, contact or personnel records.</DataNote>
        <ErrorNote error={error} />
        {edit && <PositionModal chart={chart} pos={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => void state.reload()} />}
      </div>
    )}</Loadable>
  );
}

const AFF_KINDS = ['BOARD', 'UNIVERSITY', 'REGULATOR', 'ACCREDITATION', 'RECOGNITION', 'OTHER'];

export function InstitutionView() {
  const { permissions } = usePermissions();
  const canManage = Boolean(permissions['institution.manage']);
  const state = useLoad(() => opsApi.institution(), []);
  const [draft, setDraft] = useState<InstitutionDto | null>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();
  return (
    <Loadable state={state}>{(saved) => {
      const d = draft ?? saved;
      const set = (patch: Partial<InstitutionDto>) => setDraft({ ...d, ...patch });
      const editable = canManage;
      return (
        <div className="ops-stack">
          <SectionCard title={d.displayName} sub={`${humanize(d.institutionType)} · profile ${d.completeness.percent}% complete`} actions={editable && draft ? <><Button variant="soft" onClick={() => setDraft(null)}>Discard</Button><Button disabled={busy} onClick={() => void run(async () => { const r = await opsApi.saveInstitution(d); state.setData(r); setDraft(null); toast('Saved', 'success'); })}>Save</Button></> : undefined}>
            <div className="ops-bar"><span style={{ width: `${d.completeness.percent}%` }} /></div>
            {d.completeness.missing.length > 0 && <p className="ops-muted">Missing: {d.completeness.missing.join(' · ')}</p>}
            <div className="ops-form-grid">
              <Field label="Display name"><input className="input" value={d.displayName} disabled={!editable} onChange={(e) => set({ displayName: e.target.value })} /></Field>
              <Field label="Legal name"><input className="input" value={d.legalName ?? ''} disabled={!editable} onChange={(e) => set({ legalName: e.target.value })} /></Field>
              <Field label="Type" hint="Switches terminology: Class/Section/Term or Programme/Batch/Semester"><select className="input" value={d.institutionType} disabled={!editable} onChange={(e) => set({ institutionType: e.target.value as InstitutionDto['institutionType'] })}><option value="SCHOOL">School</option><option value="COLLEGE">College</option><option value="COMBINED">School and college</option></select></Field>
              <Field label="Management"><select className="input" value={d.management ?? ''} disabled={!editable} onChange={(e) => set({ management: e.target.value || null })}><option value="">—</option><option value="PRIVATE_UNAIDED">Private unaided</option><option value="PRIVATE_AIDED">Private aided</option><option value="GOVERNMENT">Government</option><option value="CENTRAL">Central</option><option value="OTHER">Other</option></select></Field>
              <Field label="Legal entity"><select className="input" value={d.legalEntity?.type ?? ''} disabled={!editable} onChange={(e) => set({ legalEntity: { ...d.legalEntity, type: e.target.value || null } })}><option value="">—</option><option value="TRUST">Trust</option><option value="SOCIETY">Society</option><option value="SECTION_8_COMPANY">Section 8 company</option><option value="GOVERNMENT">Government</option><option value="AIDED">Aided</option><option value="OTHER">Other</option></select></Field>
              <Field label="Entity name"><input className="input" value={d.legalEntity?.name ?? ''} disabled={!editable} onChange={(e) => set({ legalEntity: { ...d.legalEntity, name: e.target.value } })} /></Field>
              <Field label="Registration no."><input className="input" value={d.legalEntity?.registrationNo ?? ''} disabled={!editable} onChange={(e) => set({ legalEntity: { ...d.legalEntity, registrationNo: e.target.value } })} /></Field>
              <Field label="Established"><input className="input" inputMode="numeric" value={d.establishedYear ?? ''} disabled={!editable} onChange={(e) => set({ establishedYear: Number(e.target.value) || null })} /></Field>
              <Field label="Email"><input className="input" value={d.contact?.email ?? ''} disabled={!editable} onChange={(e) => set({ contact: { ...d.contact, email: e.target.value } })} /></Field>
              <Field label="Phone"><input className="input" value={d.contact?.phone ?? ''} disabled={!editable} onChange={(e) => set({ contact: { ...d.contact, phone: e.target.value } })} /></Field>
              <Field label="Website"><input className="input" value={d.website ?? ''} disabled={!editable} onChange={(e) => set({ website: e.target.value })} /></Field>
              <Field label="Academic year starts (month)"><input className="input" inputMode="numeric" value={d.academicYearStartMonth} disabled={!editable} onChange={(e) => set({ academicYearStartMonth: Number(e.target.value) })} /></Field>
            </div>
            <Field label="About"><textarea className="input" rows={3} value={d.about ?? ''} disabled={!editable} onChange={(e) => set({ about: e.target.value })} style={{ width: '100%' }} /></Field>
          </SectionCard>
          <SectionCard title="Campuses" actions={editable ? <Button small variant="soft" onClick={() => set({ campuses: [...d.campuses, { code: `C${d.campuses.length + 1}`, name: '', type: d.institutionType === 'COLLEGE' ? 'COLLEGE' : 'SCHOOL' } as CampusDto] })}>+ Campus</Button> : undefined}>
            {!d.campuses.length ? <p className="ops-muted">No campus recorded.</p> : d.campuses.map((c, i) => (
              <div key={i} className="ops-form-grid">
                {(['code', 'name', 'city', 'district', 'state', 'pincode', 'udiseCode', 'aisheCode'] as const).map((k) => (
                  <Field key={k} label={humanize(k === 'udiseCode' ? 'UDISE+ code' : k === 'aisheCode' ? 'AISHE code' : k)}><input className="input" value={(c[k] as string | null | undefined) ?? ''} disabled={!editable} onChange={(e) => set({ campuses: d.campuses.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)) })} /></Field>
                ))}
                <Field label="Campus type"><select className="input" value={c.type} disabled={!editable} onChange={(e) => set({ campuses: d.campuses.map((y, j) => (j === i ? { ...y, type: e.target.value as CampusDto['type'] } : y)) })}><option value="SCHOOL">School</option><option value="COLLEGE">College</option></select></Field>
              </div>
            ))}
          </SectionCard>
          <SectionCard title="Affiliations & recognition" actions={editable ? <Button small variant="soft" onClick={() => set({ affiliations: [...d.affiliations, { body: '', kind: 'BOARD', status: 'ACTIVE' } as AffiliationDto] })}>+ Affiliation</Button> : undefined}>
            {!d.affiliations.length ? <p className="ops-muted">None recorded. CBSE / CISCE / state board / university / AICTE / NAAC.</p> : d.affiliations.map((a, i) => (
              <div key={i} className="ops-form-grid">
                <Field label="Body"><input className="input" value={a.body} disabled={!editable} onChange={(e) => set({ affiliations: d.affiliations.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)) })} /></Field>
                <Field label="Kind"><select className="input" value={a.kind} disabled={!editable} onChange={(e) => set({ affiliations: d.affiliations.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)) })}>{AFF_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
                <Field label="Number"><input className="input" value={a.number ?? ''} disabled={!editable} onChange={(e) => set({ affiliations: d.affiliations.map((y, j) => (j === i ? { ...y, number: e.target.value } : y)) })} /></Field>
                <Field label="Valid to"><input type="date" className="input" value={a.validTo?.slice(0, 10) ?? ''} disabled={!editable} onChange={(e) => set({ affiliations: d.affiliations.map((y, j) => (j === i ? { ...y, validTo: e.target.value || null } : y)) })} /></Field>
                <Field label="Status"><select className="input" value={a.status ?? 'ACTIVE'} disabled={!editable} onChange={(e) => set({ affiliations: d.affiliations.map((y, j) => (j === i ? { ...y, status: e.target.value } : y)) })}><option value="ACTIVE">Active</option><option value="PROVISIONAL">Provisional</option><option value="APPLIED">Applied</option><option value="EXPIRED">Expired</option><option value="WITHDRAWN">Withdrawn</option></select></Field>
              </div>
            ))}
          </SectionCard>
          <SectionCard title="Public disclosures" sub="Only items marked public appear on the public page (e.g. CBSE mandatory public disclosure)." actions={editable ? <Button small variant="soft" onClick={() => set({ disclosures: [...d.disclosures, { title: '', category: 'GENERAL', url: null, text: null, public: false }] })}>+ Item</Button> : undefined}>
            {d.disclosures.map((x, i) => (
              <div key={i} className="ops-inline" style={{ marginBottom: 6 }}>
                <input className="input" value={x.title} disabled={!editable} onChange={(e) => set({ disclosures: d.disclosures.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)) })} placeholder="Title" aria-label={`Disclosure ${i + 1}`} style={{ flex: 1 }} />
                <input className="input" value={x.url ?? ''} disabled={!editable} onChange={(e) => set({ disclosures: d.disclosures.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)) })} placeholder="Document URL" aria-label="URL" />
                <label className="ops-chip"><input type="checkbox" checked={x.public} disabled={!editable} onChange={(e) => set({ disclosures: d.disclosures.map((y, j) => (j === i ? { ...y, public: e.target.checked } : y)) })} />public</label>
              </div>
            ))}
          </SectionCard>
          <SectionCard title="Terminology in use">
            <div className="ops-inline">{Object.entries(d.terminology).map(([k, v]) => <span key={k} className="ops-chip">{humanize(k)}: <b>{v}</b></span>)}</div>
          </SectionCard>
          {!editable && <StatusPill status="DRAFT" label="Read only" />}
          <ErrorNote error={error} />
        </div>
      );
    }}</Loadable>
  );
}
