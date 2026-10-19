import type { NavItem, Portal } from './portals';

/**
 * Spaces: a calmer way to show a long menu.
 *
 * `PORTALS[slug].nav` stays the source of truth — permissions, the user guides,
 * universal search and the tests all read it. This module only decides *where*
 * each of those items is shown in the sidebar: in one of at most eight
 * role-appropriate spaces, opened one at a time, each leading with a handful of
 * "essentials" and keeping the rest one click away.
 *
 * The mapping is a small table keyed by the item's current group, plus
 * per-key overrides (global for staff or family portals, then per portal).
 * Every item lands in exactly one space; the user guide goes to the footer.
 */

export type SpaceId =
  // Staff portals
  | 'home' | 'teaching' | 'students' | 'people' | 'finance' | 'operations' | 'admin' | 'community'
  // Family portals (parent, student, alumnus) — 'home' and 'community' are shared ids
  | 'child' | 'school' | 'payments' | 'help'
  // Small portals: one-page spaces folded together (see foldTinySpaces)
  | 'more';

export interface SpaceDef {
  id: SpaceId;
  label: string;
  icon: string;
}

export interface SpaceItem extends NavItem {
  /** The page key: the href with the portal prefix removed ('' for the portal home). */
  key: string;
  /** The nav group the item sits in today (kept for search subtitles and debugging). */
  group: string;
}

export interface NavSpace extends SpaceDef {
  /** Every item of this space, essentials first, then the rest in menu order. */
  items: SpaceItem[];
  /** Shown when the space opens. */
  essentials: SpaceItem[];
  /** Behind "Show all". Empty when the space is small enough to show whole. */
  rest: SpaceItem[];
}

export interface NavModel {
  spaces: NavSpace[];
  /** Footer links (the user guide). */
  footer: SpaceItem[];
  /** Every visible item, in menu order. */
  all: SpaceItem[];
}

/** Where an item goes: a space, or the footer. */
export type Placement = SpaceId | 'footer';

export const FAMILY_PORTALS = ['parent', 'student', 'alumnus'] as const;
export const isFamilyPortal = (slug: string) => (FAMILY_PORTALS as readonly string[]).includes(slug);

const STAFF_SPACES: SpaceDef[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'teaching', label: 'Teaching & Learning', icon: '✎' },
  { id: 'students', label: 'Students & Families', icon: '◈' },
  { id: 'people', label: 'People & Staff', icon: '◇' },
  { id: 'finance', label: 'Finance', icon: '₹' },
  { id: 'operations', label: 'Operations & Safety', icon: '⛒' },
  { id: 'admin', label: 'Administration & Compliance', icon: '▣' },
  { id: 'community', label: 'Community & Growth', icon: '◍' },
];

const FAMILY_SPACES: SpaceDef[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'child', label: 'My child', icon: '◉' },
  { id: 'school', label: 'School life', icon: '▤' },
  { id: 'payments', label: 'Payments', icon: '₹' },
  { id: 'community', label: 'Community', icon: '◍' },
  { id: 'help', label: 'Help & account', icon: '✉' },
];

/** Per-portal names where the generic one would read oddly for that role. */
const SPACE_LABELS: Record<string, Partial<Record<SpaceId, string>>> = {
  student: { child: 'My studies' },
  alumnus: { child: 'Learning' },
  librarian: { teaching: 'Library & Learning' },
  warden: { operations: 'Hostel & Safety', students: 'Residents & Care' },
  nurse: { students: 'Health & Care' },
  'super-admin': { admin: 'Schools & System' },
};

