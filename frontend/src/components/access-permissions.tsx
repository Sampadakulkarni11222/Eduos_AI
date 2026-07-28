'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import type { PermissionDto, RoleDto } from '@/lib/types';

/**
 * Backend-persisted RBAC editor.
 *
 * Renders the real permission catalog × system roles matrix straight from
 * the `roles` / `permissions` collections. Toggling a cell calls the roles
 * API (assign/revoke), so a change here is immediately enforced by every
 * backend route via requirePermission — no client-side-only state.
 */

const EDITABLE_ROLES = ['ADMIN', 'PRINCIPAL', 'TEACHER', 'FINANCE', 'LIBRARIAN', 'WARDEN', 'PARENT', 'STUDENT'];

const ROLE_COLORS: Record<string, string> = {
  OWNER: '#591620', ADMIN: '#1e3a5f', PRINCIPAL: '#065f46', TEACHER: '#7c2d12',
  FINANCE: '#4b5563', LIBRARIAN: '#4a5e8c', WARDEN: '#946312', PARENT: '#8a2f3a', STUDENT: '#43434c',
};

function Toggle({ value, scope, disabled, onToggle, onScope }: {
  value: boolean;
  scope: 'ALL' | 'OWN' | null;
  disabled?: boolean;
  onToggle: () => void;
  onScope: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={onToggle}
        style={{
          width: 40, height: 22, borderRadius: 11, border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer', padding: '2px 3px',
          display: 'flex', alignItems: 'center',
          justifyContent: value ? 'flex-end' : 'flex-start',
          transition: 'background 0.22s cubic-bezier(.4,0,.2,1)',
          opacity: disabled ? 0.55 : 1,
          background: value
            ? 'linear-gradient(135deg, #6b1a28 0%, #591620 100%)'
            : 'rgba(0,0,0,0.12)',
          boxShadow: value ? '0 2px 8px rgba(89,22,32,.35)' : 'inset 0 1px 3px rgba(0,0,0,.12)',
        }}
      >
        <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.25)', flexShrink: 0 }} />
      </button>
      {value && scope && (
        <button
          type="button"
          disabled={disabled}
          onClick={onScope}
          title="Click to switch scope: ALL = whole school, OWN = only their own classes/children/records"
          style={{
            border: 'none', background: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em',
            color: scope === 'ALL' ? '#065f46' : '#946312',
          }}
        >
          {scope}
        </button>
      )}
    </div>
  );
}

