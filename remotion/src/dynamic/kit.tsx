import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming, type TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { pushCut } from '@remotion/transitions/push-cut';
import { none } from '@remotion/transitions/none';
import { BRAND, VIDEO } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { BeatDuration, useBeatDuration } from '../components/duration';

/**
 * The dynamic cut's kit. Two ideas:
 *
 * 1. Beats are laid out in SECONDS, not weights. A beat's `s` is the time from
 *    its start to the next beat's start, so the running order reads like a
 *    cue sheet and every beat lands on the timecode the plan gives it. The
 *    transition into the next beat is added on top of `s` (the overlap), so
 *    a sequence of beats always lasts exactly the sum of their `s`.
 * 2. Type is snappy: it rises in over a third of a second and leaves with the
 *    beat, because most beats here are one to two seconds long.
 */
export const EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const fps = VIDEO.fps;
/**
 * Global tempo. Every beat, animation and transition is written in "cue
 * seconds" and stretched by PACE on its way to frames, so the whole cut slows
 * down (or speeds up) in step. 1 = the original 90 s cue sheet.
 */
export const PACE = 1.4;
export const f = (seconds: number) => Math.round(seconds * PACE * fps);
/** Frames → cue seconds (the inverse of `f`, unrounded). */
export const sec = (frames: number) => frames / (PACE * fps);

export type Enter = 'cut' | 'fade' | 'slide' | 'slide-up' | 'wipe' | 'push';
export type Beat = { s: number; node: React.ReactNode; enter?: Enter; t?: number; name?: string };

const presentation = (e: Enter): TransitionPresentation<any> => {
  switch (e) {
    case 'slide':
      return slide({ direction: 'from-right' });
    case 'slide-up':
      return slide({ direction: 'from-bottom' });
    case 'wipe':
      return wipe({ direction: 'from-right' });
    case 'push':
      return pushCut({ flashColor: '#FBF6EC', flashOpacity: 0.28, incomingStartScale: 1.05, incomingEndScale: 1 });
    case 'cut':
      return none();
    default:
      return fade();
  }
};

/** Default overlap per transition, in frames: pushes and cuts are quick, fades and wipes breathe. */
const DEFAULT_T: Record<Enter, number> = { cut: 1, push: 10, slide: 12, 'slide-up': 12, wipe: 14, fade: 12 };

export const Beats: React.FC<{ beats: Beat[] }> = ({ beats }) => {
  // Starts are rounded cumulatively so rounding never drifts across a section.
  const starts: number[] = [];
  let acc = 0;
  for (const b of beats) {
    starts.push(f(acc));
    acc += b.s;
  }
  // When this sequence is itself a beat, its parent gives it a few extra frames
  // for the transition out; the last beat stretches over them so the outgoing
  // side of that transition is never blank.
  const end = Math.max(f(acc), useBeatDuration());
  return (
    <TransitionSeries>
      {beats.map((b, i) => {
        const next = beats[i + 1];
        const nextT = next ? Math.round((next.t ?? DEFAULT_T[next.enter ?? 'fade']) * PACE) : 0;
        const len = (i + 1 < beats.length ? starts[i + 1] : end) - starts[i] + nextT;
        const ownT = Math.round((b.t ?? DEFAULT_T[b.enter ?? 'fade']) * PACE);
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <TransitionSeries.Transition
                presentation={presentation(b.enter ?? 'fade')}
                timing={linearTiming({ durationInFrames: ownT })}
              />
            )}
            <TransitionSeries.Sequence durationInFrames={len} name={b.name}>
              <BeatDuration frames={len}>{b.node}</BeatDuration>
            </TransitionSeries.Sequence>
          </React.Fragment>
        );
      })}
    </TransitionSeries>
  );
};

export const beatsLength = (beats: Beat[]) => beats.reduce((n, b) => n + b.s, 0);

/** Frame → progress helpers for a component living inside one beat. */
export const useT = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  /** 0→1 from `a` to `b` seconds into the beat, eased. */
  const at = (a: number, b: number, easing = true) =>
    interpolate(frame, [f(a), Math.max(f(a) + 1, f(b))], [0, 1], easing ? { ...clamp, easing: EASE } : clamp);
  return { frame, D, at };
};

/** A mask-rise line of display type. */
export const Rise: React.FC<{ t: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ t, children, style }) => (
  <div style={{ overflow: 'hidden', paddingBottom: 6 }}>
    <div style={{ transform: `translateY(${(1 - t) * 112}%)`, ...style }}>{children}</div>
  </div>
);

