import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile } from 'remotion';
import { BRAND, COPY, ROLE_THEME, RoleKey } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { LogoMark, Parchment } from '../components/Brand';
import { Beats, Card, Kicker, Rise, clamp, useT } from './kit';

// ─── INTRO · 0–7 s ──────────────────────────────────────────────────────────

/** The lock-up, built fast: mark, name, tagline in under a second and a half. */
const LockUp: React.FC = () => {
  const { at } = useT();
  const plate = at(0, 0.4);
  const draw = at(0.05, 0.6, false);
  const word = at(0.3, 0.75);
  const rule = at(0.55, 0.95);
  const tag = at(0.7, 1.1);
  const bg = at(0.8, 2.4, false);
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ opacity: bg * 0.13, filter: 'blur(7px) saturate(.8)', transform: `scale(${1.12 - bg * 0.05})` }}>
        <Img src={staticFile('screenshots/admin-dashboard.png')} style={{ width: '100%', height: '100%' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <div style={{ opacity: plate, transform: `scale(${0.8 + plate * 0.2})`, filter: 'drop-shadow(0 22px 40px rgba(89,22,32,.28))' }}>
            <LogoMark size={170} draw={draw} />
          </div>
          <Rise t={word} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 168, lineHeight: 1, color: BRAND.maroon, letterSpacing: '-.01em' }}>
            {COPY.product}
          </Rise>
        </div>
        <div style={{ width: 420 * rule, height: 2, background: BRAND.gold, margin: '34px 0 26px', borderRadius: 2 }} />
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 42, letterSpacing: '.02em', color: BRAND.text2, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>
          {COPY.tagline}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Headline on the left, a real screen swinging in on the right. */
const Moment: React.FC<{ line: string; kicker: string; accent?: string; children: React.ReactNode }> = ({ line, kicker, accent = BRAND.maroon, children }) => {
  const { at } = useT();
  const t = at(0.05, 0.45);
  const k = at(0.15, 0.5);
  const ui = at(0, 0.6);
  const drift = at(0, 1.6, false);
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 110 }}>
        <div style={{ width: 680 }}>
          <Kicker t={k} style={{ marginBottom: 14 }}>{kicker}</Kicker>
          <Rise t={t} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 96, lineHeight: 1.04, color: accent }}>
            {line}
          </Rise>
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ perspective: 1800 }}>
        <div
          style={{
            position: 'absolute',
            left: 830,
            top: 170,
            transformOrigin: '0% 50%',
            transform: `translateX(${(1 - ui) * 260}px) rotateY(${-16 + ui * 9}deg) scale(${1.02 + drift * 0.04})`,
            opacity: Math.min(1, ui * 1.8),
          }}
        >
          {children}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const FAN: { role: RoleKey; src: string }[] = [
  { role: 'teacher', src: 'teacher-dashboard.png' },
  { role: 'parent', src: 'parent-dashboard.png' },
  { role: 'student', src: 'student-dashboard.png' },
  { role: 'principal', src: 'principal-intelligence.png' },
];