// ── The mapping table ────────────────────────────────────────────────────
// 1. By the item's current group.
const STAFF_GROUP_SPACE: Record<string, Placement> = {
  WORKSPACE: 'home',
  OVERVIEW: 'home',
  'COMMAND CENTRE': 'home',
  TEACHING: 'teaching',
  CONTENT: 'teaching',
  LEARNING: 'teaching',
  ACADEMIC: 'teaching',
  'ACADEMIC OPS': 'teaching',
  STUDENTS: 'students',
  'PARENTS & PTM': 'students',
  HEALTH: 'students',
  'HEALTH & CARE': 'students',
  PEOPLE: 'people',
  ORGANISATION: 'people',
  FINANCE: 'finance',
  'FINANCE OPERATIONS': 'finance',
  OPERATIONS: 'operations',
  'TRANSPORT & SAFETY': 'operations',
  ADMINISTRATION: 'admin',
  'SAFETY & POLICIES': 'admin',
  GOVERNANCE: 'admin',
  SYSTEM: 'admin',
  SCHOOLS: 'admin',
  COMMUNITY: 'community',
  'MARKETING & ADMISSIONS': 'community',
  COMMUNICATION: 'community',
  'HELP & SUPPORT': 'footer',
};

const FAMILY_GROUP_SPACE: Record<string, Placement> = {
  WORKSPACE: 'home',
  'COMMAND CENTRE': 'home',
  'MY CHILD': 'child',
  ACADEMICS: 'child',
  LEARNING: 'child',
  'SCHOOL LIFE': 'school',
  'TRANSPORT & SAFETY': 'school',
  'PARENTS & PTM': 'school',
  HEALTH: 'school',
  ACCOUNT: 'help',
  COMMUNITY: 'community',
  'SAFETY & POLICIES': 'help',
  'HELP & SUPPORT': 'footer',
};

// 2. By page key, across every staff (or family) portal.
const STAFF_KEY_SPACE: Record<string, Placement> = {
  guide: 'footer',
  tickets: 'home',
  attendance: 'students',
  medical: 'students',
  'student-classes': 'students',
  'document-requests': 'students',
  'class-check-in': 'students',
  'support-plans': 'students',
  portfolio: 'students',
  'care-notes': 'students',
  health: 'students',
  'health-summary': 'students',
  'health-watch': 'students',
  users: 'people',
  staff: 'people',
  workload: 'people',
  payslips: 'people',
  fees: 'finance',
  labs: 'operations',
  facilities: 'operations',
  sustainability: 'operations',
  shifts: 'operations',
  'teacher-presence': 'operations',
  transport: 'operations',
  'transport-requests': 'operations',
  library: 'teaching',
  calendar: 'teaching',
  documents: 'admin',
  'document-types': 'admin',
  events: 'community',
  announcements: 'community',
  admissions: 'community',
  'newsletter-desk': 'community',
};

const FAMILY_KEY_SPACE: Record<string, Placement> = {
  guide: 'footer',
  announcements: 'home',
  digest: 'home',
  payments: 'payments',
  'ai-credits': 'payments',
  tickets: 'help',
  profile: 'help',
  documents: 'help',
  medical: 'school',
};

// 3. Per portal, where a page means something different for that role.
const PORTAL_KEY_SPACE: Record<string, Record<string, Placement>> = {
  // A teacher's queries come from parents; the transport and leave pages are
  // about the students they teach.
  teacher: { tickets: 'students', transport: 'students', leave: 'students' },
  principal: { tickets: 'students' },
  // HR runs payroll as part of looking after staff.
  hr: { payroll: 'people' },
  librarian: { books: 'teaching', requests: 'teaching', notes: 'teaching', 'question-papers': 'teaching' },
  warden: { rooms: 'operations', students: 'students' },
  'super-admin': { dashboards: 'home' },
};

/** Where one item goes. Exported for tests and for anything that wants to say "in Finance". */
export function placementFor(slug: string, key: string, group: string): Placement {
  const family = isFamilyPortal(slug);
  if (key === '') return 'home';
  const byPortal = PORTAL_KEY_SPACE[slug]?.[key];
  if (byPortal) return byPortal;
  const byKey = (family ? FAMILY_KEY_SPACE : STAFF_KEY_SPACE)[key];
  if (byKey) return byKey;
  const byGroup = (family ? FAMILY_GROUP_SPACE : STAFF_GROUP_SPACE)[group];
  if (byGroup) return byGroup;
  // A new group nobody has mapped yet still has to be reachable.
  return family ? 'school' : 'admin';
}

