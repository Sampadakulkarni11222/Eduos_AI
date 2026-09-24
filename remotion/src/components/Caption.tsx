import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { useBeatDuration } from './duration';
import { BRAND } from '../config';
import { BODY, DISPLAY } from '../fonts';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Lower-third caption: a small gold eyebrow over a Newsreader line, on a
 * warm panel. Enters with a masked rise, leaves with a fade. `from`/`to` are
 * fractions of the parent sequence, so captions re-time with the timeline.
 */
export const Caption: React.FC<{
  eyebrow?: string;
  title: string;
  sub?: string;
  from?: number;
  to?: number;
  position?: 'bottom-left' | 'bottom-center' | 'top-left';
  accent?: string;
  width?: number;
}> = ({ eyebrow, title, sub, from = 0.06, to = 0.94, position = 'bottom-left', accent = BRAND.maroon, width }) => {
  const frame = useCurrentFrame();
  const durationInFrames = useBeatDuration();
  const start = from * durationInFrames;
  const end = to * durationInFrames;
  const inT = interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE });
  const outT = interpolate(frame, [end - 12, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleT = interpolate(frame, [start + 5, start + 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE });

  const pos: React.CSSProperties =
    position === 'bottom-center'
      ? { left: '50%', bottom: 64, transform: `translateX(-50%) translateY(${(1 - inT) * 24}px)` }
      : position === 'top-left'
        ? { left: 72, top: 64, transform: `translateY(${(1 - inT) * -18}px)` }
        : { left: 72, bottom: 64, transform: `translateY(${(1 - inT) * 24}px)` };

  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        opacity: inT * outT,
        maxWidth: width ?? 980,
        background: 'rgba(251,246,236,.94)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${BRAND.hairline}`,
        borderRadius: 18,
        padding: '22px 30px 24px',
        boxShadow: '0 24px 60px -24px rgba(58,34,41,.45)',
        textAlign: position === 'bottom-center' ? 'center' : 'left',
      }}
    >
      {eyebrow && (
        <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 17, letterSpacing: '.16em', textTransform: 'uppercase', color: BRAND.gold, marginBottom: 8 }}>
          {eyebrow}
        </div>
      )}
      <div style={{ overflow: 'hidden' }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 50,
            lineHeight: 1.08,
            color: accent,
            transform: `translateY(${(1 - titleT) * 100}%)`,
          }}
        >
          {title}
        </div>
      </div>
      {sub && (
        <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: 23, color: BRAND.text2, marginTop: 10, opacity: titleT }}>
          {sub}
        </div>
      )}
    </div>
  );
};
