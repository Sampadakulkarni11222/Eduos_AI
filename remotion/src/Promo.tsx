import React from 'react';
import { AbsoluteFill, Audio, getStaticFiles, interpolate, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { BRAND } from './config';
import { SCENES, SceneId, TOTAL_FRAMES, TRANSITION_FRAMES, sec } from './timeline';
import { BeatDuration } from './components/duration';
import { Intro } from './scenes/Intro';
import { Platform } from './scenes/Platform';
import { Roles } from './scenes/Roles';
import { Day } from './scenes/Day';
import { Agent } from './scenes/Agent';
import { Trust } from './scenes/Trust';

const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  intro: Intro,
  platform: Platform,
  roles: Roles,
  day: Day,
  agent: Agent,
  trust: Trust,
};

/**
 * Optional audio. Drop files into assets/audio and they are mixed in; with
 * none, the video stands on its captions alone. Music ducks under the voice.
 */
const AUDIO = {
  voiceover: 'audio/voiceover.mp3',
  music: 'audio/music.mp3',
};
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

/** The master timeline: scenes from timeline.ts, joined by each scene's `enter` transition. */
export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: BRAND.parchment }}>
    <Soundtrack />
    <TransitionSeries>
      {SCENES.map((s, i) => {
        const Scene = SCENE_COMPONENTS[s.id];
        const frames = sec(s.seconds);
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <TransitionSeries.Transition presentation={s.enter === 'slide' ? slide({ direction: 'from-right' }) : fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />}
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
