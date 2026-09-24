import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { BRAND, COPY } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { LogoMark, Parchment } from '../components/Brand';
import { ShotSequence } from '../components/ShotSequence';
import { useBeatDuration } from '../components/duration';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Each pillar is a property of the codebase, not a marketing claim — see the README/docs. */
const PILLARS = [
  { mark: '◉', title: 'Role-based permissions', body: 'ALL or OWN scope, enforced on every API call.' },
  { mark: '▦', title: 'School-level data separation', body: "Each school's records stay with that school." },
  { mark: '▷', title: 'Audit logging', body: 'Administrative and AI actions recorded.' },
  { mark: '✓', title: 'AI with confirmation', body: 'Every write waits for a person to approve it.' },
  { mark: '◈', title: 'Connected ecosystem', body: 'Nine role portals on one platform.' },
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
        <div style={{ opacity: head, transform: `translateY(${(1 - head) * 20}px)`, textAlign: 'center', marginBottom: 60 }}>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 18, letterSpacing: '.16em', color: BRAND.gold, textTransform: 'uppercase', marginBottom: 12 }}>
            Built for trust
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 64, color: BRAND.maroon }}>Powerful, and accountable.</div>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          {PILLARS.map((p, i) => {
            const t = interpolate(frame, [D * 0.12 + i * 7, D * 0.12 + i * 7 + 18], [0, 1], { ...clamp, easing: EASE });
            return (
              <div
                key={p.title}
                style={{
                  width: 318,
                  minHeight: 250,
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
                <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 30, lineHeight: 1.12, color: BRAND.text1, marginBottom: 12 }}>{p.title}</div>
                <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: 20, lineHeight: 1.4, color: BRAND.text2 }}>{p.body}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const mark = interpolate(frame, [0, D * 0.2], [0, 1], { ...clamp, easing: EASE });
  const word = interpolate(frame, [D * 0.1, D * 0.3], [0, 1], { ...clamp, easing: EASE });
  const tag = interpolate(frame, [D * 0.22, D * 0.4], [0, 1], { ...clamp, easing: EASE });
  const line = interpolate(frame, [D * 0.34, D * 0.54], [0, 1], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill>
      <Parchment drift={false} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, opacity: mark, transform: `scale(${0.94 + mark * 0.06})` }}>
          <div style={{ filter: 'drop-shadow(0 20px 36px rgba(89,22,32,.25))' }}>
            <LogoMark size={176} />
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 150, lineHeight: 1, color: BRAND.maroon, transform: `translateY(${(1 - word) * 112}%)` }}>
              {COPY.product}
            </div>
          </div>
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 34,
            letterSpacing: '.02em',
            color: BRAND.text2,
            marginTop: 22,
            opacity: tag,
            transform: `translateY(${(1 - tag) * 14}px)`,
          }}
        >
          {COPY.tagline}
        </div>
        <div style={{ width: 520 * line, height: 2, background: BRAND.gold, margin: '34px 0 30px', borderRadius: 2 }} />
        <div style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 46, color: BRAND.text1, opacity: line, transform: `translateY(${(1 - line) * 16}px)` }}>
          {COPY.closing}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 80–90s — trust, then the close. */
export const Trust: React.FC = () => (
  <ShotSequence
    overlap={16}
    beats={[
      { weight: 1.15, node: <Pillars /> },
      { weight: 1, enter: 'fade', node: <EndCard /> },
    ]}
  />
);
