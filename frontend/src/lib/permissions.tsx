'use client';
import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from './auth';
import type { PermissionMap, RoleKey } from './types';

/**
 * Server-trusted permission layer.
 *
 * The backend resolves every profile's role → permission map and returns it
 * from /auth/me (and enforces the same keys on every API route via
 * requirePermission). The frontend only mirrors that map for menu/page
 * gating — it never invents or persists permission state client-side, so
 * nothing here can be spoofed into real data access.
 */

interface PermissionsContextType {
  /** The raw backend permission map for the active profile. */
  permissions: PermissionMap;
  /** True when the active profile's role holds the permission key. */
  hasAccess: (roleKey: RoleKey | undefined | null, permissionKey: string) => boolean;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();

  const value = useMemo<PermissionsContextType>(() => {
    const permissions = me?.permissions ?? {};
    return {
      permissions,
      // roleKey is accepted for call-site compatibility; the check is always
      // against the server-resolved map for the signed-in profile.
      hasAccess: (_roleKey, permissionKey) => Boolean(permissions[permissionKey]),
    };
  }, [me?.permissions]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/**
 * Route → backend permission key. A page listed here renders "Access denied"
 * (and its sidebar item hides) unless the active role holds the key. The
 * backend enforces the same keys on the underlying APIs regardless.
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/super-admin/schools': 'schools.read',
  // Selling seats and deciding requests are platform acts; both keys are in
  // SUPER_ADMIN_ONLY server-side, so no school-level role can reach this page.
  '/super-admin/seats': 'seats.manage',
  // Pricing is its own authority: `seats.pricing.manage` is in
  // SUPER_ADMIN_ONLY, so no school-level role can reach this page, and the
  // backend gates every pricing write on the same key.
  '/super-admin/pricing': 'seats.pricing.manage',
  // Changing how a school looks is platform-level: `customization.manage` is
  // in SUPER_ADMIN_ONLY server-side. A School Admin reads its own configuration
  // through the Settings screen and cannot reach this page.
  '/super-admin/customization': 'customization.manage',
  // Configuring, verifying and activating a school's address is platform-level:
  // `domains.manage` is in SUPER_ADMIN_ONLY server-side.
  '/super-admin/domains': 'domains.manage',
  // A School Admin's own seat page. `seats.read` is granted to ADMIN and
  // SUPER_ADMIN only, and the backend gates every seat route on the same key.
  '/admin/seats': 'seats.read',
  '/super-admin/dashboards': 'analytics.school.read',
  '/super-admin/audit': 'audit.read',
  '/super-admin/permissions': 'roles.manage',
  '/admin/audit': 'audit.read',
  '/principal/audit': 'audit.read',
  '/admin/permissions': 'roles.manage',
  '/admin/settings': 'settings.manage',
  '/admin/users': 'users.manage',
  '/admin/payments': 'fees.read',
  '/principal/fees': 'fees.read',
  '/finance/payments': 'fees.read',
  '/finance/reports': 'fees.read',
  '/admin/admissions': 'admissions.read',
  '/warden/rooms': 'hostel.read',
  '/warden/students': 'hostel.read',
  '/warden/medical': 'medical.read',
  '/teacher/medical': 'medical.read',
  '/teacher/student-requests': 'cocurricular.review',
  '/parent/medical': 'medical.read',
  '/admin/medical': 'medical.read',
  // Same keys the document-request API enforces.
  '/admin/document-requests': 'students.manage',
  '/admin/document-types': 'settings.manage',
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