// ── Essentials, shortcuts and the phone bar ──────────────────────────────

/** How many items a space shows before "Show all" when it has no essentials list. */
export const ESSENTIALS_LIMIT = 5;
/** A space this small is shown whole — "Show all (1)" would be noise. */
const SHOW_WHOLE_UP_TO = 6;

/** Role-defined key pages per space, in the order they should appear. */
const ESSENTIALS: Record<string, Partial<Record<SpaceId, string[]>>> = {
  principal: {
    home: ['', 'today', 'approvals', 'analytics', 'tasks'],
    teaching: ['risk', 'report-cards', 'syllabus', 'lesson-plans', 'lectures'],
    students: ['attendance', 'tickets', 'ptm', 'conversations', 'support-plans'],
    people: ['staff', 'workload', 'staff-leave', 'cover', 'recruitment'],
    finance: ['fees', 'budgets', 'finance-reports', 'payroll', 'bills'],
    operations: ['fleet', 'gate', 'facilities', 'camera', 'teacher-presence'],
    admin: ['compliance', 'safeguarding', 'policies', 'governance', 'audit'],
    community: ['announcements', 'events', 'newsroom', 'marketing', 'alumni'],
  },
  admin: {
    home: ['', 'today', 'approvals', 'tickets', 'tasks'],
    teaching: ['classrooms', 'timetable', 'calendar', 'registrations', 'report-cards'],
    students: ['attendance', 'student-classes', 'document-requests', 'ptm', 'medical'],
    people: ['users', 'staff-leave', 'cover', 'organization', 'institution'],
    finance: ['payments', 'bills', 'concessions', 'budgets', 'finance-reports'],
    operations: ['transport', 'transport-requests', 'facilities', 'gate', 'fleet'],
    admin: ['settings', 'permissions', 'documents', 'compliance', 'audit'],
    community: ['announcements', 'admissions', 'events', 'newsroom', 'marketing'],
  },
  teacher: {
    home: ['', 'today', 'tasks', 'approvals'],
    teaching: ['classes', 'timetable', 'assignments', 'exams', 'quizzes', 'material'],
    students: ['attendance', 'tickets', 'leave', 'student-requests', 'ptm'],
    people: ['staff-leave', 'professional-profile', 'cpd-hours', 'payslips'],
    community: ['announcements', 'events', 'newsroom', 'clubs'],
  },
  parent: {
    home: ['', 'announcements', 'digest'],
    child: ['performance', 'attendance', 'assignments', 'timetable', 'report-cards'],
    school: ['calendar', 'ptm', 'conversations', 'transport', 'bus-today'],
  },
  student: {
    home: ['', 'announcements', 'digest'],
    child: ['timetable', 'assignments', 'quizzes', 'performance', 'attendance', 'study-help'],
    school: ['calendar', 'library', 'question-papers', 'transport', 'bus-today'],
  },
  finance: {
    finance: ['payments', 'finance-reports', 'bills', 'concessions', 'budgets'],
  },
  hr: {
    people: ['staff-profiles', 'staff-leave', 'payroll', 'recruitment', 'cover'],
  },
  marketing: {
    community: ['admissions', 'marketing', 'followups', 'online-applications', 'campaigns'],
  },
  compliance: {
    admin: ['compliance', 'safeguarding', 'policies', 'data-protection', 'verification'],
  },
};

