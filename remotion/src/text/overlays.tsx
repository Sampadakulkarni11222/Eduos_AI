import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { BRAND, ROLE_THEME, RoleKey } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { useBeatDuration } from '../components/duration';

/**
 * The text system for the text-led cut: short plates, role labels and a step
 * flow, all in the product's own two faces and palette. Nothing here is longer
 * than a phrase — the UI does the explaining, the type points at it.
 */
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Shared plate: warm, semi-opaque, sits over parchment rather than over UI. */
const plateStyle = (accent: string): React.CSSProperties => ({
  position: 'absolute',
  background: 'rgba(251,246,236,.95)',
  backdropFilter: 'blur(10px)',
  border: `1px solid ${BRAND.hairline}`,
  borderLeft: `4px solid ${accent}`,
  borderRadius: 16,
  padding: '20px 28px 22px',
  boxShadow: '0 24px 60px -24px rgba(58,34,41,.45)',
});

const Kicker: React.FC<{ children: React.ReactNode; t: number }> = ({ children, t }) => (
  <div
    style={{
      fontFamily: BODY,
      fontWeight: 800,
      fontSize: 17,
      letterSpacing: '.18em',
      textTransform: 'uppercase',
      color: BRAND.gold,
      marginBottom: 8,
      opacity: t,
    }}
  >
    {children}
  </div>
);

/** Small chips naming real modules — one or two words each. */
export const Pills: React.FC<{ items: string[]; t: number; accent: string }> = ({ items, t, accent }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
    {items.map((p, i) => {
      const it = interpolate(t, [i * 0.12, i * 0.12 + 0.45], [0, 1], clamp);
      return (
        <span
          key={p}
          style={{
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 19,
            color: accent,
            background: '#fff',
            border: `1px solid ${BRAND.cardBorder}`,
            borderRadius: 999,
            padding: '7px 16px',
            opacity: it,
            transform: `translateY(${(1 - it) * 10}px)`,
          }}
        >
          {p}
        </span>
      );
    })}
  </div>
);

/**
 * Two to six words, optionally over a kicker and under a row of module chips.
 * Anchored bottom-left by default: every shot in this cut keeps its subject
 * right of centre or high, so the corner stays free.
 */
export const TextPlate: React.FC<{
  kicker?: string;
  title: string;
  pills?: string[];
  accent?: string;
  from?: number;
  to?: number;
  corner?: 'bottom-left' | 'top-left' | 'bottom-right';
  width?: number;
  size?: number;
}> = ({ kicker, title, pills, accent = BRAND.maroon, from = 0.06, to = 0.97, corner = 'bottom-left', width, size = 56 }) => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const start = from * D;
  const end = to * D;
  const inT = interpolate(frame, [start, start + 15], [0, 1], { ...clamp, easing: EASE });
  const outT = interpolate(frame, [end - 10, end], [1, 0], clamp);
  const titleT = interpolate(frame, [start + 4, start + 24], [0, 1], { ...clamp, easing: EASE });
  const pillT = interpolate(frame, [start + 14, start + 44], [0, 1], clamp);

  const pos: React.CSSProperties =
    corner === 'top-left'
      ? { left: 76, top: 72 }
      : corner === 'bottom-right'
        ? { right: 76, bottom: 76 }
        : { left: 76, bottom: 76 };

  return (
    <div
      style={{
        ...plateStyle(accent),
        ...pos,
        maxWidth: width ?? 860,
        opacity: inT * outT,
        transform: `translateY(${(1 - inT) * 22}px)`,
      }}
    >
      {kicker && <Kicker t={titleT}>{kicker}</Kicker>}
      <div style={{ overflow: 'hidden' }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: size,
            lineHeight: 1.08,
            color: accent,
            transform: `translateY(${(1 - titleT) * 112}%)`,
          }}
        >
          {title}
        </div>
      </div>
      {pills && pills.length > 0 && <Pills items={pills} t={pillT} accent={BRAND.text2} />}
    </div>
  );
};

/** A portal's name in its own sidebar colour, with the modules it actually carries. */
export const RolePlate: React.FC<{ role: RoleKey; pills: string[]; kicker?: string }> = ({ role, pills, kicker }) => {
  const theme = ROLE_THEME[role];
  return (
    <TextPlate
      kicker={kicker ?? theme.portal}
      title={theme.label}
      pills={pills}
      accent={theme.accent}
      from={0.05}
      to={0.98}
      size={62}
    />
  );
};

/**
 * The four-step flow across the write sequence: the step the shot is on is
 * lit, the rest wait. Sits top-centre, clear of the assistant panel.
 */
export const FlowRow: React.FC<{ steps: string[]; active: number; accent?: string; from?: number }> = ({
  steps,
  active,
  accent = BRAND.maroon,
  from = 0.04,
}) => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const start = from * D;
  const t = interpolate(frame, [start, start + 16], [0, 1], { ...clamp, easing: EASE });
  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: `translateX(-50%) translateY(${(1 - t) * -16}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 18px',
        borderRadius: 999,
        background: 'rgba(251,246,236,.95)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${BRAND.hairline}`,
        boxShadow: '0 18px 44px -20px rgba(58,34,41,.4)',
        opacity: t,
      }}
    >
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <span style={{ color: BRAND.textFaint, fontFamily: BODY, fontSize: 20 }}>→</span>}
          <span
            style={{
              fontFamily: BODY,
              fontWeight: i === active ? 800 : 600,
              fontSize: 22,
              padding: '6px 16px',
              borderRadius: 999,
              background: i === active ? accent : 'transparent',
              color: i === active ? '#FBF6EC' : i < active ? BRAND.text2 : BRAND.textFaint,
            }}
          >
            {s}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};

/** Stacked keywords, centred — used where the screen behind is deliberately quiet. */
export const KeywordStack: React.FC<{ lines: string[]; accent?: string; from?: number; size?: number }> = ({
  lines,
  accent = BRAND.maroon,
  from = 0.05,
  size = 78,
}) => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const start = from * D;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      {lines.map((l, i) => {
        const t = interpolate(frame, [start + i * 9, start + i * 9 + 20], [0, 1], { ...clamp, easing: EASE });
        return (
          <div key={l} style={{ overflow: 'hidden', padding: '2px 0' }}>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: size,
                lineHeight: 1.1,
                color: accent,
                transform: `translateY(${(1 - t) * 112}%)`,
              }}
            >
              {l}
            </div>
          </div>
        );
      })}
    </div>
  );
};
