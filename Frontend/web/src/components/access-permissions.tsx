'use client';
import { useState, useEffect } from 'react';
import { usePermissions, type PermissionsState, type PermissionRole, type PermissionValue } from '@/lib/permissions';

type Role = PermissionRole;
type Val = PermissionValue;

const ROLES: Role[] = ['Superadmin', 'Admin', 'Manager', 'Teacher', 'Staff'];

const GROUPS = [
  {
    title: 'PLATFORM ACCESS',
    items: [
      { id: 'disable_web', label: 'Disable Web Access', desc: 'Restrict role to mobile app only.' },
      { id: 'disable_call_tracking', label: 'Disable Call Tracking', desc: 'Unknown numbers will not be tracked.' },
      { id: 'camera_only', label: 'Camera-only Image Capture', desc: 'Disallow gallery imports; require camera capture.' },
    ],
  },
  {
    title: 'DATA OPERATIONS',
    items: [
      { id: 'export_table', label: 'Export Table Data', desc: 'Export students, contacts, and business data.' },
      { id: 'mask_phone', label: 'Mask Phone Numbers in Exports', desc: 'Partially hide phone numbers in exported files.' },
      { id: 'bulk_upload', label: 'Bulk Upload Students / Leads', desc: 'Allow mass import via spreadsheet.' },
      { id: 'delete_records', label: 'Delete Records', desc: 'Permanently remove student or staff records.' },
    ],
  },
  {
    title: 'ASSIGNMENT & WORKFLOW',
    items: [
      { id: 'assign_leads', label: 'Assign Admissions to Other Members', desc: 'Re-route admission leads between counselors.' },
      { id: 'assign_tasks', label: 'Assign Tasks to Other Members', desc: 'Delegate tasks across roles.' },
    ],
  },
  {
    title: 'FINANCE',
    items: [
      { id: 'view_fees', label: 'View Fee Records', desc: 'Access payment history and invoices.' },
      { id: 'create_invoice', label: 'Create Invoices', desc: 'Generate and send fee invoices.' },
      { id: 'record_payment', label: 'Record Payments', desc: 'Mark outstanding fees as paid.' },
    ],
  },
  {
    title: 'COMMUNICATION',
    items: [
      { id: 'send_announcements', label: 'Send Announcements', desc: 'Broadcast messages to students, parents, or staff.' },
      { id: 'send_whatsapp', label: 'Send WhatsApp Messages', desc: 'Use the WhatsApp assistant to contact users.' },
      { id: 'manage_tickets', label: 'Manage Support Tickets', desc: 'Reply and resolve parent or student tickets.' },
    ],
  },
  {
    title: 'SYSTEM & AUDIT',
    items: [
      { id: 'view_audit', label: 'View Audit Logs', desc: 'Access the full audit trail of all actions.' },
      { id: 'manage_roles', label: 'Manage Roles & Permissions', desc: 'Change role capabilities for others.' },
      { id: 'tenant_settings', label: 'Edit Tenant Settings', desc: 'Modify school name, logo, integrations.' },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────
   Toggle component
───────────────────────────────────────────────────────────────── */
function Toggle({ value, onChange }: { value: Val; onChange: (v: Val) => void }) {
  if (value === null) {
    return (
      <div style={{
        width: 36, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#b0a090', fontSize: 16, userSelect: 'none',
      }}>—</div>
    );
  }
  return (
    <button
      type="button"
      aria-checked={value}
      role="switch"
      onClick={() => onChange(!value)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        border: 'none',
        cursor: 'pointer',
        padding: '2px 3px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: value ? 'flex-end' : 'flex-start',
        transition: 'background 0.22s cubic-bezier(.4,0,.2,1)',
        background: value
          ? 'linear-gradient(135deg, #6b1a28 0%, #591620 100%)'
          : 'rgba(0,0,0,0.12)',
        boxShadow: value
          ? '0 2px 8px rgba(89,22,32,.35)'
          : 'inset 0 1px 3px rgba(0,0,0,.12)',
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
        transition: 'transform 0.18s',
        flexShrink: 0,
      }} />
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Role pill header
───────────────────────────────────────────────────────────────── */
const ROLE_COLORS: Record<Role, string> = {
  Superadmin: '#591620',
  Admin: '#1e3a5f',
  Manager: '#065f46',
  Teacher: '#7c2d12',
  Staff: '#4b5563',
};

/* ─────────────────────────────────────────────────────────────────
   Main page content
───────────────────────────────────────────────────────────────── */
export function AccessPermissionsContent() {
  const { permissions, updateAll, resetToDefaults } = usePermissions();
  const [perms, setPerms] = useState<PermissionsState>({ ...permissions });
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync state if permissions changed from outside
  useEffect(() => {
    setPerms({ ...permissions });
    setHasChanges(false);
  }, [permissions]);

  const toggle = (id: string, role: Role, val: Val) => {
    setPerms((prev: PermissionsState) => ({
      ...prev,
      [id]: { ...prev[id], [role]: val }
    }));
    setHasChanges(true);
    setSaved(false);
  };


  const reset = () => {
    resetToDefaults();
    setHasChanges(false);
    setSaved(false);
  };

  const save = () => {
    updateAll(perms);
    setSaved(true);
    setHasChanges(false);
  };

  const colW = 90;

  return (
    <div>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .perm-row:hover { background: rgba(89,22,32,0.03) !important; }
        .perm-group-header { position: sticky; top: 0; z-index: 2; }
      `}</style>

      {/* Info banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
        background: 'rgba(89,22,32,0.06)', border: '1px solid rgba(89,22,32,0.14)',
        borderRadius: 12, padding: '12px 16px', animation: 'fadeIn 0.4s ease',
      }}>
        <span style={{ fontSize: 20 }}>🔐</span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1a0a0d' }}>Role-Based Access Control</div>
          <div style={{ fontSize: 12.5, color: '#7a6a60', marginTop: 2 }}>
            Configure what each role can see and do across EduOS. Changes apply immediately after saving. <strong>Superadmin</strong> permissions are locked and cannot be disabled.
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRadius: 16,
        border: '1px solid rgba(89,22,32,0.08)',
        boxShadow: '0 4px 24px rgba(89,22,32,.07)',
        overflow: 'hidden',
        animation: 'fadeIn 0.45s ease 0.05s both',
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `1fr ${ROLES.map(() => `${colW}px`).join(' ')}`,
          background: 'rgba(89,22,32,0.05)',
          borderBottom: '2px solid rgba(89,22,32,0.1)',
          padding: '0 20px',
          position: 'sticky', top: 0, zIndex: 4,
        }}>
          <div style={{ padding: '14px 0', fontSize: 12, fontWeight: 700, color: '#591620', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Feature
          </div>
          {ROLES.map((r) => (
            <div key={r} style={{
              padding: '12px 0', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <div style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
                background: ROLE_COLORS[r] + '18',
                color: ROLE_COLORS[r],
                border: `1px solid ${ROLE_COLORS[r]}30`,
              }}>
                {r}
              </div>
            </div>
          ))}
        </div>

        {/* Groups */}
        {GROUPS.map((group, gi) => (
          <div key={group.title}>
            {/* Group label */}
            <div className="perm-group-header" style={{
              display: 'grid',
              gridTemplateColumns: `1fr ${ROLES.map(() => `${colW}px`).join(' ')}`,
              padding: '0 20px',
              background: 'rgba(234,224,210,0.5)',
              borderTop: gi > 0 ? '2px solid rgba(89,22,32,0.07)' : undefined,
            }}>
              <div style={{
                padding: '10px 0', fontSize: 11, fontWeight: 800,
                color: '#8a6a5a', letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>
                {group.title}
              </div>
              {ROLES.map((r) => <div key={r} />)}
            </div>

            {/* Rows */}
            {group.items.map((perm) => (
              <div
                key={perm.id}
                className="perm-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `1fr ${ROLES.map(() => `${colW}px`).join(' ')}`,
                  padding: '0 20px',
                  borderBottom: '1px solid rgba(89,22,32,0.05)',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ padding: '14px 0 14px', paddingRight: 16 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1a0a0d' }}>{perm.label}</div>
                  {perm.desc && (
                    <div style={{ fontSize: 11.5, color: '#9a8a7a', marginTop: 3, lineHeight: 1.5 }}>{perm.desc}</div>
                  )}
                </div>
                {ROLES.map((role) => (
                  <div key={role} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Toggle
                      value={role === 'Superadmin' ? perms[perm.id][role] : perms[perm.id][role]}
                      onChange={(v) => role !== 'Superadmin' && toggle(perm.id, role, v)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 20, padding: '14px 20px',
        background: 'rgba(255,255,255,0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: 14, border: '1px solid rgba(89,22,32,0.08)',
        boxShadow: '0 2px 12px rgba(89,22,32,.06)',
      }}>
        <button
          type="button"
          onClick={reset}
          style={{
            background: 'none', border: '1.5px solid rgba(89,22,32,0.2)',
            borderRadius: 10, padding: '9px 20px', fontSize: 13.5, fontWeight: 600,
            color: '#7a5a5a', cursor: 'pointer', fontFamily: 'inherit',
            transition: 'all 0.18s',
          }}
        >
          ↺ &nbsp;Reset to Defaults
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saved && (
            <span style={{ fontSize: 13, color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
              ✓ Changes saved
            </span>
          )}
          {hasChanges && !saved && (
            <span style={{ fontSize: 12.5, color: '#9a8a7a' }}>Unsaved changes</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!hasChanges}
            style={{
              background: hasChanges
                ? 'linear-gradient(135deg, #6b1a28 0%, #591620 100%)'
                : 'rgba(89,22,32,0.15)',
              border: 'none',
              borderRadius: 10,
              padding: '10px 28px',
              fontSize: 13.5,
              fontWeight: 700,
              color: hasChanges ? '#fff' : '#9a8a7a',
              cursor: hasChanges ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              boxShadow: hasChanges ? '0 4px 16px rgba(89,22,32,.28)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
