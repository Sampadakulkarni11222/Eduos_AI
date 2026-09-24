import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { BRAND } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { LogoMark } from '../components/Brand';

/**
 * A small UI kit that redraws EduOS rather than screenshotting it.
 *
 * Nothing here loads an image: every panel, chart and row is drawn from the
 * product's own tokens (design-system.css) and its own vocabulary (the module
 * names in frontend/src/lib/portals.ts). Numbers are sample data for a
 * demonstration school, not measurements of anything.
 */
export const EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0→1 ramp between two frames, eased. */
export const ramp = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { ...CLAMP, easing: EASE });

/** The app window is drawn at this size, then placed by <Stage>. */
export const APP_W = 1560;
export const APP_H = 880;

const SIDEBAR_W = 250;

export type NavItem = { icon: string; label: string };

/* ── Camera ────────────────────────────────────────────────────────────── */

export type CamKey = { at: number; x: number; y: number; z: number };

/**
 * Moves the whole composition in front of the lens. Coordinates are in app
 * space (0…APP_W, 0…APP_H), so a push can name the widget it is pushing to.
 */
export const Stage: React.FC<{ keys: CamKey[]; progress: number; children: React.ReactNode }> = ({ keys, progress, children }) => {
  let cam = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (progress <= b.at) {
      const t = EASE(Math.min(1, Math.max(0, (progress - a.at) / Math.max(1e-6, b.at - a.at))));
      cam = { at: progress, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      break;
    }
    cam = b;
  }
  // The window is 1560×880 inside a 1920×1080 frame: 1.0 leaves a margin of
  // parchment around it, which is what makes it read as a product shot.
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: APP_W,
        height: APP_H,
        transformOrigin: '0 0',
        transform: `translate(${1920 / 2}px, ${1080 / 2}px) scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)`,
      }}
    >
      {children}
    </div>
  );
};

/* ── Shell ─────────────────────────────────────────────────────────────── */

export const AppWindow: React.FC<{
  accent: string;
  onAccent: string;
  school?: string;
  portal: string;
  nav: NavItem[];
  active: number;
  title: string;
  sub?: string;
  build?: number;
  children: React.ReactNode;
}> = ({ accent, onAccent, school = 'Oakridge Academy', portal, nav, active, title, sub, build = 1, children }) => {
  const shell = ramp(build, 0, 0.18);
  const side = ramp(build, 0.08, 0.34);
  const top = ramp(build, 0.2, 0.44);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        borderRadius: 22,
        overflow: 'hidden',
        background: BRAND.parchment,
        border: `1px solid ${BRAND.hairline}`,
        boxShadow: '0 50px 110px -40px rgba(58,34,41,.5), 0 16px 40px -18px rgba(58,34,41,.25)',
        opacity: shell,
        transform: `scale(${0.985 + shell * 0.015})`,
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: SIDEBAR_W,
          flex: 'none',
          background: accent,
          padding: '22px 16px',
          transform: `translateX(${(1 - side) * -SIDEBAR_W}px)`,
          opacity: side,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 18, borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          <LogoMark size={36} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 15, color: onAccent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {school}
            </div>
            <div style={{ fontFamily: BODY, fontSize: 11.5, letterSpacing: '.05em', color: onAccent, opacity: 0.65 }}>{portal}</div>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {nav.map((n, i) => {
            const t = ramp(build, 0.14 + i * 0.018, 0.3 + i * 0.018);
            const on = i === active;
            return (
              <div
                key={n.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '9px 11px',
                  borderRadius: 9,
                  background: on ? 'rgba(255,255,255,.14)' : 'transparent',
                  boxShadow: on ? `inset 3px 0 0 ${BRAND.gold}` : undefined,
                  opacity: t,
                  transform: `translateX(${(1 - t) * -12}px)`,
                }}
              >
                <span style={{ width: 18, textAlign: 'center', fontSize: 14, color: onAccent, opacity: on ? 1 : 0.72 }}>{n.icon}</span>
                <span style={{ fontFamily: BODY, fontWeight: on ? 700 : 500, fontSize: 13.5, color: onAccent, opacity: on ? 1 : 0.82 }}>{n.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            padding: '20px 30px',
            background: 'rgba(251,246,236,.9)',
            borderBottom: `1px solid ${BRAND.hairline}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: top,
            transform: `translateY(${(1 - top) * -10}px)`,
          }}
        >
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 27, color: accent, lineHeight: 1.1 }}>{title}</div>
            {sub && <div style={{ fontFamily: BODY, fontSize: 13.5, color: BRAND.text2, marginTop: 3 }}>{sub}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: '#fff', border: `1px solid ${BRAND.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
              ◔
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 16px',
                borderRadius: 10,
                background: accent,
                color: onAccent,
                fontFamily: BODY,
                fontWeight: 700,
                fontSize: 13.5,
              }}
            >
              <span style={{ color: BRAND.gold }}>✦</span> Ask Agent
            </div>
          </div>
        </div>
        <div style={{ flex: 1, padding: '22px 30px', background: BRAND.parchment, overflow: 'hidden' }}>{children}</div>
      </div>
    </div>
  );
};

/* ── Cards and widgets ─────────────────────────────────────────────────── */

export const Card: React.FC<{ t?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ t = 1, style, children }) => (
  <div
    style={{
      background: BRAND.card,
      border: `1px solid ${BRAND.cardBorder}`,
      borderRadius: 16,
      padding: 18,
      boxShadow: '0 18px 40px -28px rgba(58,34,41,.4)',
      opacity: t,
      transform: `translateY(${(1 - t) * 22}px)`,
      ...style,
    }}
  >
    {children}
  </div>
);

export const CardTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
    <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 18, color: BRAND.text1 }}>{children}</span>
    {right && <span style={{ fontFamily: BODY, fontSize: 12.5, color: BRAND.gold, fontWeight: 700 }}>{right}</span>}
  </div>
);

