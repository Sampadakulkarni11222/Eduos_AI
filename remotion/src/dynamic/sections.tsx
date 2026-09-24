import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { BRAND, ROLE_THEME, RoleKey } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { Parchment } from '../components/Brand';
import { CameraKey, Highlight, Shot } from '../components/Shot';
import { Beat, Beats, Card, Kicker, Rise, StepRail, Tag, clamp, f, sec, useT } from './kit';

/**
 * The middle of the dynamic cut, 7–66 s. Every frame is a real capture of the
 * seeded Oakridge Academy (assets/screenshots, manifest.json and
 * manifest.extra.json). Coordinates are the app's 1920×1080 viewport. The
 * content column of every portal runs x 285–1463, so "x: 874" centres on it.
 */
const C = 874;
const cam = (...keys: [number, number, number, number][]): CameraKey[] => keys.map(([at, x, y, z]) => ({ at, x, y, z }));

// ─── PLATFORM · 7–17 s ──────────────────────────────────────────────────────

/** Admin sidebar groups, lit one at a time while the list on the right names them. */
const GROUPS: { label: string; rect: [number, number, number, number]; y: number }[] = [
  { label: 'Administration', rect: [10, 198, 236, 214], y: 300 },
  { label: 'Academics', rect: [10, 426, 236, 216], y: 520 },
  { label: 'Finance', rect: [10, 654, 236, 62], y: 640 },
  { label: 'Communication', rect: [10, 727, 236, 218], y: 757 },
];
const SWEEP_START = 0.15;
const SWEEP_STEP = 0.8;

