import React from 'react';
import { AbsoluteFill, Audio, getStaticFiles, interpolate, staticFile } from 'remotion';
import { BRAND } from '../config';
import { BeatDuration } from '../components/duration';
import { Beat, Beats, f, fps } from './kit';
import { FinaleSection, IntroSection, TrustSection } from './bookends';
import { AcademicsSection, FeaturesSection, InsightsSection, OperationsSection, PlatformSection, RolesSection } from './sections';
import { AgentSection, HindiSection } from './agent';

/**
 * EduOSPromoDynamic — the pacing pass. Same real captures as the text-led cut
 * (plus eleven supplementary ones, manifest.extra.json), re-cut so a new
 * screen, label or highlight arrives every one to two seconds. Nothing is
 * sped up: the extra rhythm comes from extra content.
 *
 * Section lengths are the running order's timecodes; each section starts
 * exactly where the previous one's seconds end (the transition overlaps into
 * the outgoing section, never delaying the incoming one).
 */
export const SECTIONS: { id: string; s: number; enter?: Beat['enter']; node: React.ReactNode }[] = [
  { id: 'intro', s: 7.0, node: <IntroSection /> }, //            0.0
  { id: 'platform', s: 10.0, enter: 'push', node: <PlatformSection /> }, // 7.0
  { id: 'features', s: 13.0, enter: 'slide', node: <FeaturesSection /> }, // 17.0
  { id: 'roles', s: 13.0, enter: 'wipe', node: <RolesSection /> }, //  30.0
  { id: 'academics', s: 9.0, enter: 'slide', node: <AcademicsSection /> }, // 43.0
  { id: 'operations', s: 8.0, enter: 'slide', node: <OperationsSection /> }, // 52.0
  { id: 'insights', s: 6.0, enter: 'push', node: <InsightsSection /> }, // 60.0
  { id: 'hindi', s: 3.0, enter: 'fade', node: <HindiSection /> }, //   66.0
  { id: 'agent', s: 13.0, enter: 'push', node: <AgentSection /> }, //  69.0
  { id: 'trust', s: 4.6, enter: 'fade', node: <TrustSection /> }, //   82.0
  { id: 'finale', s: 3.4, enter: 'push', node: <FinaleSection /> }, // 86.6 → 90.0
];

export const DYNAMIC_FRAMES = f(SECTIONS.reduce((n, s) => n + s.s, 0));

const AUDIO = { voiceover: 'audio/voiceover-dynamic.mp3', music: 'audio/music.mp3' };
const hasFile = (name: string) => getStaticFiles().some((f) => f.name === name);

// Where voiceover-dynamic.mp3 actually speaks, in seconds (silencedetect,
// -40 dB). Re-measure if the voiceover is regenerated.
const SPEECH: [number, number][] = [
  [0.5, 3.75],
  [10.25, 14.68],
  [97.05, 101.08],
  [111.47, 113.62],
  [120.29, 123.56],
];
// music.mp3 (scripts/make-music.py) drives the gaps and sits ~11 dB under the voice
const MUSIC = { full: 0.6, ducked: 0.2, attack: 0.25, release: 0.5 };

const musicVolume = (fr: number, withVoice: boolean) => {
  const t = fr / fps;
  const edges = interpolate(fr, [0, 15, DYNAMIC_FRAMES - 45, DYNAMIC_FRAMES], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (!withVoice) return MUSIC.full * edges;
  // 0 = fully ducked, 1 = full: the nearest speech window decides
  const open = Math.min(
    1,
    ...SPEECH.map(([a, b]) =>
      t < a ? Math.min(1, (a - t) / MUSIC.attack) : t > b ? Math.min(1, (t - b) / MUSIC.release) : 0,
    ),
  );
  return (MUSIC.ducked + (MUSIC.full - MUSIC.ducked) * open) * edges;
};

const Soundtrack: React.FC = () => {
  const withVoice = hasFile(AUDIO.voiceover);
  return (
    <>
      {withVoice && <Audio src={staticFile(AUDIO.voiceover)} />}
      {hasFile(AUDIO.music) && <Audio src={staticFile(AUDIO.music)} volume={(fr) => musicVolume(fr, withVoice)} />}
    </>
  );
};

export const DynamicPromo: React.FC = () => (
  <AbsoluteFill style={{ background: BRAND.parchment }}>
    <Soundtrack />
    <BeatDuration frames={DYNAMIC_FRAMES}>
      <Beats beats={SECTIONS.map((s) => ({ s: s.s, enter: s.enter, node: s.node, name: s.id }))} />
    </BeatDuration>
  </AbsoluteFill>
);
