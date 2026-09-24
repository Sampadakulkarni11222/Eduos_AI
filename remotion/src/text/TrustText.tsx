import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { BRAND, COPY } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { LogoMark, Parchment } from '../components/Brand';
import { ShotSequence } from '../components/ShotSequence';
import { useBeatDuration } from '../components/duration';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * Five properties of the implementation, not marketing lines:
 * permissions with ALL/OWN scope enforced server-side, per-school tenancy,
 * the audit log, confirm-before-write, and the MCP server every assistant
 * read and write goes through (docs/MCP-ARCHITECTURE.md).
 */
const PILLARS = [
  { mark: '◉', title: 'Role-based permissions', body: 'ALL or OWN scope' },
  { mark: '▦', title: 'School-level data separation', body: 'Per-school records' },
  { mark: '▷', title: 'Audit logging', body: 'Every action recorded' },
  { mark: '✓', title: 'Confirmation before changes', body: 'You approve every write' },
  { mark: '◈', title: 'Connected through MCP', body: 'One execution layer' },
];

const Pillars: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const head = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ opacity: 0.1, filter: 'blur(5px)' }}>
        <Img src={staticFile('screenshots/admin-permissions.png')} style={{ width: '100%', height: '100%' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 100 }}>
        <div style={{ opacity: head, transform: `translateY(${(1 - head) * 20}px)`, textAlign: 'center', marginBottom: 58 }}>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 17, letterSpacing: '.18em', color: BRAND.gold, textTransform: 'uppercase', marginBottom: 12 }}>
            Built for trust
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 66, color: BRAND.maroon }}>Powerful, and accountable.</div>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          {PILLARS.map((p, i) => {
            const t = interpolate(frame, [D * 0.1 + i * 7, D * 0.1 + i * 7 + 18], [0, 1], { ...clamp, easing: EASE });
            return (
              <div
                key={p.title}
                style={{
                  width: 318,
                  minHeight: 236,
                  background: BRAND.card,
                  border: `1px solid ${BRAND.cardBorder}`,
                  borderRadius: 20,
                  padding: '30px 28px',
                  boxShadow: '0 30px 60px -34px rgba(58,34,41,.45)',
                  opacity: t,
                  transform: `translateY(${(1 - t) * 36}px)`,
                }}
              >
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 14,
                    background: `linear-gradient(150deg, ${BRAND.cream1}, ${BRAND.cream2})`,
                    color: BRAND.maroon,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 26,
                    marginBottom: 22,
                  }}
                >
                  {p.mark}
                </div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 30, lineHeight: 1.12, color: BRAND.text1, marginBottom: 10 }}>{p.title}</div>
                <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 20, color: BRAND.textFaint }}>{p.body}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The close: mark, name, tagline, then the three-line promise. */
const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const mark = interpolate(frame, [0, D * 0.18], [0, 1], { ...clamp, easing: EASE });
  const word = interpolate(frame, [D * 0.08, D * 0.26], [0, 1], { ...clamp, easing: EASE });
  const tag = interpolate(frame, [D * 0.2, D * 0.36], [0, 1], { ...clamp, easing: EASE });
  const rule = interpolate(frame, [D * 0.3, D * 0.44], [0, 1], { ...clamp, easing: EASE });
  const LINES = ['One Platform.', 'Connected School.', 'Smarter Management.'];
  return (
    <AbsoluteFill>
      <Parchment drift={false} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 34, opacity: mark, transform: `scale(${0.94 + mark * 0.06})` }}>
          <div style={{ filter: 'drop-shadow(0 20px 36px rgba(89,22,32,.25))' }}>
            <LogoMark size={150} />
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 132, lineHeight: 1, color: BRAND.maroon, transform: `translateY(${(1 - word) * 112}%)` }}>
              {COPY.product}
            </div>
          </div>
        </div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 32, letterSpacing: '.02em', color: BRAND.text2, marginTop: 18, opacity: tag }}>
          {COPY.tagline}
        </div>
        <div style={{ width: 460 * rule, height: 2, background: BRAND.gold, margin: '30px 0 26px', borderRadius: 2 }} />
        <div style={{ display: 'flex', gap: 28 }}>
          {LINES.map((l, i) => {
            const t = interpolate(frame, [D * 0.36 + i * 8, D * 0.36 + i * 8 + 18], [0, 1], { ...clamp, easing: EASE });
            return (
              <div key={l} style={{ overflow: 'hidden', paddingBottom: 4 }}>
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 500,
                    fontSize: 44,
                    lineHeight: 1.1,
                    color: BRAND.text1,
                    transform: `translateY(${(1 - t) * 112}%)`,
                  }}
                >
                  {l}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 79.6–90s — trust, then the close, with the end card given the longer half. */
export const TrustText: React.FC = () => (
  <ShotSequence
    overlap={16}
    beats={[
      { weight: 1, node: <Pillars /> },
      { weight: 1.15, enter: 'fade', node: <EndCard /> },
    ]}
  />
);
