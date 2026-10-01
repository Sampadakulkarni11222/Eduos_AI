import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { BRAND } from '../config';


/**
 * The EduOS mark — the same geometry as frontend/src/app/icon.svg (cream-to-tan
 * plate, maroon "E" built from rectangles), redrawn at any size.
 */
export const LogoMark: React.FC<{ size: number; draw?: number }> = ({ size, draw = 1 }) => {
  const arm = (w: number, p: number) => w * Math.min(1, Math.max(0, p));
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="EduOS AI">
      <defs>
        <linearGradient id="eduos-brand" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor={BRAND.cream1} />
          <stop offset="1" stopColor={BRAND.cream2} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#eduos-brand)" />
      <g fill={BRAND.maroon}>
        <rect x="10.4" y="8" width="3.6" height={16 * Math.min(1, draw * 1.6)} rx="1" />
        <rect x="10.4" y="8" width={arm(11.2, draw * 2 - 0.4)} height="3.4" rx="1" />
        <rect x="10.4" y="14.4" width={arm(8.6, draw * 2 - 0.7)} height="3.1" rx="1" />
        <rect x="10.4" y="20.6" width={arm(11.2, draw * 2 - 1)} height="3.4" rx="1" />
      </g>
    </svg>
  );
};

/** The warm backdrop the sign-in screen uses: parchment with soft light pools. */
export const Parchment: React.FC<{ drift?: boolean }> = ({ drift = true }) => {
  const frame = useCurrentFrame();
  const d = drift ? frame * 0.15 : 0;
  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(900px 600px at ${18 + d * 0.02}% ${82 - d * 0.01}%, rgba(216,185,138,.35), transparent 70%),
          radial-gradient(800px 520px at ${88 - d * 0.02}% ${12 + d * 0.01}%, rgba(201,162,63,.16), transparent 70%),
          linear-gradient(160deg, #F5EFE2 0%, ${BRAND.parchment} 55%, #E6DCC6 100%)`,
      }}
    />
  );
};