const CapabilitySweep: React.FC = () => {
  const { frame, D } = useT();
  const len = sec(D);
  const keys: CameraKey[] = [{ at: 0, x: 900, y: 420, z: 1.4 }];
  const highlights: Highlight[] = [];
  GROUPS.forEach((g, i) => {
    const a = (SWEEP_START + i * SWEEP_STEP) / len;
    const b = (SWEEP_START + (i + 1) * SWEEP_STEP) / len;
    keys.push({ at: Math.min(0.98, a + 0.1 / len), x: 560, y: g.y, z: 1.9 });
    highlights.push({ rect: g.rect, from: a + 0.05 / len, to: Math.min(1.01, b + 0.02 / len), radius: 10 });
  });
  const active = Math.floor((sec(frame) - SWEEP_START) / SWEEP_STEP);
  const panel = interpolate(frame, [0, f(10 / 30)], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Shot src="admin-dashboard.png" camera={keys} highlights={highlights} />
      <AbsoluteFill
        style={{
          left: 900,
          background: 'linear-gradient(90deg, rgba(239,232,216,0) 0%, rgba(239,232,216,.97) 14%, #EFE8D8 100%)',
          opacity: panel,
        }}
      />
      <div style={{ position: 'absolute', left: 1180, top: 250, opacity: panel }}>
        <Kicker style={{ marginBottom: 22 }}>Admin Console · one sidebar</Kicker>
        {GROUPS.map((g, i) => {
          const on = i === Math.max(0, Math.min(GROUPS.length - 1, active));
          const done = i < active;
          return (
            <div
              key={g.label}
              style={{
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: on ? 84 : 46,
                lineHeight: 1.18,
                color: on ? BRAND.maroon : done ? BRAND.text2 : BRAND.textFaint,
                transition: 'none',
              }}
            >
              {g.label}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const PlatformSection: React.FC = () => (
  <Beats
    beats={[
      {
        s: 2.2,
        name: 'signin',
        node: (
          <AbsoluteFill>
            <Shot src="signin.png" camera={cam([0, 960, 560, 1.02], [1, 960, 610, 1.5])} />
            <Tag title="One connected platform" kicker="Oakridge Academy · sign-in" corner="top-left" />
          </AbsoluteFill>
        ),
      },
      {
        s: 2.4,
        enter: 'slide',
        name: 'customization',
        node: (
          <AbsoluteFill>
            <Shot
              src="school-customization.png"
              camera={cam([0, 960, 540, 1.05], [0.35, 1075, 330, 1.45], [1, 1075, 440, 1.5])}
              highlights={[
                { rect: [690, 162, 773, 210], from: 0.18, to: 0.55, radius: 16 },
                { rect: [690, 390, 773, 275], from: 0.55, to: 1.01, radius: 16 },
              ]}
            />
            <Tag
              title="Branded per school"
              kicker="Super Admin · School Customization"
              pills={['Theme', 'Branding', 'Domains']}
              accent={ROLE_THEME.superAdmin.accent}
            />
          </AbsoluteFill>
        ),
      },
      {
        s: 2.0,
        enter: 'slide',
        name: 'admin-console',
        node: (
          <AbsoluteFill>
            <Shot
              src="admin-dashboard.png"
              camera={cam([0, C, 330, 1.35], [1, C, 520, 1.45])}
              highlights={[{ rect: [285, 114, 284, 108], from: 0.15, to: 1.01, radius: 12 }]}
            />
            <Tag title="Built for school operations" kicker="School Admin · Admin Console" accent={ROLE_THEME.admin.accent} corner="bottom-right" />
          </AbsoluteFill>
        ),
      },
      { s: 3.4, enter: 'cut', name: 'capabilities', node: <CapabilitySweep /> },
    ]}
  />
);

// ─── FEATURE ECOSYSTEM · 17–30 s ────────────────────────────────────────────

/** Verb + the module's real sidebar name. Every verb is what that screen does. */
const FEATURES: { verb: string; name: string; src: string; camera: CameraKey[]; hl?: Highlight[] }[] = [
  { verb: 'Analyze', name: 'School Dashboards', src: 'super-admin-dashboards.png', camera: cam([0, C, 380, 1.3], [1, C, 330, 1.45]) },
  { verb: 'Manage', name: 'User Management', src: 'admin-users.png', camera: cam([0, 820, 380, 1.35], [1, C, 360, 1.5]) },
  { verb: 'Schedule', name: 'Timetable Builder', src: 'admin-timetable.png', camera: cam([0, C, 440, 1.4], [1, C, 460, 1.6]) },
  { verb: 'Track', name: 'Attendance', src: 'parent-attendance.png', camera: cam([0, C, 250, 1.5], [1, C, 230, 1.7]) },
  { verb: 'Teach', name: 'Course Material', src: 'student-material.png', camera: cam([0, C, 300, 1.55], [1, C, 280, 1.75]) },
  { verb: 'Assess', name: 'Exams & Results', src: 'student-performance.png', camera: cam([0, C, 380, 1.35], [1, C, 340, 1.55]) },
  { verb: 'Plan', name: 'Calendar & Events', src: 'admin-calendar.png', camera: cam([0, C, 340, 1.45], [1, C, 330, 1.62]) },
  { verb: 'Collect', name: 'Payments & Fees', src: 'admin-payments.png', camera: cam([0, C, 300, 1.4], [1, C, 280, 1.6]) },
  { verb: 'Communicate', name: 'Announcements', src: 'admin-announcements.png', camera: cam([0, C, 300, 1.6], [1, C, 280, 1.8]) },
  { verb: 'Organise', name: 'Documents', src: 'admin-documents.png', camera: cam([0, C, 300, 1.55], [1, C, 290, 1.72]) },
  { verb: 'Control', name: 'Access & Permissions', src: 'admin-permissions.png', camera: cam([0, C, 420, 1.35], [1, C, 390, 1.5]) },
];
const FEATURE_S = [1.3, ...Array(FEATURES.length - 1).fill((13 - 1.3) / (FEATURES.length - 1))] as number[];

/** Progress rail across the montage: which of the eleven we are on. */
const FeatureRail: React.FC = () => {
  const { frame } = useT();
  const starts = FEATURE_S.reduce<number[]>((a, s, i) => [...a, (a[i - 1] ?? 0) + (i ? FEATURE_S[i - 1] : 0)], []);
  let idx = 0;
  starts.forEach((s, i) => {
    if (frame >= f(s)) idx = i;
  });
  const t = interpolate(frame, [0, f(12 / 30)], [0, 1], clamp);
  return (
    <div style={{ position: 'absolute', right: 76, top: 60, display: 'flex', alignItems: 'center', gap: 14, opacity: t, zIndex: 5 }}>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 17,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: BRAND.text2,
          background: 'rgba(251,246,236,.95)',
          border: `1px solid ${BRAND.hairline}`,
          borderRadius: 999,
          padding: '10px 18px',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span>One platform</span>
        <span style={{ display: 'flex', gap: 5 }}>
          {FEATURES.map((_, i) => (
            <span key={i} style={{ width: i === idx ? 26 : 9, height: 9, borderRadius: 9, background: i <= idx ? BRAND.gold : BRAND.cardBorder }} />
          ))}
        </span>
      </div>
    </div>
  );
};

export const FeaturesSection: React.FC = () => (
  <AbsoluteFill>
    <Beats
      beats={FEATURES.map<Beat>((ft, i) => ({
        s: FEATURE_S[i],
        enter: i % 2 ? 'push' : 'slide',
        name: ft.verb.toLowerCase(),
        node: (
          <AbsoluteFill>
            <Shot src={ft.src} camera={ft.camera} highlights={ft.hl} />
            <Tag title={ft.verb} kicker={ft.name} size={84} delay={0.06} />
          </AbsoluteFill>
        ),
      }))}
    />
    <FeatureRail />
  </AbsoluteFill>
);

// ─── ROLE ECOSYSTEM · 30–43 s ───────────────────────────────────────────────

type Cap = { label: string; src: string; rect: [number, number, number, number] };
const R = (label: string, src: string, y = 95, x = 270, w = 1210): Cap => ({ label, src, rect: [x, y, w, w * 0.6] });

const ROLES: { role: RoleKey; caps: Cap[] }[] = [
  {
    role: 'principal',
    caps: [R('Intelligence', 'principal-intelligence.png', 150), R('Risk', 'principal-risk.png', 150), R('Fee Health', 'principal-fees.png', 95)],
  },
  {
    role: 'teacher',
    caps: [R('Teaching day', 'teacher-dashboard.png', 100), R('My Classes', 'teacher-classes.png', 95), R('Timetable', 'teacher-timetable.png', 95)],
  },
  {
    role: 'parent',
    caps: [R('At a glance', 'parent-dashboard.png', 100), R('Assignments', 'parent-assignments.png', 95), R('Study Help', 'parent-study-help.png', 95)],
  },
  {
    role: 'student',
    caps: [R('Today', 'student-dashboard.png', 100), R('Timetable', 'student-timetable.png', 95), R('Assignments', 'student-assignments.png', 95)],
  },
  {
    role: 'warden',
    caps: [R('Occupancy', 'warden-dashboard.png', 95), R('Rooms', 'warden-rooms.png', 95), R('Hostel Students', 'warden-students.png', 95)],
  },
  {
    role: 'librarian',
    caps: [R('Overview', 'librarian-dashboard.png', 95), R('Catalogue', 'librarian-books.png', 95), { label: 'Lending', src: 'librarian-dashboard.png', rect: [285, 240, 650, 390] }],
  },
];
const CAP0 = 0.3;
const CAP_STEP = 0.6;

const RoleBeat: React.FC<{ role: RoleKey; caps: Cap[] }> = ({ role, caps }) => {
  const { frame, at } = useT();
  const theme = ROLE_THEME[role];
  const title = at(0.02, 0.4);
  const k = at(0.1, 0.45);
  const active = Math.max(0, Math.min(caps.length - 1, Math.floor((sec(frame) - CAP0) / CAP_STEP)));
  return (
    <AbsoluteFill>
      <Parchment />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 660,
          background: theme.accent,
          padding: '0 70px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <Kicker color={theme.onAccent} t={k * 0.75} style={{ marginBottom: 12 }}>
          {theme.portal}
        </Kicker>
        <Rise t={title} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 104, lineHeight: 1, color: theme.onAccent }}>
          {theme.label}
        </Rise>
        <div style={{ marginTop: 44, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {caps.map((c, i) => {
            const ct = at(CAP0 + i * CAP_STEP - 0.15, CAP0 + i * CAP_STEP + 0.15);
            const on = i === active && sec(frame) >= CAP0 - 0.15;
            return (
              <div
                key={c.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  fontFamily: BODY,
                  fontWeight: on ? 800 : 600,
                  fontSize: on ? 40 : 32,
                  color: theme.onAccent,
                  opacity: ct * (on ? 1 : 0.55),
                  transform: `translateX(${(1 - ct) * -20}px)`,
                }}
              >
                <span style={{ width: 28, height: 4, borderRadius: 2, background: on ? BRAND.gold : 'transparent' }} />
                {c.label}
              </div>
            );
          })}
        </div>
      </div>
      {caps.map((c, i) => {
        const start = CAP0 + i * CAP_STEP - 0.15;
        const inT = at(start, start + 0.3);
        const shown = i === 0 ? true : frame >= f(start);
        const next = caps[i + 1] ? frame >= f(CAP0 + (i + 1) * CAP_STEP + 0.15) : false;
        if (!shown || next) return null;
        const drift = at(start, start + 1.4, false);
        return (
          <div
            key={c.label}
            style={{
              position: 'absolute',
              left: 740,
              top: 140,
              opacity: i === 0 ? Math.max(inT, at(0, 0.25)) : inT,
              transform: `translateX(${(1 - (i === 0 ? Math.max(inT, at(0, 0.25)) : inT)) * 70}px) scale(${1 + drift * 0.025})`,
              transformOrigin: '0 0',
              zIndex: i,
            }}
          >
            <Card src={c.src} rect={c.rect} width={1110} radius={18} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const RolesSection: React.FC = () => (
  <Beats
    beats={ROLES.map<Beat>((r, i) => ({
      s: 13 / ROLES.length,
      enter: i === 0 ? 'fade' : 'wipe',
      t: 12,
      name: r.role,
      node: <RoleBeat role={r.role} caps={r.caps} />,
    }))}
  />
);

// ─── ACADEMICS / LEARNING · 43–52 s ─────────────────────────────────────────

const LEARN = ['Plan', 'Teach', 'Submit', 'Assess', 'Track'];
const LEARN_S = 1.8;

export const AcademicsSection: React.FC = () => {
  const { frame, at } = useT();
  const active = Math.min(LEARN.length - 1, Math.floor(frame / f(LEARN_S)));
  const rail = at(0, 0.35);
  const teacher = ROLE_THEME.teacher.accent;
  const beats: Beat[] = [
    {
      s: LEARN_S,
      name: 'plan',
      node: (
        <AbsoluteFill>
          <Shot src="teacher-material.png" camera={cam([0, C, 330, 1.45], [1, C, 330, 1.7])} highlights={[{ rect: [285, 262, 1178, 176], from: 0.3, radius: 10 }]} />
          <Tag title="Share course material" kicker="Teacher · Course Material" accent={teacher} delay={0.25} />
        </AbsoluteFill>
      ),
    },
    {
      s: LEARN_S,
      enter: 'slide',
      name: 'teach',
      node: (
        <AbsoluteFill>
          <Shot src="teacher-assignments.png" camera={cam([0, C, 380, 1.4], [1, C, 360, 1.62])} highlights={[{ rect: [285, 225, 1178, 240], from: 0.3, radius: 10 }]} />
          <Tag title="Set assignments" kicker="Teacher · Assignments" accent={teacher} delay={0.2} />
        </AbsoluteFill>
      ),
    },
    {
      s: LEARN_S,
      enter: 'slide',
      name: 'submit',
      node: (
        <AbsoluteFill>
          <Shot
            src="student-assignment-submit.png"
            camera={cam([0, 960, 540, 1.3], [1, 960, 545, 1.95])}
            highlights={[{ rect: [766, 516, 178, 34], from: 0.35, radius: 10 }]}
          />
          <Tag title="Students hand in work" kicker="Student · Assignments" accent={ROLE_THEME.student.accent} delay={0.2} />
        </AbsoluteFill>
      ),
    },
    {
      s: LEARN_S,
      enter: 'slide',
      name: 'assess',
      node: (
        <AbsoluteFill>
          <Shot
            src="teacher-grading.png"
            camera={cam([0, 960, 400, 1.4], [0.55, 960, 700, 1.7], [1, 960, 760, 1.78])}
            highlights={[
              { rect: [833, 212, 82, 24], from: 0.12, to: 0.5, radius: 8 },
              { rect: [626, 826, 668, 94], from: 0.5, radius: 10 },
            ]}
          />
          <Tag title="Grade submissions" kicker="Teacher · Submissions" accent={teacher} delay={0.2} corner="bottom-right" />
        </AbsoluteFill>
      ),
    },
    {
      s: LEARN_S,
      enter: 'slide',
      name: 'track',
      node: (
        <AbsoluteFill>
          <Shot src="parent-performance.png" camera={cam([0, C, 300, 1.4], [1, C, 380, 1.55])} highlights={[{ rect: [285, 228, 1178, 74], from: 0.25, radius: 8 }]} />
          <Tag title="Track performance" kicker="Parent · Report card" accent={ROLE_THEME.parent.accent} delay={0.2} />
        </AbsoluteFill>
      ),
    },
  ];
  return (
    <AbsoluteFill>
      <Beats beats={beats} />
      <StepRail steps={LEARN} active={active} accent={teacher} enterT={rail} />
    </AbsoluteFill>
  );
};

// ─── SCHOOL OPERATIONS · 52–60 s ────────────────────────────────────────────

export const OperationsSection: React.FC = () => (
  <Beats
    beats={[
      {
        s: 1.9,
        name: 'connected',
        node: (
          <AbsoluteFill>
            <Shot src="parent-calendar.png" camera={cam([0, C, 330, 1.45], [1, C, 310, 1.62])} highlights={[{ rect: [285, 155, 1178, 78], from: 0.3, radius: 10 }]} />
            <Tag title="Stay connected." kicker="Parent · Calendar & Events" accent={ROLE_THEME.parent.accent} />
          </AbsoluteFill>
        ),
      },
      {
        s: 2.0,
        enter: 'push',
        name: 'attendance',
        node: (
          <AbsoluteFill>
            <Beats
              beats={[
                {
                  s: 1.0,
                  node: <Shot src="teacher-attendance.png" camera={cam([0, C, 400, 1.5], [1, C, 430, 1.62])} highlights={[{ rect: [285, 432, 1178, 44], from: 0.15, radius: 8 }]} />,
                },
                {
                  s: 1.0,
                  enter: 'fade',
                  t: 6,
                  node: <Shot src="teacher-attendance-saved.png" camera={cam([0, C, 700, 1.55], [1, C, 740, 1.65])} highlights={[{ rect: [285, 957, 1178, 62], from: 0.1, radius: 12 }]} />,
                },
              ]}
            />
            <Tag title="Track attendance." kicker="Teacher · one tap per student" accent={ROLE_THEME.teacher.accent} corner="top-left" />
          </AbsoluteFill>
        ),
      },
      {
        s: 2.4,
        enter: 'push',
        name: 'payments',
        node: (
          <AbsoluteFill>
            <Beats
              beats={[
                {
                  s: 0.7,
                  node: <Shot src="parent-payments.png" camera={cam([0, 1000, 280, 1.4], [1, 1100, 250, 1.6])} highlights={[{ rect: [1306, 155, 137, 38], from: 0.2, radius: 10 }]} />,
                },
                { s: 0.8, enter: 'fade', t: 6, node: <Shot src="parent-pay-modal.png" camera={cam([0, 960, 540, 1.6], [1, 960, 540, 1.8])} highlights={[{ rect: [766, 577, 101, 39], from: 0.3, radius: 10 }]} /> },
                {
                  s: 0.9,
                  enter: 'fade',
                  t: 6,
                  node: <Shot src="parent-pay-done.png" camera={cam([0, 960, 560, 1.08], [1, 1010, 600, 1.2])} highlights={[{ rect: [1541, 998, 358, 61], from: 0.05, radius: 12 }]} />,
                },
              ]}
            />
            <Tag title="Manage payments." kicker="Parent · pay online · receipt issued" accent={ROLE_THEME.parent.accent} />
          </AbsoluteFill>
        ),
      },
      {
        s: 1.7,
        enter: 'push',
        name: 'informed',
        node: (
          <AbsoluteFill>
            <Beats
              beats={[
                { s: 0.8, node: <Shot src="admin-announcements.png" camera={cam([0, C, 300, 1.6], [1, C, 290, 1.72])} highlights={[{ rect: [285, 165, 1178, 126], from: 0.1, radius: 10 }]} /> },
                {
                  s: 0.9,
                  enter: 'push',
                  t: 8,
                  node: <Shot src="student-dashboard.png" camera={cam([0, C, 700, 1.55], [1, C, 740, 1.65])} highlights={[{ rect: [285, 845, 1178, 50], from: 0.1, radius: 10 }]} />,
                },
              ]}
            />
            <Tag title="Keep everyone informed." kicker="Announcements · every portal" />
          </AbsoluteFill>
        ),
      },
    ]}
  />
);

// ─── INSIGHTS / RISK · 60–66 s ──────────────────────────────────────────────

/** The intelligence dashboard's own Attendance and Fees tiles, side by side. */
const HealthTiles: React.FC = () => {
  const { at } = useT();
  const a = at(0, 0.35);
  const b = at(0.12, 0.47);
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 50 }}>
        {[
          { t: a, rect: [285, 323, 381, 187] as [number, number, number, number], k: 'Attendance trends' },
          { t: b, rect: [684, 323, 380, 187] as [number, number, number, number], k: 'Fee health' },
        ].map((x) => (
          <div key={x.k} style={{ opacity: x.t, transform: `translateY(${(1 - x.t) * 40}px)` }}>
            <Kicker style={{ marginBottom: 14 }}>{x.k}</Kicker>
            <Card src="principal-intelligence.png" rect={x.rect} width={780} />
          </div>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const InsightsSection: React.FC = () => {
  const principal = ROLE_THEME.principal.accent;
  return (
    <Beats
      beats={[
        {
          s: 1.5,
          name: 'see',
          node: (
            <AbsoluteFill>
              <Shot src="principal-intelligence.png" camera={cam([0, C, 280, 1.4], [1, C, 250, 1.58])} highlights={[{ rect: [285, 166, 1178, 110], from: 0.2, radius: 12 }]} />
              <Tag title="See what's happening." kicker="Principal · School Intelligence" accent={principal} />
            </AbsoluteFill>
          ),
        },
        { s: 1.1, enter: 'slide-up', name: 'health', node: <HealthTiles /> },
        {
          s: 1.4,
          enter: 'push',
          name: 'spot',
          node: (
            <AbsoluteFill>
              <Shot src="principal-risk.png" camera={cam([0, C, 520, 1.4], [1, C, 580, 1.55])} highlights={[{ rect: [285, 490, 1177, 118], from: 0.2, radius: 8 }]} />
              <Tag title="Spot what needs attention." kicker="Principal · Performance & Risk" accent={principal} corner="top-left" />
            </AbsoluteFill>
          ),
        },
        {
          s: 2.0,
          enter: 'fade',
          name: 'act',
          node: (
            <AbsoluteFill>
              <Shot
                src="principal-risk-drawer.png"
                camera={cam([0, 1300, 540, 1.1], [0.3, 1700, 300, 1.7], [1, 1700, 330, 1.78])}
                highlights={[
                  { rect: [1492, 95, 420, 80], from: 0.25, to: 0.62, radius: 10 },
                  { rect: [1492, 206, 410, 110], from: 0.6, radius: 10 },
                ]}
              />
              <Tag title="Act early." kicker="Why it was flagged · who to contact" accent={principal} size={80} />
            </AbsoluteFill>
          ),
        },
      ]}
    />
  );
};