/** The pages a role reaches for most: the starting "My shortcuts" (keys). */
const DEFAULT_SHORTCUTS: Record<string, string[]> = {
  principal: ['today', 'approvals', 'risk', 'attendance', 'fees', 'announcements'],
  admin: ['users', 'attendance', 'payments', 'timetable', 'announcements', 'tickets'],
  teacher: ['classes', 'attendance', 'assignments', 'timetable', 'tickets', 'announcements'],
  parent: ['performance', 'attendance', 'assignments', 'payments', 'calendar', 'announcements'],
  student: ['timetable', 'assignments', 'quizzes', 'performance', 'study-help'],
  finance: ['payments', 'finance-reports', 'bills', 'concessions', 'budgets'],
  hr: ['staff-profiles', 'staff-leave', 'payroll', 'recruitment', 'cover'],
  marketing: ['admissions', 'marketing', 'followups', 'online-applications', 'campaigns'],
  compliance: ['compliance', 'safeguarding', 'policies', 'data-protection', 'verification'],
  trustee: ['governance', 'budgets', 'reports', 'analytics', 'compliance'],
  librarian: ['books', 'requests', 'library-desk', 'notes', 'question-papers'],
  warden: ['rooms', 'students', 'outpass', 'hostel-life', 'medical'],
  nurse: ['health-watch', 'tasks', 'approvals', 'staff-leave', 'safeguarding'],
  alumnus: ['mentoring', 'alumni', 'give-back', 'certificates', 'newsroom'],
  'super-admin': ['schools', 'seats', 'dashboards', 'audit'],
};

/** The spaces on the phone's bottom bar, after Home. */
const BOTTOM_SPACES: Record<string, SpaceId[]> = {
  principal: ['students', 'finance', 'people'],
  admin: ['students', 'finance', 'teaching'],
  teacher: ['teaching', 'students', 'community'],
  parent: ['child', 'school', 'payments'],
  student: ['child', 'school', 'community'],
  alumnus: ['community', 'child'],
  finance: ['finance', 'people'],
  hr: ['people', 'finance'],
  marketing: ['community', 'people'],
  compliance: ['admin', 'operations'],
  trustee: ['admin', 'finance'],
  librarian: ['teaching', 'community'],
  warden: ['operations', 'students'],
  nurse: ['students', 'people'],
  'super-admin': ['admin'],
};

// ── Building the model ───────────────────────────────────────────────────

/** `/admin/users` → `users`; `/admin` → `''`. */
export function itemKey(slug: string, href: string): string {
  const prefix = `/${slug}`;
  if (href === prefix) return '';
  return href.startsWith(`${prefix}/`) ? href.slice(prefix.length + 1) : href;
}

export function spaceDefs(slug: string): SpaceDef[] {
  const base = isFamilyPortal(slug) ? FAMILY_SPACES : STAFF_SPACES;
  const labels = SPACE_LABELS[slug] ?? {};
  return base.map((s) => ({ ...s, label: labels[s.id] ?? s.label }));
}

/**
 * Sorts a portal's (already permission-filtered) items into spaces.
 * `canSee` defaults to "everything" so tests and tools can see the whole map.
 */
export function buildNavModel(portal: Portal, canSee: (href: string) => boolean = () => true): NavModel {
  const slug = portal.slug;
  const all: SpaceItem[] = [];
  for (const g of portal.nav) {
    for (const it of g.items) {
      if (!canSee(it.href)) continue;
      all.push({ ...it, key: itemKey(slug, it.href), group: g.title });
    }
  }
  const buckets = new Map<Placement, SpaceItem[]>();
  for (const it of all) {
    const p = placementFor(slug, it.key, it.group);
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p)!.push(it);
  }
  const spaces: NavSpace[] = [];
  for (const def of spaceDefs(slug)) {
    const inSpace = buckets.get(def.id) ?? [];
    if (!inSpace.length) continue; // a space with no pages for this role is not shown
    // The portal's own home leads its space; then the role's essentials, in their order.
    const wanted = ESSENTIALS[slug]?.[def.id] ?? [];
    const rank = (i: SpaceItem) => (i.key === '' ? -1 : wanted.includes(i.key) ? wanted.indexOf(i.key) : wanted.length);
    const ordered = [...inSpace].sort((a, b) => rank(a) - rank(b)); // stable: menu order within a rank
    let essentials: SpaceItem[];
    if (ordered.length <= SHOW_WHOLE_UP_TO) {
      essentials = ordered;
    } else {
      const picked = ordered.filter((i) => wanted.includes(i.key));
      essentials = picked.length ? picked : ordered.slice(0, ESSENTIALS_LIMIT);
    }
    let rest = ordered.filter((i) => !essentials.includes(i));
    // "Show all (1)" hides one line behind one line: just show it.
    if (rest.length === 1) { essentials = [...essentials, ...rest]; rest = []; }
    spaces.push({ ...def, items: [...essentials, ...rest], essentials, rest });
  }
  return { spaces: foldTinySpaces(slug, spaces), footer: buckets.get('footer') ?? [], all };
}