/** A statistic that counts up as it lands. */
export const StatTile: React.FC<{
  label: string;
  value: number;
  t: number;
  prefix?: string;
  suffix?: string;
  sub?: string;
  accent?: string;
  compact?: boolean;
}> = ({ label, value, t, prefix = '', suffix = '', sub, accent = BRAND.text1, compact }) => {
  const shown = Math.round(value * EASE(Math.min(1, Math.max(0, t))));
  return (
    <Card t={t > 0 ? 1 : 0} style={{ padding: compact ? 14 : 18, opacity: t, transform: `translateY(${(1 - t) * 24}px)` }}>
      <div style={{ fontFamily: BODY, fontSize: 13, color: BRAND.text2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: compact ? 30 : 38, lineHeight: 1, color: accent }}>
        {prefix}
        {shown.toLocaleString('en-IN')}
        {suffix}
      </div>
      {sub && <div style={{ fontFamily: BODY, fontSize: 12, color: BRAND.textFaint, marginTop: 7 }}>{sub}</div>}
    </Card>
  );
};

/** Weekly bars — they grow from the baseline as `t` advances. */
export const Bars: React.FC<{ data: { label: string; value: number }[]; t: number; accent: string; height?: number }> = ({
  data,
  t,
  accent,
  height = 116,
}) => {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height }}>
      {data.map((d, i) => {
        const bt = ramp(t, i * 0.06, i * 0.06 + 0.5);
        const h = (d.value / max) * (height - 26) * bt;
        return (
          <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: '100%', height: h, background: `linear-gradient(180deg, ${accent}, ${accent}cc)`, borderRadius: 6 }} />
            <span style={{ fontFamily: BODY, fontSize: 11.5, color: BRAND.textFaint }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
};

/** Attendance ring: the arc sweeps to the value. */
export const Donut: React.FC<{ pct: number; t: number; accent: string; size?: number; caption?: string }> = ({
  pct,
  t,
  accent,
  size = 132,
  caption,
}) => {
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  const shown = pct * EASE(Math.min(1, Math.max(0, t)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={BRAND.hairline} strokeWidth={12} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={accent}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - shown / 100)}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 30, color: BRAND.text1 }}>{Math.round(shown)}%</span>
        </div>
      </div>
      {caption && <span style={{ fontFamily: BODY, fontSize: 12.5, color: BRAND.text2 }}>{caption}</span>}
    </div>
  );
};