export function AccessPermissionsContent() {
  const [roles, setRoles] = useState<RoleDto[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionDto[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileRoleId, setMobileRoleId] = useState('');

  const load = () => {
    Promise.all([api.listRoles(), api.listPermissionCatalog()])
      .then(([r, p]) => { setRoles(r); setCatalog(p); setErr(null); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load roles and permissions.'));
  };
  useEffect(load, []);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDto[]>();
    for (const p of catalog ?? []) {
      const g = p.group || 'other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return [...map.entries()];
  }, [catalog]);

  const shownRoles = useMemo(
    () => (roles ?? []).filter((r) => r.key === 'OWNER' || EDITABLE_ROLES.includes(r.key))
      .sort((a, b) => (a.key === 'OWNER' ? -1 : b.key === 'OWNER' ? 1 : EDITABLE_ROLES.indexOf(a.key) - EDITABLE_ROLES.indexOf(b.key))),
    [roles],
  );

  const grantOf = (role: RoleDto, key: string) => role.permissions.find((g) => g.key === key) ?? null;

  const mobileRole = shownRoles.find((r) => r._id === mobileRoleId) ?? shownRoles[0] ?? null;

  const mutate = async (role: RoleDto, perm: PermissionDto, action: 'toggle' | 'scope') => {
    const cellId = `${role._id}:${perm.key}`;
    const grant = grantOf(role, perm.key);
    setSavingCell(cellId);
    setNotice(null);
    try {
      let updated: RoleDto;
      if (action === 'toggle') {
        updated = grant
          ? await api.revokeRolePermission(role._id, perm.key)
          : await api.assignRolePermission(role._id, { key: perm.key, scope: 'ALL' });
      } else {
        updated = await api.assignRolePermission(role._id, { key: perm.key, scope: grant?.scope === 'ALL' ? 'OWN' : 'ALL' });
      }
      setRoles((prev) => (prev ?? []).map((r) => (r._id === updated._id ? updated : r)));
      setNotice(`Saved — ${role.name} · ${perm.key}`);
    } catch (e) {
      setNotice(e instanceof ApiError ? `Could not save: ${e.message}` : 'Could not save changes.');
    } finally {
      setSavingCell(null);
    }
  };

  if (err) return <EmptyState title="Couldn't load permissions" sub={err} />;
  if (!roles || !catalog) return <Card><SkeletonRows rows={8} /></Card>;

  const colW = 96;
  const gridCols = `1.4fr ${shownRoles.map(() => `${colW}px`).join(' ')}`;

  return (
    <div>
      <style>{`.perm-row:hover { background: rgba(89,22,32,0.03) !important; }`}</style>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
        background: 'rgba(89,22,32,0.06)', border: '1px solid rgba(89,22,32,0.14)',
        borderRadius: 12, padding: '12px 16px',
      }}>
        <span style={{ fontSize: 20 }}>🔐</span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1a0a0d' }}>Role-Based Access Control</div>
          <div style={{ fontSize: 12.5, color: '#7a6a60', marginTop: 2 }}>
            Changes save instantly to the server and are enforced on every API call.
            Scope <strong>ALL</strong> covers the whole school; <strong>OWN</strong> restricts to the role's own classes, children, or records.
            The <strong>Owner</strong> role is locked.
          </div>
        </div>
      </div>

      {notice && (
        <div style={{ marginBottom: 10, fontSize: 12.5, fontWeight: 600, color: notice.startsWith('Could not') ? '#991b1b' : '#059669' }}>
          {notice}
        </div>
      )}

      <div className="rbac-desktop">
        <Card pad={false} style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 220 + shownRoles.length * colW }}>
            {/* Header */}
            <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: gridCols, background: 'rgba(89,22,32,0.05)', borderBottom: '2px solid rgba(89,22,32,0.1)', padding: '0 20px' }}>
              <div style={{ padding: '14px 0', fontSize: 12, fontWeight: 700, color: '#591620', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Permission</div>
              {shownRoles.map((r) => (
                <div key={r._id} style={{ padding: '12px 0', display: 'flex', justifyContent: 'center' }}>
                  <span style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: (ROLE_COLORS[r.key] ?? '#43434c') + '18',
                    color: ROLE_COLORS[r.key] ?? '#43434c',
                    border: `1px solid ${(ROLE_COLORS[r.key] ?? '#43434c')}30`,
                  }}>
                    {r.name}
                  </span>
                </div>
              ))}
            </div>

            {/* Groups */}
            {groups.map(([group, perms]) => (
              <div key={group}>
                <div className="no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '0 20px', background: 'rgba(234,224,210,0.5)' }}>
                  <div style={{ padding: '10px 0', fontSize: 11, fontWeight: 800, color: '#8a6a5a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group}</div>
                  {shownRoles.map((r) => <div key={r._id} />)}
                </div>
                {perms.map((perm) => (
                  <div key={perm._id} className="perm-row no-grid-collapse" style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '0 20px', borderBottom: '1px solid rgba(89,22,32,0.05)' }}>
                    <div style={{ padding: '12px 16px 12px 0' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a0a0d', fontFamily: 'ui-monospace, monospace' }}>{perm.key}</div>
                      {perm.description && <div style={{ fontSize: 11.5, color: '#9a8a7a', marginTop: 2, lineHeight: 1.5 }}>{perm.description}</div>}
                    </div>
                    {shownRoles.map((role) => {
                      const grant = grantOf(role, perm.key);
                      const locked = role.key === 'OWNER';
                      const cellId = `${role._id}:${perm.key}`;
                      return (
                        <div key={role._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: savingCell === cellId ? 0.5 : 1 }}>
                          <Toggle
                            value={Boolean(grant)}
                            scope={grant?.scope ?? null}
                            disabled={locked || savingCell === cellId}
                            onToggle={() => void mutate(role, perm, 'toggle')}
                            onScope={() => void mutate(role, perm, 'scope')}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Mobile: a role x permission matrix can't stack into cards, so this
          picks one role at a time via a dropdown instead of scrolling sideways. */}
      <div className="rbac-mobile">
        <div style={{ marginBottom: 12 }}>
          <div className="field-label">Role</div>
          <select className="field-input" style={{ marginBottom: 0 }} value={mobileRole?._id ?? ''} onChange={(e) => setMobileRoleId(e.target.value)}>
            {shownRoles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </div>

        {mobileRole && groups.map(([group, perms]) => (
          <div key={group} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#8a6a5a', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px 4px' }}>{group}</div>
            <Card pad={false}>
              {perms.map((perm, i) => {
                const grant = grantOf(mobileRole, perm.key);
                const locked = mobileRole.key === 'OWNER';
                const cellId = `${mobileRole._id}:${perm.key}`;
                return (
                  <div
                    key={perm._id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '12px 16px', borderTop: i ? '1px solid var(--hairline)' : 'none',
                      opacity: savingCell === cellId ? 0.5 : 1,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a0a0d', fontFamily: 'ui-monospace, monospace' }}>{perm.key}</div>
                      {perm.description && <div style={{ fontSize: 11.5, color: '#9a8a7a', marginTop: 2, lineHeight: 1.5 }}>{perm.description}</div>}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <Toggle
                        value={Boolean(grant)}
                        scope={grant?.scope ?? null}
                        disabled={locked || savingCell === cellId}
                        onToggle={() => void mutate(mobileRole, perm, 'toggle')}
                        onScope={() => void mutate(mobileRole, perm, 'scope')}
                      />
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: '#9a8a7a', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <Pill tone="green">ALL — whole school</Pill>
        <Pill tone="amber">OWN — own classes / children / records</Pill>
        <span>Click a grant's scope label to switch between ALL and OWN.</span>
      </div>
    </div>
  );
}
