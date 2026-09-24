import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { BRAND, COPY, ROLE_THEME } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { LogoMark, Parchment } from '../components/Brand';
import { useBeatDuration } from '../components/duration';
import { Card, ramp } from './ui';

/* ── Intro ─────────────────────────────────────────────────────────────── */

/**
 * 0–7.4s — the mark draws, the name and tagline settle, and a row of module
 * chips drifts up behind them: a school platform, established in five seconds.
 */
const CHIPS = ['Students', 'Attendance', 'Timetable', 'Exams', 'Fees', 'Hostel', 'Library', 'Admissions'];

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const at = (f: number) => f * D;
  // Visible on frame 0 — an empty opening frame reads as a glitch.
  const plate = interpolate(frame, [0, at(0.12)], [0.3, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const draw = ramp(frame, at(0.04), at(0.26));
  const word = ramp(frame, at(0.3), at(0.48));
  const rule = ramp(frame, at(0.42), at(0.58));
  const tag = ramp(frame, at(0.48), at(0.64));
  const chips = ramp(frame, at(0.6), at(0.92));

  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ opacity: plate, transform: `scale(${0.84 + plate * 0.16})`, filter: 'drop-shadow(0 22px 40px rgba(89,22,32,.28))', marginBottom: 26 }}>
          <LogoMark size={150} draw={draw} />
        </div>
        <div style={{ overflow: 'hidden', paddingBottom: 6 }}>
          <div
            style={{
              fontFamily: DISPLAY,
              fontWeight: 600,
              fontSize: 140,
              lineHeight: 1,
              letterSpacing: '-.01em',
              color: BRAND.maroon,
              transform: `translateY(${(1 - word) * 112}%)`,
            }}
          >
            {COPY.product}
          </div>
        </div>
        <div style={{ width: 380 * rule, height: 2, background: BRAND.gold, margin: '24px 0 22px', borderRadius: 2 }} />
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 34, letterSpacing: '.02em', color: BRAND.text2, opacity: tag }}>
          A complete school operating system
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 52, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 1200 }}>
          {CHIPS.map((c, i) => {
            const t = ramp(chips, i * 0.07, i * 0.07 + 0.4);
            return (
              <span
                key={c}
                style={{
                  fontFamily: BODY,
                  fontWeight: 600,
                  fontSize: 22,
                  color: BRAND.text2,
                  background: '#fff',
                  border: `1px solid ${BRAND.cardBorder}`,
                  borderRadius: 999,
                  padding: '10px 22px',
                  opacity: t * 0.96,
                  transform: `translateY(${(1 - t) * 18}px)`,
                  boxShadow: '0 14px 30px -22px rgba(58,34,41,.5)',
                }}
              >
                {c}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ── Bridge ────────────────────────────────────────────────────────────── */

/** 27.3–31.2s — the line between the dashboard and the module cards. */
export const BridgeScene: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const a = ramp(frame, D * 0.05, D * 0.3);
  const b = ramp(frame, D * 0.2, D * 0.45);
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
        {[
          { text: 'Everything your school needs,', t: a, color: BRAND.maroon },
          { text: 'in one place.', t: b, color: BRAND.gold },
        ].map((l) => (
          <div key={l.text} style={{ overflow: 'hidden', paddingBottom: 6 }}>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: 82,
                lineHeight: 1.1,
                color: l.color,
                transform: `translateY(${(1 - l.t) * 112}%)`,
              }}
            >
              {l.text}
            </div>
          </div>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ── Close ─────────────────────────────────────────────────────────────── */

/**
 * 82.4–90s — the recreated pieces converge into the identity, then the
 * closing line. Each tile is one of the scenes the viewer has just seen.
 */
const TILES = [
  { label: 'Dashboard', accent: ROLE_THEME.admin.accent, from: [-620, -260] },
  { label: 'Attendance', accent: BRAND.green, from: [640, -230] },
  { label: 'Fees', accent: ROLE_THEME.admin.accent, from: [-700, 210] },
  { label: 'Timetable', accent: ROLE_THEME.teacher.accent, from: [660, 250] },
  { label: 'Ask Agent', accent: ROLE_THEME.principal.accent, from: [0, 330] },
  { label: 'Hostel', accent: ROLE_THEME.warden.accent, from: [-420, 330] },
  { label: 'Library', accent: ROLE_THEME.librarian.accent, from: [420, -330] },
];

export const CloseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const p = frame / Math.max(1, D - 1);
  const gather = ramp(p, 0.02, 0.34);
  const mark = ramp(p, 0.24, 0.44);
  const word = ramp(p, 0.3, 0.5);
  const line1 = ramp(p, 0.44, 0.62);
  const line2 = ramp(p, 0.52, 0.7);

  return (
    <AbsoluteFill>
      <Parchment drift={false} />
      {/* the pieces travel in and fade as the identity takes over */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {TILES.map((tile, i) => {
          const t = ramp(p, 0.02 + i * 0.02, 0.32 + i * 0.02);
          // They gather into a loose cluster rather than one point: converging
          // on the exact centre just stacks seven cards on top of each other.
          const away = 0.22 + (1 - gather) * 0.78;
          return (
            <div
              key={tile.label}
              style={{
                position: 'absolute',
                transform: `translate(${tile.from[0] * away}px, ${tile.from[1] * away}px) scale(${0.86 + t * 0.14 - gather * 0.12})`,
                opacity: t * (1 - ramp(p, 0.26, 0.42)),
              }}
            >
              <Card style={{ padding: '14px 22px', borderRadius: 14 }}>
                <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 20, color: tile.accent }}>{tile.label}</span>
              </Card>
            </div>
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, opacity: mark, transform: `scale(${0.94 + mark * 0.06})` }}>
          <div style={{ filter: 'drop-shadow(0 20px 36px rgba(89,22,32,.25))' }}>
            <LogoMark size={140} />
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 132, lineHeight: 1, color: BRAND.maroon, transform: `translateY(${(1 - word) * 112}%)` }}>
              {COPY.product}
            </div>
          </div>
        </div>
        <div style={{ width: 460 * line1, height: 2, background: BRAND.gold, margin: '32px 0 26px', borderRadius: 2 }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ overflow: 'hidden', paddingBottom: 4 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 52, lineHeight: 1.15, color: BRAND.text1, transform: `translateY(${(1 - line1) * 112}%)` }}>
              One Intelligent Platform.
            </div>
          </div>
          <div style={{ overflow: 'hidden', paddingBottom: 4 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 52, lineHeight: 1.15, color: BRAND.text1, transform: `translateY(${(1 - line2) * 112}%)` }}>
              For Every School.
            </div>
          </div>
        </div>
      </AbsoluteFill>

      {/* clean fade to parchment */}
      <AbsoluteFill style={{ background: BRAND.parchment, opacity: ramp(p, 0.93, 1) }} />
    </AbsoluteFill>
  );
};
