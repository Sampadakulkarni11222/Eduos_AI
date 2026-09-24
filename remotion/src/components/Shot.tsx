import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { useBeatDuration } from './duration';
import { BRAND, VIDEO } from '../config';

/**
 * A real EduOS capture, shot with a virtual camera.
 *
 * Coordinates are in the app's own 1920×1080 viewport space (the captures are
 * 2× — 3840×2160 — so zooming stays sharp). A camera key says "centre the
 * frame on (x, y) at zoom z" at a point `at` (0…1) through the shot; between
 * keys the camera eases. z = 1 shows the whole screen inside a card.
 */
export type CameraKey = { at: number; x: number; y: number; z: number };

export type Highlight = {
  /** Region in viewport coordinates. */
  rect: [x: number, y: number, w: number, h: number];
  from: number;
  to?: number;
  radius?: number;
};

const EASE = Easing.bezier(0.65, 0, 0.35, 1);

function cameraAt(keys: CameraKey[], p: number): { x: number; y: number; z: number } {
  if (p <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (p <= b.at) {
      const t = EASE((p - a.at) / Math.max(1e-6, b.at - a.at));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return keys[keys.length - 1];
}

export const FULL: CameraKey[] = [
  { at: 0, x: 960, y: 540, z: 1 },
  { at: 1, x: 960, y: 540, z: 1.04 },
];

/** Card inset when the screen is shown whole, so the parchment frames it. */
const INSET = 0.88;

export const Shot: React.FC<{
  src: string;
  camera?: CameraKey[];
  highlights?: Highlight[];
  /** Hides a strip of the capture (e.g. a dev-only localhost URL). */
  masks?: { rect: [number, number, number, number]; color: string }[];
}> = ({ src, camera = FULL, highlights = [], masks = [] }) => {
  const frame = useCurrentFrame();
  const durationInFrames = useBeatDuration();
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  const W = VIDEO.width;
  const H = VIDEO.height;
  const raw = cameraAt(camera, p);
  const scale = raw.z * INSET;
  // Once zoomed past the card inset, keep the screen filling the frame: the
  // camera may not travel so far that parchment shows beside the capture.
  // Below that, the range collapses to the centre, so the card stays framed.
  const hw = W / 2 / scale;
  const hh = H / 2 / scale;
  const clampTo = (v: number, half: number, size: number) =>
    half >= size / 2 ? size / 2 : Math.min(size - half, Math.max(half, v));
  const cam = { x: clampTo(raw.x, hw, W), y: clampTo(raw.y, hh, H), z: raw.z };

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: W,
          height: H,
          transformOrigin: '0 0',
          transform: `translate(${W / 2}px, ${H / 2}px) scale(${scale}) translate(${-cam.x}px, ${-cam.y}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 40px 90px -30px rgba(58,34,41,.45), 0 12px 30px -12px rgba(58,34,41,.25)',
            outline: `1px solid ${BRAND.hairline}`,
            background: BRAND.parchment,
          }}
        >
          <Img src={staticFile(`screenshots/${src}`)} style={{ width: W, height: H, display: 'block' }} />
          {masks.map((m, i) => (
            <div key={i} style={{ position: 'absolute', left: m.rect[0], top: m.rect[1], width: m.rect[2], height: m.rect[3], background: m.color }} />
          ))}
        </div>
        {highlights.map((h, i) => (
          <HighlightRing key={i} h={h} p={p} zoom={scale} total={durationInFrames} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const HighlightRing: React.FC<{ h: Highlight; p: number; zoom: number; total: number }> = ({ h, p, zoom, total }) => {
  const fadeLen = 10 / total;
  const to = h.to ?? 1.01;
  const opacity = interpolate(p, [h.from, h.from + fadeLen, to - fadeLen, to], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const grow = interpolate(p, [h.from, h.from + fadeLen * 1.6], [10, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const [x, y, w, hh] = h.rect;
  // Stroke drawn in screen pixels, not viewport pixels, so it reads the same at any zoom.
  const stroke = 3 / zoom;
  const pad = (6 + grow) / zoom;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - pad,
        top: y - pad,
        width: w + pad * 2,
        height: hh + pad * 2,
        borderRadius: (h.radius ?? 12) + pad,
        border: `${stroke}px solid ${BRAND.gold}`,
        boxShadow: `0 0 0 ${6 / zoom}px rgba(201,162,63,.18), 0 0 ${28 / zoom}px rgba(201,162,63,.35)`,
        opacity,
      }}
    />
  );
};
