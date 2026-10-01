/**
 * Everything global about the promo: format, and the EduOS brand tokens.
 *
 * Colours are copied from frontend/src/app/design-system.css — the promo uses
 * the product's own palette and nothing else. Change FPS or the scene lengths
 * in timeline.ts and every scene re-times itself; no scene hardcodes frames.
 */
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

export const BRAND = {
  parchment: '#EFE8D8',
  panel: '#FBF6EC',
  card: '#FFFFFF',
  cardBorder: '#EAE1CF',
  hairline: '#E7DEC9',
  text1: '#332b25',
  text2: '#716757',
  textFaint: '#7e7566',
  gold: '#C9A23F',
  maroon: '#591620',
  maroon2: '#7A1F2B',
  cream1: '#F2E4CC',
  cream2: '#D8B98A',
  green: '#2E6B4F',
  amber: '#916112',
  red: '#A8322E',
  blue: '#2F5A82',
} as const;

/** Sidebar accents per portal — body.role-* in design-system.css. */
export const ROLE_THEME = {
  superAdmin: { label: 'Super Admin', portal: 'Platform Administration', accent: '#312244', onAccent: '#EFD9A8' },
  admin: { label: 'School Admin', portal: 'Admin Console', accent: '#591620', onAccent: '#F4E7D2' },
  principal: { label: 'Principal', portal: 'School Intelligence', accent: '#2b2b30', onAccent: '#E9CE92' },
  teacher: { label: 'Teacher', portal: 'Teacher Portal', accent: '#1f4a3a', onAccent: '#E6F1EA' },
  parent: { label: 'Parent', portal: 'Parent Portal', accent: '#2f3c5c', onAccent: '#E8ECF5' },
  student: { label: 'Student', portal: 'Student Portal', accent: '#3d2f26', onAccent: '#F7F0DF' },
  warden: { label: 'Warden', portal: 'Hostel Portal', accent: '#5f0f40', onAccent: '#FBDFEE' },
  librarian: { label: 'Librarian', portal: 'Library Portal', accent: '#0f4c5c', onAccent: '#E3EFE6' },
} as const;
export type RoleKey = keyof typeof ROLE_THEME;

export const COPY = {
  product: 'EduOS',
  // The sign-in screen's own subtitle (components/sign-in.tsx).
  tagline: 'The AI-native School OS',
  closing: 'One Platform. Connected School. Smarter Management.',
} as const;
