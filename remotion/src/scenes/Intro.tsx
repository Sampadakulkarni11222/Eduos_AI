import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { BRAND, COPY } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { LogoMark, Parchment } from '../components/Brand';
import { useBeatDuration } from '../components/duration';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** 0–8s — the mark draws itself, the name and tagline rise in. */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const at = (f: number) => f * D;
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

  // Starts visible on frame 0: an empty opening frame reads as a glitch,
  // and it is what a thumbnail or a scrubbed preview lands on.
  const plate = interpolate(frame, [0, at(0.12)], [0.35, 1], { ...clamp, easing: EASE });
  const draw = interpolate(frame, [at(0.04), at(0.24)], [0, 1], clamp);
  const lift = interpolate(frame, [at(0.28), at(0.42)], [0, 1], { ...clamp, easing: EASE });
  const word = interpolate(frame, [at(0.34), at(0.5)], [0, 1], { ...clamp, easing: EASE });
  const rule = interpolate(frame, [at(0.46), at(0.62)], [0, 1], { ...clamp, easing: EASE });
  const tag = interpolate(frame, [at(0.52), at(0.68)], [0, 1], { ...clamp, easing: EASE });
  // A real screen surfaces behind the type in the last beat, to hand over to the product.
  const hint = interpolate(frame, [at(0.7), at(1)], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ opacity: hint * 0.16, filter: 'blur(6px) saturate(.8)', transform: `scale(${1.12 - hint * 0.06})` }}>
        <Img src={staticFile('screenshots/principal-intelligence.png')} style={{ width: '100%', height: '100%' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `translateY(${-lift * 70}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              opacity: plate,
              transform: `scale(${0.82 + plate * 0.18 - lift * 0.28})`,
              filter: 'drop-shadow(0 22px 40px rgba(89,22,32,.28))',
            }}
          >
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
    </AbsoluteFill>
  );
};
