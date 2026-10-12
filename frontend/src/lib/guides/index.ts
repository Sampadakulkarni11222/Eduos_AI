import type { RoleGuide } from './types';
import { adminGuide } from './admin';
import { teacherGuide } from './teacher';
import { studentGuide } from './student';
import { parentGuide } from './parent';
import { principalGuide } from './principal';
import { financeGuide } from './finance';
import { librarianGuide } from './librarian';
import { wardenGuide } from './warden';
import { superAdminGuide } from './super-admin';

/** One guide per portal, keyed by the portal slug used in lib/portals.ts. */
export const GUIDES: Record<string, RoleGuide> = {
  admin: adminGuide,
  teacher: teacherGuide,
  student: studentGuide,
  parent: parentGuide,
  principal: principalGuide,
  finance: financeGuide,
  librarian: librarianGuide,
  warden: wardenGuide,
  'super-admin': superAdminGuide,
};
