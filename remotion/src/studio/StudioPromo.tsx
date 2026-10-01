import React from 'react';
import { AbsoluteFill, Audio, getStaticFiles, interpolate, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { BRAND } from '../config';
import { BeatDuration } from '../components/duration';
import { SCENES, SceneId, TOTAL_FRAMES, TRANSITION_FRAMES, sec } from './timeline';
import { BridgeScene, CloseScene, IntroScene } from './Bookends';
import { DashboardScene } from './DashboardScene';
import { FeaturesScene } from './FeaturesScene';
import { RolesScene } from './RolesScene';
import { AiScene } from './AiScene';

/**
 * The designed cut: EduOS redrawn in code. No capture is displayed anywhere in
 * this composition — the screenshots served only as reference for structure,
 * module names and hierarchy.
 *
 * Its own narration file, so the two capture-based cuts keep theirs.
 */
const AUDIO = { voiceover: 'audio/voiceover-studio.mp3', music: 'audio/music.mp3' };
const hasFile = (name: string) => getStaticFiles().some((f) => f.name === name);

const Soundtrack: React.FC = () => {
  const withVoice = hasFile(AUDIO.voiceover);
  return (
    <>
      {withVoice && <Audio src={staticFile(AUDIO.voiceover)} />}
      {hasFile(AUDIO.music) && (
        <Audio
          src={staticFile(AUDIO.music)}
          volume={(f) =>
            interpolate(f, [0, 30, TOTAL_FRAMES - 60, TOTAL_FRAMES], [0, withVoice ? 0.18 : 0.5, withVoice ? 0.18 : 0.5, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
          }
        />
      )}
    </>
  );
};

const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  intro: IntroScene,
  dashboard: DashboardScene,
  bridge: BridgeScene,
  features: FeaturesScene,
  roles: RolesScene,
  ai: AiScene,
  close: CloseScene,
};

export const StudioPromo: React.FC = () => (
  <AbsoluteFill style={{ background: BRAND.parchment }}>
    <Soundtrack />
    <TransitionSeries>
      {SCENES.map((s, i) => {
        const Scene = SCENE_COMPONENTS[s.id];
        const frames = sec(s.seconds);
        return (
          <React.Fragment key={s.id}>
            {i > 0 && (
              <TransitionSeries.Transition
                presentation={s.enter === 'slide' ? slide({ direction: 'from-right' }) : fade()}
                timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
              />
            )}
            <TransitionSeries.Sequence durationInFrames={frames} name={s.id}>
              <BeatDuration frames={frames}>
                <Scene />
              </BeatDuration>
            </TransitionSeries.Sequence>
          </React.Fragment>
        );
      })}
    </TransitionSeries>
  </AbsoluteFill>
);