export const Kicker: React.FC<{ children: React.ReactNode; color?: string; t?: number; style?: React.CSSProperties }> = ({
  children,
  color = BRAND.gold,
  t = 1,
  style,
}) => (
  <div
    style={{
      fontFamily: BODY,
      fontWeight: 800,
      fontSize: 18,
      letterSpacing: '.2em',
      textTransform: 'uppercase',
      color,
      opacity: t,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * The beat label: a short line on a warm glass plate, with an optional kicker.
 * Enters in ~0.35 s after `delay`; it leaves with the beat's own transition.
 */
export const Tag: React.FC<{
  title: string;
  kicker?: string;
  accent?: string;
  delay?: number;
  corner?: 'bottom-left' | 'top-left' | 'bottom-right' | 'top-right';
  size?: number;
  width?: number;
  pills?: string[];
}> = ({ title, kicker, accent = BRAND.maroon, delay = 0.12, corner = 'bottom-left', size = 64, width, pills }) => {
  const { at } = useT();
  const t = at(delay, delay + 0.35);
  const k = at(delay + 0.08, delay + 0.4);
  const pos: React.CSSProperties = {
    'bottom-left': { left: 76, bottom: 76 },
    'top-left': { left: 76, top: 70 },
    'bottom-right': { right: 76, bottom: 76 },
    'top-right': { right: 76, top: 70 },
  }[corner];
  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        maxWidth: width ?? 900,
        background: 'rgba(251,246,236,.95)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${BRAND.hairline}`,
        borderLeft: `5px solid ${accent}`,
        borderRadius: 16,
        padding: '18px 30px 20px',
        boxShadow: '0 24px 60px -24px rgba(58,34,41,.5)',
        opacity: Math.min(1, t * 1.6),
        transform: `translateY(${(1 - t) * 18}px)`,
      }}
    >
      {kicker && <Kicker t={k} style={{ marginBottom: 6 }}>{kicker}</Kicker>}
      <Rise t={t} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: size, lineHeight: 1.06, color: accent }}>
        {title}
      </Rise>
      {pills && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          {pills.map((p, i) => {
            const pt = at(delay + 0.3 + i * 0.12, delay + 0.6 + i * 0.12);
            return (
              <span
                key={p}
                style={{
                  fontFamily: BODY,
                  fontWeight: 700,
                  fontSize: 20,
                  color: BRAND.text2,
                  background: '#fff',
                  border: `1px solid ${BRAND.cardBorder}`,
                  borderRadius: 999,
                  padding: '6px 16px',
                  opacity: pt,
                  transform: `translateY(${(1 - pt) * 10}px)`,
                }}
              >
                {p}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** A region of a real capture in a floating card (viewport coordinates). */
export const Card: React.FC<{
  src: string;
  rect: [number, number, number, number];
  width: number;
  style?: React.CSSProperties;
  radius?: number;
  children?: React.ReactNode;
}> = ({ src, rect, width, style, radius = 16, children }) => {
  const [x, y, w, h] = rect;
  const s = width / w;
  return (
    <div
      style={{
        width,
        height: h * s,
        overflow: 'hidden',
        position: 'relative',
        borderRadius: radius,
        background: '#fff',
        boxShadow: '0 34px 80px -30px rgba(58,34,41,.55), 0 10px 24px -12px rgba(58,34,41,.25)',
        outline: `1px solid ${BRAND.hairline}`,
        ...style,
      }}
    >
      <Img
        src={staticFile(`screenshots/${src}`)}
        style={{ position: 'absolute', left: -x * s, top: -y * s, width: VIDEO.width * s, height: VIDEO.height * s }}
      />
      {children}
    </div>
  );
};

/** A gold ring inside a Card, in the card's own viewport coordinates. */
export const CardRing: React.FC<{ rect: [number, number, number, number]; crop: [number, number, number, number]; width: number; t: number }> = ({
  rect,
  crop,
  width,
  t,
}) => {
  const s = width / crop[2];
  const pad = 6 + (1 - t) * 10;
  return (
    <div
      style={{
        position: 'absolute',
        left: (rect[0] - crop[0]) * s - pad,
        top: (rect[1] - crop[1]) * s - pad,
        width: rect[2] * s + pad * 2,
        height: rect[3] * s + pad * 2,
        borderRadius: 12 + pad,
        border: `3px solid ${BRAND.gold}`,
        boxShadow: '0 0 0 6px rgba(201,162,63,.18), 0 0 28px rgba(201,162,63,.35)',
        opacity: t,
      }}
    />
  );
};

/** Numbered step rail — the step the shot is on is lit, the ones before it are done. */
export const StepRail: React.FC<{ steps: string[]; active: number; accent?: string; top?: number; enterT?: number }> = ({
  steps,
  active,
  accent = BRAND.maroon,
  top = 56,
  enterT = 1,
}) => (
  <div
    style={{
      position: 'absolute',
      top,
      left: '50%',
      transform: `translateX(-50%) translateY(${(1 - enterT) * -16}px)`,
      opacity: enterT,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 14px',
      borderRadius: 999,
      background: 'rgba(251,246,236,.96)',
      backdropFilter: 'blur(10px)',
      border: `1px solid ${BRAND.hairline}`,
      boxShadow: '0 18px 44px -20px rgba(58,34,41,.45)',
      zIndex: 5,
    }}
  >
    {steps.map((s, i) => (
      <React.Fragment key={s}>
        {i > 0 && <span style={{ color: i <= active ? accent : BRAND.textFaint, fontFamily: BODY, fontSize: 20, fontWeight: 700 }}>→</span>}
        <span
          style={{
            fontFamily: BODY,
            fontWeight: i === active ? 800 : 600,
            fontSize: 23,
            padding: '7px 18px',
            borderRadius: 999,
            background: i === active ? accent : 'transparent',
            color: i === active ? '#FBF6EC' : i < active ? BRAND.text1 : BRAND.textFaint,
          }}
        >
          {i < active ? '✓ ' : ''}
          {s}
        </span>
      </React.Fragment>
    ))}
  </div>
);

/** A soft vignette so type over the parchment edge reads cleanly. */
export const Scrim: React.FC<{ side: 'left' | 'right' | 'bottom'; strength?: number }> = ({ side, strength = 0.9 }) => {
  const dir = side === 'left' ? '90deg' : side === 'right' ? '270deg' : '0deg';
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${dir}, rgba(239,232,216,${strength}) 0%, rgba(239,232,216,${strength * 0.85}) 30%, rgba(239,232,216,0) 58%)`,
      }}
    />
  );
};

export const useFps = () => useVideoConfig().fps;