/** Collection trend: the line draws itself, then the area fills in behind it. */
export const Trend: React.FC<{ points: number[]; t: number; accent: string; width?: number; height?: number }> = ({
  points,
  t,
  accent,
  width = 420,
  height = 120,
}) => {
  const max = Math.max(...points) * 1.12;
  const step = width / (points.length - 1);
  const xy = points.map((p, i) => [i * step, height - (p / max) * height] as const);
  const d = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  const len = width * 1.35;
  const draw = EASE(Math.min(1, Math.max(0, t)));
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="trendfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.22" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trendfill)" opacity={Math.max(0, draw * 1.4 - 0.4)} />
      <path d={d} fill="none" stroke={accent} strokeWidth={3} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />
      {xy.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={4} fill="#fff" stroke={accent} strokeWidth={2.5} opacity={ramp(draw, i / points.length, i / points.length + 0.12)} />
      ))}
    </svg>
  );
};

/** Rows that slide in one after another: timetable, notices, activity. */
export const Rows: React.FC<{
  rows: { left: string; right?: string; sub?: string; tone?: string }[];
  t: number;
  dense?: boolean;
}> = ({ rows, t, dense }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    {rows.map((r, i) => {
      const rt = ramp(t, i * 0.09, i * 0.09 + 0.45);
      return (
        <div
          key={r.left + i}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: dense ? '8px 0' : '11px 0',
            borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${BRAND.hairline}`,
            opacity: rt,
            transform: `translateX(${(1 - rt) * 16}px)`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 14, color: BRAND.text1, whiteSpace: 'nowrap' }}>{r.left}</div>
            {r.sub && <div style={{ fontFamily: BODY, fontSize: 12, color: BRAND.textFaint, marginTop: 2 }}>{r.sub}</div>}
          </div>
          {r.right && (
            <span
              style={{
                fontFamily: BODY,
                fontWeight: 700,
                fontSize: 12.5,
                color: r.tone ?? BRAND.text2,
                background: r.tone ? `${r.tone}18` : 'transparent',
                borderRadius: 999,
                padding: r.tone ? '4px 11px' : 0,
                whiteSpace: 'nowrap',
              }}
            >
              {r.right}
            </span>
          )}
        </div>
      );
    })}
  </div>
);

/**
 * A pointer that travels between two points and clicks. Used once, on the
 * dashboard, so the scene reads as someone using the product.
 */
export const Cursor: React.FC<{ from: [number, number]; to: [number, number]; t: number; clickAt?: number }> = ({
  from,
  to,
  t,
  clickAt = 0.72,
}) => {
  const p = EASE(Math.min(1, Math.max(0, t)));
  const x = from[0] + (to[0] - from[0]) * p;
  const y = from[1] + (to[1] - from[1]) * p;
  const click = interpolate(t, [clickAt, clickAt + 0.12], [0, 1], CLAMP);
  return (
    <div style={{ position: 'absolute', left: x, top: y, pointerEvents: 'none' }}>
      {click > 0 && (
        <div
          style={{
            position: 'absolute',
            left: -19,
            top: -19,
            width: 38,
            height: 38,
            borderRadius: 19,
            border: `2px solid ${BRAND.gold}`,
            opacity: (1 - click) * 0.9,
            transform: `scale(${0.4 + click * 1.1})`,
          }}
        />
      )}
      <svg width="26" height="30" viewBox="0 0 26 30" style={{ filter: 'drop-shadow(0 4px 10px rgba(58,34,41,.35))' }}>
        <path d="M3 2 L3 23 L9 18 L13 27 L17 25 L13 16 L21 16 Z" fill="#fff" stroke={BRAND.text1} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

/** Section heading used between the product scenes. */
export const SectionTitle: React.FC<{ kicker?: string; title: string; t: number; sub?: string }> = ({ kicker, title, t, sub }) => (
  <div style={{ textAlign: 'center', opacity: t, transform: `translateY(${(1 - t) * 18}px)` }}>
    {kicker && (
      <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 17, letterSpacing: '.18em', textTransform: 'uppercase', color: BRAND.gold, marginBottom: 12 }}>
        {kicker}
      </div>
    )}
    <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 62, lineHeight: 1.08, color: BRAND.maroon }}>{title}</div>
    {sub && <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: 24, color: BRAND.text2, marginTop: 14 }}>{sub}</div>}
  </div>
);
