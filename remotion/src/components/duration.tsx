import React, { createContext, useContext } from 'react';
import { useVideoConfig } from 'remotion';

/**
 * The length of the beat a component is rendered in. Set explicitly by the
 * sequencers rather than inferred, so every fraction-based animation (camera
 * keys, caption in/out) measures against the beat it actually lives in.
 */
const Ctx = createContext<number | null>(null);

export const BeatDuration: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => (
  <Ctx.Provider value={frames}>{children}</Ctx.Provider>
);

export function useBeatDuration(): number {
  const own = useContext(Ctx);
  const { durationInFrames } = useVideoConfig();
  return own ?? durationInFrames;
}
