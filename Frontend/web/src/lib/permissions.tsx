'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { RoleKey } from './types';

export type PermissionRole = 'Superadmin' | 'Admin' | 'Manager' | 'Teacher' | 'Staff';
export type PermissionValue = boolean | null;

export interface PermissionItem {
  id: string;
  label: string;
  desc?: string;
  defaults: Record<PermissionRole, PermissionValue>;
}

export interface PermissionGroup {
  title: string;
  items: PermissionItem[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'PLATFORM ACCESS',
    items: [
      {
        id: 'disable_web',
        label: 'Disable Web Access',
        desc: 'Restrict role to mobile app only.',
        defaults: { Superadmin: null, Admin: false, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'disable_call_tracking',
        label: 'Disable Call Tracking',
        desc: 'Unknown numbers will not be tracked.',
        defaults: { Superadmin: null, Admin: null, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'camera_only',
        label: 'Camera-only Image Capture',
        desc: 'Disallow gallery imports; require camera capture.',
        defaults: { Superadmin: null, Admin: null, Manager: null, Teacher: null, Staff: false },
      },
    ],
  },
  {
    title: 'DATA OPERATIONS',
    items: [
      {
        id: 'export_table',
        label: 'Export Table Data',
        desc: 'Export students, contacts, and business data.',
        defaults: { Superadmin: null, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'mask_phone',
        label: 'Mask Phone Numbers in Exports',
        desc: 'Partially hide phone numbers in exported files.',
        defaults: { Superadmin: null, Admin: false, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'bulk_upload',
        label: 'Bulk Upload Students / Leads',
        desc: 'Allow mass import via spreadsheet.',
        defaults: { Superadmin: null, Admin: true, Manager: true, Teacher: false, Staff: false },
      },
      {
        id: 'delete_records',
        label: 'Delete Records',
        desc: 'Permanently remove student or staff records.',
        defaults: { Superadmin: true, Admin: false, Manager: false, Teacher: false, Staff: false },
      },
    ],
  },
  {
    title: 'ASSIGNMENT & WORKFLOW',
    items: [
      {
        id: 'assign_leads',
        label: 'Assign Admissions to Other Members',
        desc: 'Re-route admission leads between counselors.',
        defaults: { Superadmin: null, Admin: true, Manager: true, Teacher: false, Staff: false },
      },
      {
        id: 'assign_tasks',
        label: 'Assign Tasks to Other Members',
        desc: 'Delegate tasks across roles.',
        defaults: { Superadmin: null, Admin: true, Manager: true, Teacher: false, Staff: false },
      },
    ],
  },
  {
    title: 'FINANCE',
    items: [
      {
        id: 'view_fees',
        label: 'View Fee Records',
        desc: 'Access payment history and invoices.',
        defaults: { Superadmin: true, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'create_invoice',
        label: 'Create Invoices',
        desc: 'Generate and send fee invoices.',
        defaults: { Superadmin: true, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'record_payment',
        label: 'Record Payments',
        desc: 'Mark outstanding fees as paid.',
        defaults: { Superadmin: true, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
    ],
  },
  {
    title: 'COMMUNICATION',
    items: [
      {
        id: 'send_announcements',
        label: 'Send Announcements',
        desc: 'Broadcast messages to students, parents, or staff.',
        defaults: { Superadmin: true, Admin: true, Manager: true, Teacher: true, Staff: false },
      },
      {
        id: 'send_whatsapp',
        label: 'Send WhatsApp Messages',
        desc: 'Use the WhatsApp assistant to contact users.',
        defaults: { Superadmin: true, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'manage_tickets',
        label: 'Manage Support Tickets',
        desc: 'Reply and resolve parent or student tickets.',
        defaults: { Superadmin: true, Admin: true, Manager: true, Teacher: true, Staff: false },
      },
    ],
  },
  {
    title: 'SYSTEM & AUDIT',
    items: [
      {
        id: 'view_audit',
        label: 'View Audit Logs',
        desc: 'Access the full audit trail of all actions.',
        defaults: { Superadmin: true, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'manage_roles',
        label: 'Manage Roles & Permissions',
        desc: 'Change role capabilities for others.',
        defaults: { Superadmin: true, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
      {
        id: 'tenant_settings',
        label: 'Edit Tenant Settings',
        desc: 'Modify school name, logo, integrations.',
        defaults: { Superadmin: true, Admin: true, Manager: false, Teacher: false, Staff: false },
      },
    ],
  },
];

export function mapRoleKeyToPermissionRole(roleKey?: RoleKey | null): PermissionRole | null {
  if (!roleKey) return null;
  const upper = roleKey.toUpperCase();
  if (upper === 'OWNER') return 'Superadmin';
  if (upper === 'ADMIN') return 'Admin';
  if (upper === 'PRINCIPAL') return 'Manager';
  if (upper === 'TEACHER') return 'Teacher';
  if (upper === 'FINANCE' || upper === 'LIBRARIAN' || upper === 'WARDEN') return 'Staff';
  return null; // For STUDENT, PARENT
}

const STORAGE_KEY = 'eduos.permissions.state';

export type PermissionsState = Record<string, Record<PermissionRole, PermissionValue>>;

function getInitialState(): PermissionsState {
  // Build defaults
  const defaults: PermissionsState = {};
  for (const group of PERMISSION_GROUPS) {
    for (const item of group.items) {
      defaults[item.id] = { ...item.defaults };
    }
  }

  // If in browser and item exists
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Force upgrade Admin permissions for system settings if they were false
        if (parsed.manage_roles && parsed.manage_roles.Admin === false) {
          parsed.manage_roles.Admin = true;
        }
        if (parsed.tenant_settings && parsed.tenant_settings.Admin === false) {
          parsed.tenant_settings.Admin = true;
        }
        return { ...defaults, ...parsed };
      } catch (e) {
        console.error('Failed to parse permissions state from localStorage', e);
      }
    }
  }
  return defaults;
}

interface PermissionsContextType {
  permissions: PermissionsState;
  updatePermission: (id: string, role: PermissionRole, val: PermissionValue) => void;
  updateAll: (state: PermissionsState) => void;
  resetToDefaults: () => void;
  hasAccess: (roleKey: RoleKey | undefined | null, permissionId: string) => boolean;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [permissions, setPermissions] = useState<PermissionsState>(() => getInitialState());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(permissions));
    }
  }, [permissions]);

  const updatePermission = (id: string, role: PermissionRole, val: PermissionValue) => {
    setPermissions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [role]: val,
      },
    }));
  };

  const updateAll = (newState: PermissionsState) => {
    setPermissions(newState);
  };

  const resetToDefaults = () => {
    const state: PermissionsState = {};
    for (const group of PERMISSION_GROUPS) {
      for (const item of group.items) {
        state[item.id] = { ...item.defaults };
      }
    }
    setPermissions(state);
  };

  const hasAccess = (roleKey: RoleKey | undefined | null, permissionId: string): boolean => {
    if (!roleKey) return false;
    const permRole = mapRoleKeyToPermissionRole(roleKey);
    if (!permRole) {
      // Students and parents don't have controlled permissions in the settings grid; they default to true for basic features
      return true;
    }
    const val = permissions[permissionId]?.[permRole];
    // if null/undefined, it means either false or N/A (which defaults to false or is not enabled)
    return val === true;
  };

  return (
    <PermissionsContext.Provider value={{ permissions, updatePermission, updateAll, resetToDefaults, hasAccess }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/admin/audit': 'view_audit',
  '/owner/audit': 'view_audit',
  '/principal/audit': 'view_audit',
  '/admin/permissions': 'manage_roles',
  '/owner/permissions': 'manage_roles',
  '/admin/settings': 'tenant_settings',
  '/owner/settings': 'tenant_settings',
  '/admin/tickets': 'manage_tickets',
  '/teacher/tickets': 'manage_tickets',
  '/principal/tickets': 'manage_tickets',
  '/admin/payments': 'view_fees',
  '/principal/fees': 'view_fees',
  '/admin/announcements': 'send_announcements',
  '/teacher/announcements': 'send_announcements',
  '/principal/announcements': 'send_announcements',
  '/admin/whatsapp': 'send_whatsapp',
  '/admin/users': 'manage_roles',
};

export function getRequiredPermission(pathname: string): string | null {
  for (const [route, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(route + '/')) {
      return perm;
    }
  }
  return null;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error('usePermissions must be used within a PermissionsProvider');
  }
  return ctx;
}