/** Four real portals fanning in, each under its own role colour. */
const RoleFan: React.FC = () => {
  const { at } = useT();
  const t = at(0.05, 0.45);
  const k = at(0.15, 0.5);
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 110 }}>
        <div style={{ width: 640 }}>
          <Kicker t={k} style={{ marginBottom: 14 }}>Role-based portals</Kicker>
          <Rise t={t} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 96, lineHeight: 1.04, color: BRAND.gold }}>
            Every school role.
          </Rise>
        </div>
      </AbsoluteFill>
      {FAN.map((c, i) => {
        const ct = at(0.08 + i * 0.13, 0.5 + i * 0.13);
        const theme = ROLE_THEME[c.role];
        return (
          <div
            key={c.role}
            style={{
              position: 'absolute',
              left: 800 + i * 190,
              top: 200 + i * 110,
              opacity: Math.min(1, ct * 1.6),
              transform: `translateY(${(1 - ct) * 80}px) rotate(${(i - 1.5) * 2.2}deg)`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -44,
                left: 0,
                padding: '8px 18px',
                borderRadius: 999,
                background: theme.accent,
                color: theme.onAccent,
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: 26,
              }}
            >
              {theme.label}
            </div>
            <Card src={c.src} rect={[0, 0, 1470, 830]} width={520} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const IntroSection: React.FC = () => (
  <Beats
    beats={[
      { s: 2.3, node: <LockUp />, name: 'lockup' },
      {
        s: 1.5,
        enter: 'push',
        name: 'one-platform',
        node: (
          <Moment line="One platform." kicker="Admin Console">
            <Card src="admin-dashboard.png" rect={[0, 0, 1470, 900]} width={1000} />
          </Moment>
        ),
      },
      { s: 1.55, enter: 'push', name: 'every-role', node: <RoleFan /> },
      {
        s: 1.65,
        enter: 'push',
        name: 'connected',
        node: (
          <Moment line="Connected school operations." kicker="School Intelligence" accent={ROLE_THEME.principal.accent}>
            <Card src="principal-intelligence.png" rect={[0, 0, 1470, 900]} width={1000} />
          </Moment>
        ),
      },
    ]}
  />
);

// ─── TRUST · 82–86.6 s ──────────────────────────────────────────────────────

/**
 * The path every assistant request takes, as docs/MCP-ARCHITECTURE.md draws
 * it: the agent reaches ERP data only through the MCP server, which resolves
 * identity, permission and school scope, holds writes for confirmation and
 * writes the audit entry.
 */
const NODES = [
  { label: 'You', sub: 'signed in, with a role' },
  { label: 'Ask Agent', sub: 'understands the request' },
  { label: 'MCP', sub: 'identity · permission · school' },
  { label: 'Authorized ERP data', sub: 'only what your role allows' },
  { label: 'Confirmation', sub: 'before any change' },
  { label: 'Audit log', sub: 'every action recorded' },
];

const FlowDiagram: React.FC = () => {
  const { at } = useT();
  const head = at(0, 0.35);
  const W = 272;
  const GAP = 28;
  const total = NODES.length * W + (NODES.length - 1) * GAP;
  const left0 = (1920 - total) / 2;
  const pulse = interpolate(at(0.25, 2.1, false), [0, 1], [0, NODES.length - 1], clamp);
  return (
    <AbsoluteFill>
      <Parchment />
      <div style={{ position: 'absolute', top: 200, width: '100%', textAlign: 'center', opacity: head, transform: `translateY(${(1 - head) * 16}px)` }}>
        <Kicker style={{ marginBottom: 12 }}>Built for trust</Kicker>
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 70, color: BRAND.maroon }}>Every answer takes one path.</div>
      </div>
      {/* The rail the pulse travels along. */}
      <div style={{ position: 'absolute', top: 600, left: left0 + W / 2, width: total - W, height: 4, background: BRAND.hairline, borderRadius: 2 }} />
      <div
        style={{
          position: 'absolute',
          top: 600,
          left: left0 + W / 2,
          width: (total - W) * (pulse / (NODES.length - 1)),
          height: 4,
          background: BRAND.gold,
          borderRadius: 2,
          boxShadow: '0 0 16px rgba(201,162,63,.7)',
        }}
      />
      {NODES.map((n, i) => {
        const lit = interpolate(pulse, [i - 0.4, i], [0, 1], clamp);
        const inT = at(0.05 + i * 0.06, 0.4 + i * 0.06);
        const mcp = n.label === 'MCP';
        return (
          <div
            key={n.label}
            style={{
              position: 'absolute',
              left: left0 + i * (W + GAP),
              top: 490,
              width: W,
              height: 220,
              borderRadius: 20,
              background: lit > 0.5 ? (mcp ? BRAND.maroon : '#fff') : 'rgba(255,255,255,.6)',
              border: `2px solid ${lit > 0.5 ? BRAND.gold : BRAND.cardBorder}`,
              boxShadow: lit > 0.5 ? '0 24px 50px -24px rgba(89,22,32,.55), 0 0 0 6px rgba(201,162,63,.16)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '0 16px',
              opacity: inT,
              transform: `translateY(${(1 - inT) * 24}px) scale(${1 + lit * 0.04})`,
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: mcp ? 60 : 38, lineHeight: 1.06, color: lit > 0.5 && mcp ? '#FBF6EC' : BRAND.text1 }}>{n.label}</div>
            <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 20, marginTop: 12, color: lit > 0.5 && mcp ? BRAND.cream2 : BRAND.textFaint }}>{n.sub}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const PILLARS: { title: string; body: string; crop?: { src: string; rect: [number, number, number, number] } }[] = [
  { title: 'Role-based permissions', body: 'Per role, ALL or OWN scope', crop: { src: 'admin-permissions.png', rect: [285, 200, 1178, 560] } },
  { title: 'School-level data separation', body: "One school never sees another's records" },
  { title: 'Audit logging', body: 'Including every agent action', crop: { src: 'admin-audit.png', rect: [285, 160, 1178, 500] } },
];

const Pillars: React.FC = () => {
  const { at } = useT();
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 36 }}>
        {PILLARS.map((p, i) => {
          const t = at(0.05 + i * 0.14, 0.45 + i * 0.14);
          return (
            <div
              key={p.title}
              style={{
                width: 520,
                height: 470,
                background: BRAND.card,
                border: `1px solid ${BRAND.cardBorder}`,
                borderTop: `5px solid ${BRAND.gold}`,
                borderRadius: 22,
                padding: '36px 36px',
                boxShadow: '0 34px 70px -36px rgba(58,34,41,.5)',
                opacity: t,
                transform: `translateY(${(1 - t) * 40}px)`,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 44, lineHeight: 1.08, color: BRAND.maroon }}>{p.title}</div>
              <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 22, color: BRAND.text2 }}>{p.body}</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                {p.crop ? (
                  <Card src={p.crop.src} rect={p.crop.rect} width={448} radius={12} />
                ) : (
                  <SchoolWalls />
                )}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Two schools, each in its own box — drawn, not a UI claim. */
const SchoolWalls: React.FC = () => (
  <div style={{ display: 'flex', gap: 18, width: '100%' }}>
    {['School A', 'School B'].map((s) => (
      <div
        key={s}
        style={{
          flex: 1,
          height: 150,
          borderRadius: 14,
          border: `2px dashed ${BRAND.cream2}`,
          background: BRAND.panel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <LogoMark size={46} />
        <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 18, color: BRAND.text2 }}>{s}</div>
      </div>
    ))}
  </div>
);

export const TrustSection: React.FC = () => (
  <Beats
    beats={[
      { s: 2.6, node: <FlowDiagram />, name: 'mcp-flow' },
      { s: 2.0, enter: 'slide-up', node: <Pillars />, name: 'pillars' },
    ]}
  />
);

// ─── FINALE · 86.6–90 s ─────────────────────────────────────────────────────

const TILES: { label: string; src: string; rect: [number, number, number, number] }[] = [
  { label: 'Dashboard', src: 'admin-dashboard.png', rect: [270, 95, 1210, 680] },
  { label: 'Attendance', src: 'teacher-attendance-saved.png', rect: [270, 150, 1210, 680] },
  { label: 'Assignments', src: 'teacher-assignments.png', rect: [270, 95, 1210, 680] },
  { label: 'Payments', src: 'admin-payments.png', rect: [270, 95, 1210, 680] },
  { label: 'Calendar', src: 'admin-calendar.png', rect: [270, 95, 1210, 680] },
  { label: 'Library', src: 'librarian-books.png', rect: [270, 95, 1210, 680] },
  { label: 'Hostel', src: 'warden-rooms.png', rect: [270, 95, 1210, 680] },
  { label: 'Ask Agent', src: 'ask-agent-read.png', rect: [1100, 0, 820, 461] },
];

const Mosaic: React.FC = () => {
  const { at } = useT();
  const l1 = at(0.05, 0.4);
  const l2 = at(0.4, 0.75);
  return (
    <AbsoluteFill>
      <Parchment />
      <div style={{ position: 'absolute', top: 70, width: '100%', display: 'flex', justifyContent: 'center', gap: 28 }}>
        <Rise t={l1} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 80, color: BRAND.maroon }}>One school.</Rise>
        <Rise t={l2} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 80, color: BRAND.gold }}>One connected platform.</Rise>
      </div>
      <div style={{ position: 'absolute', top: 250, left: 90, right: 90, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 28 }}>
        {TILES.map((tile, i) => {
          const t = at(0.02 + i * 0.07, 0.35 + i * 0.07);
          return (
            <div key={tile.label} style={{ opacity: t, transform: `translateY(${(1 - t) * 50}px) scale(${0.92 + t * 0.08})` }}>
              <Card src={tile.src} rect={tile.rect} width={414} radius={12} />
              <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 20, letterSpacing: '.14em', textTransform: 'uppercase', color: BRAND.text2, marginTop: 12 }}>
                {tile.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const { at } = useT();
  const mark = at(0, 0.45);
  const word = at(0.15, 0.6);
  const rule = at(0.4, 0.8);
  const tag = at(0.5, 0.9);
  return (
    <AbsoluteFill>
      <Parchment drift={false} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, opacity: mark, transform: `scale(${0.94 + mark * 0.06})` }}>
          <div style={{ filter: 'drop-shadow(0 20px 36px rgba(89,22,32,.25))' }}>
            <LogoMark size={160} />
          </div>
          <Rise t={word} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 150, lineHeight: 1, color: BRAND.maroon }}>
            {COPY.product}
          </Rise>
        </div>
        <div style={{ width: 460 * rule, height: 2, background: BRAND.gold, margin: '34px 0 26px', borderRadius: 2 }} />
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 40, letterSpacing: '.02em', color: BRAND.text2, opacity: tag }}>{COPY.tagline}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const FinaleSection: React.FC = () => (
  <Beats
    beats={[
      { s: 1.45, node: <Mosaic />, name: 'mosaic' },
      { s: 1.95, enter: 'fade', node: <EndCard />, name: 'end-card' },
    ]}
  />
);
