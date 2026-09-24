import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { BRAND, COPY } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { LogoMark, Parchment } from '../components/Brand';
import { useBeatDuration } from '../components/duration';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * 0–7.6s — the mark draws, the name and tagline rise, and the opening claim
 * lands as two keywords before the product appears. Same choreography as the
 * narrated cut up to 60%; from there the type hands over to the two lines
 * the rest of the video proves.
 */
export const IntroText: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const at = (f: number) => f * D;
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

  const plate = interpolate(frame, [0, at(0.12)], [0.35, 1], { ...clamp, easing: EASE });
  const draw = interpolate(frame, [at(0.04), at(0.24)], [0, 1], clamp);
  const lift = interpolate(frame, [at(0.28), at(0.42)], [0, 1], { ...clamp, easing: EASE });
  const word = interpolate(frame, [at(0.34), at(0.5)], [0, 1], { ...clamp, easing: EASE });
  const rule = interpolate(frame, [at(0.46), at(0.62)], [0, 1], { ...clamp, easing: EASE });
  const tag = interpolate(frame, [at(0.52), at(0.68)], [0, 1], { ...clamp, easing: EASE });
  // The lock-up steps back and the two keywords take the frame.
  const hand = interpolate(frame, [at(0.66), at(0.78)], [0, 1], { ...clamp, easing: EASE });
  const key1 = interpolate(frame, [at(0.78), at(0.88)], [0, 1], { ...clamp, easing: EASE });
  const key2 = interpolate(frame, [at(0.84), at(0.94)], [0, 1], { ...clamp, easing: EASE });
  const hint = interpolate(frame, [at(0.7), at(1)], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ opacity: hint * 0.14, filter: 'blur(7px) saturate(.8)', transform: `scale(${1.12 - hint * 0.06})` }}>
        <Img src={staticFile('screenshots/principal-intelligence.png')} style={{ width: '100%', height: '100%' }} />
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 1 - hand, transform: `scale(${1 - hand * 0.06})` }}>
        <div style={{ transform: `translateY(${-lift * 70}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ opacity: plate, transform: `scale(${0.82 + plate * 0.18 - lift * 0.28})`, filter: 'drop-shadow(0 22px 40px rgba(89,22,32,.28))' }}>
            <LogoMark size={190} draw={draw} />
          </div>
        </div>
        <div style={{ position: 'absolute', top: '50%', marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: 150,
                lineHeight: 1,
                letterSpacing: '-.01em',
                color: BRAND.maroon,
                transform: `translateY(${(1 - word) * 112}%)`,
              }}
            >
              {COPY.product}
            </div>
          </div>
          <div style={{ width: 360 * rule, height: 2, background: BRAND.gold, margin: '26px 0 24px', borderRadius: 2 }} />
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 38,
              letterSpacing: '.02em',
              color: BRAND.text2,
              opacity: tag,
              transform: `translateY(${(1 - tag) * 18}px)`,
            }}
          >
            {COPY.tagline}
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
        {[
          { text: 'One platform.', t: key1, color: BRAND.maroon },
          { text: 'Every school role.', t: key2, color: BRAND.gold },
        ].map((l) => (
          <div key={l.text} style={{ overflow: 'hidden', paddingBottom: 4 }}>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: 86,
                lineHeight: 1.08,
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
