import { AppError } from '../../utils/AppError.js';
import { getTeacherSectionIds } from '../../utils/scope.js';
import { DEPARTMENTS } from './catalogue.js';

/**
 * Who sees which part of the workspace.
 *
 * analytics.workspace.read at ALL scope sees every department. At OWN scope a
 * person sees only the departments their role runs (and a teacher only the
 * classes they teach or lead). The same resolution is used for the screen,
 * the CSV export and the quarterly report sections, so an export can never
 * hold more than the screen shows.
 *
 * A role that gains OWN access to the workspace needs an entry here; until it
 * has one it sees nothing rather than everything.
 */
export const OWN_DEPARTMENTS = {
  TEACHER: ['academics'],
  FINANCE: ['finance', 'procurement'],
  HR: ['people'],
  MARKETING: ['admissions'],
  COMPLIANCE: ['facilities'],
};

export const ALL_DEPARTMENT_KEYS = () => DEPARTMENTS.map((d) => d.key);

/**
 * @returns {{ level: 'ALL'|'OWN', departments: string[], sectionIds: string[]|null, all: boolean }}
 */
export async function resolveScope(actor, permissionScope) {
  if (permissionScope === 'ALL') return { level: 'ALL', all: true, departments: ALL_DEPARTMENT_KEYS(), sectionIds: null };
  if (permissionScope !== 'OWN') throw new AppError('Missing permission: analytics.workspace.read', 403);
  const departments = (OWN_DEPARTMENTS[actor?.roleKey] ?? []).filter((d) => ALL_DEPARTMENT_KEYS().includes(d));
  if (!departments.length) throw new AppError('Your role has no department in the analytics workspace.', 403, [], 'NO_ANALYTICS_SCOPE');
  const sectionIds = actor.roleKey === 'TEACHER' ? (actor.profileId ? await getTeacherSectionIds(actor.profileId) : []) : null;
  return { level: 'OWN', all: false, departments, sectionIds };
}

/** Narrows to one requested department, refusing one outside the person's scope. */
export function departmentsFor(scope, requested) {
  if (!requested || requested === 'all' || requested === 'overview') return scope.departments;
  if (!ALL_DEPARTMENT_KEYS().includes(requested)) throw new AppError(`Unknown department ${requested}`, 400, [], 'BAD_DEPARTMENT');
  if (!scope.departments.includes(requested)) throw new AppError('That department is outside your analytics scope.', 403, [], 'DEPARTMENT_FORBIDDEN');
  return [requested];
}