/** A space with exactly one page renders as a plain link, not an accordion of one. */
export const isSingleLink = (space: NavSpace) => space.items.length === 1;

/** From this many one-page spaces on, the minor ones are folded into "More". */
const FOLD_FROM = 3;

/**
 * Small portals (a nurse's 15 pages) otherwise end up with a row of one-page
 * spaces. When a role has three or more, the ones that are not its key spaces
 * (the phone bar's) are gathered into one "More" space at the end — provided
 * that leaves at least two pages in it, so More is never itself a single link.
 */
function foldTinySpaces(slug: string, spaces: NavSpace[]): NavSpace[] {
  const singles = spaces.filter((s) => s.id !== 'home' && isSingleLink(s));
  if (singles.length < FOLD_FROM) return spaces;
  const key = new Set(BOTTOM_SPACES[slug] ?? []);
  const fold = singles.filter((s) => !key.has(s.id));
  if (fold.length < 2) return spaces;
  const items = fold.flatMap((s) => s.items);
  const more: NavSpace = { id: 'more', label: 'More', icon: '⋯', items, essentials: items, rest: [] };
  return [...spaces.filter((s) => !fold.includes(s)), more];
}

/** Default shortcuts as hrefs, limited to what this person can see. */
export function defaultShortcuts(slug: string, model: NavModel): string[] {
  const visible = new Map(model.all.map((i) => [i.key, i.href]));
  const hrefs = (DEFAULT_SHORTCUTS[slug] ?? [])
    .map((k) => visible.get(k))
    .filter((h): h is string => Boolean(h));
  if (hrefs.length) return hrefs;
  // A role without a list (or without permission for any of it): its first pages after home.
  return model.all.filter((i) => i.key !== '' && placementFor(slug, i.key, i.group) !== 'footer').slice(0, 5).map((i) => i.href);
}

/** The phone's bottom bar: Home, then two or three of the role's key spaces. */
export function bottomBarSpaces(slug: string, model: NavModel): NavSpace[] {
  const visible = model.spaces.filter((s) => s.id !== 'home');
  const wanted = (BOTTOM_SPACES[slug] ?? [])
    .map((id) => visible.find((s) => s.id === id))
    .filter((s): s is NavSpace => Boolean(s));
  const max = Math.min(3, Math.max(2, (BOTTOM_SPACES[slug] ?? []).length));
  for (const s of visible) {
    if (wanted.length >= max) break;
    if (!wanted.includes(s)) wanted.push(s);
  }
  return wanted.slice(0, max);
}

/**
 * The menu item for the page on screen: an exact match, or the deepest item
 * the path sits under (`/admin/users/42` → Users). The portal home matches
 * only itself, so an unlisted page does not light up "Dashboard".
 */
export function activeItem(items: SpaceItem[], here: string): SpaceItem | null {
  let best: SpaceItem | null = null;
  for (const it of items) {
    const exact = here === it.href;
    const under = it.key !== '' && here.startsWith(`${it.href}/`);
    if (!exact && !under) continue;
    if (exact) return it;
    if (!best || it.href.length > best.href.length) best = it;
  }
  return best;
}

export function spaceOf(model: NavModel, href: string | null | undefined): NavSpace | null {
  if (!href) return null;
  return model.spaces.find((s) => s.items.some((i) => i.href === href)) ?? null;
}
