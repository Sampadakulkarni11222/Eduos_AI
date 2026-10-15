/**
 * Features a school may switch on or off.
 *
 * A switch is separate from a person's permissions: permissions answer "may
 * this person do it", a feature answers "has this school taken this on". A
 * feature that is off disables its API (requireFeature) and its background
 * jobs (featureEnabled), not only its screens.
 *
 * Integrations that need hardware, provider accounts or a defined operating
 * process (cameras, GPS devices, ID card readers, social media accounts) are
 * off until the school turns them on, and turning one on does not connect
 * anything by itself.
 */
export const FEATURES = {
  analytics: { label: 'Analytics workspace and quarterly reports', default: true },
  tasks: { label: 'Tasks and reminders', default: true },
  bills: { label: 'Bills and service contracts', default: true },
  labs: { label: 'Science and computer laboratories', default: true },
  fleet: { label: 'Vehicles, trips and safe handover', default: true },
  gpsTracking: { label: 'Live bus location from GPS devices', default: false, needs: 'GPS devices registered with the school' },
  idCheckpoints: { label: 'ID card checkpoints (gate, bus, lab, library)', default: false, needs: 'QR or RFID readers, or staff scanning with a phone' },
  visitors: { label: 'Visitors, contractors and authorised pickup', default: true },
  camera: { label: 'Camera event review (optional pilot)', default: false, needs: 'Cameras, an approved purpose and locations, a retention period and trained reviewers' },
  ptm: { label: 'PTM booking and parent review calls', default: true },
  conversations: { label: 'Parent–teacher messages', default: true },
  staffCover: { label: 'Staff leave balances and substitute cover', default: true },
  clubs: { label: 'Clubs, sports, arts and fixtures', default: true },
  showcase: { label: 'Achievement and top-ranker showcase', default: true },
  alumni: { label: 'Alumni directory and community', default: true },
  digest: { label: 'Daily learning and trends digest', default: true },
  socialPublishing: { label: 'Publish to the school\'s social media accounts', default: false, needs: 'The school\'s social accounts connected through each network\'s official API' },
  sustainability: { label: 'Greenery, waste, water, energy and sanitation', default: true },
  reportCards: { label: 'Term report cards', default: true },
  onlineAdmission: { label: 'Online admission form', default: true },
  hostelOutpass: { label: 'Hostel out-pass', default: true },
  accountsExport: { label: 'Accounts export (Tally, GST) and concessions', default: true },
  aiDrafts: { label: 'AI drafts (letters, minutes, plans, remarks)', default: true, needs: 'An AI model key; without one, drafts come from templates' },
  // Part 2 gaps.
  supportPlans: { label: 'Student support plans', default: true },
  portfolios: { label: 'Competency portfolios', default: true },
  offlineWorkflows: { label: 'Offline attendance, lab, gate, sanitation and PTM check-in', default: true },
  scenarios: { label: 'Scenario planning (what-if projections)', default: true },
};

export const FEATURE_KEYS = Object.keys(FEATURES);

/** The effective switches for a school: its own choices over the defaults. */
export function effectiveFeatures(saved = {}) {
  const out = {};
  for (const key of FEATURE_KEYS) {
    const v = saved instanceof Map ? saved.get(key) : saved?.[key];
    out[key] = typeof v === 'boolean' ? v : FEATURES[key].default;
  }
  return out;
}
