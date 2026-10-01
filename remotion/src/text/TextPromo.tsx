import React from 'react';
import { AbsoluteFill, Audio, getStaticFiles, interpolate, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { BRAND } from '../config';
import { SCENES, SceneId, TOTAL_FRAMES, TRANSITION_FRAMES, sec } from '../timeline';
import { BeatDuration } from '../components/duration';
import { IntroText } from './IntroText';
import { PlatformText } from './PlatformText';
import { RolesText } from './RolesText';
import { DayText } from './DayText';
import { AgentText } from './AgentText';
import { TrustText } from './TrustText';

/**
 * The text-led cut: same 90 s, same real captures, same scene timings as
 * EduOSPromo — but the story is carried by short on-screen text, and the
 * voice only speaks five times. It reads with the sound off.
 *
 * It has its own narration file so the narrated cut keeps its own; music is
 * shared and ducks under either.
 */
const AUDIO = {
  voiceover: 'audio/voiceover-minimal.mp3',
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

const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  intro: IntroText,
  platform: PlatformText,
  roles: RolesText,
  day: DayText,
  agent: AgentText,
  trust: TrustText,
};

export const TextPromo: React.FC = () => (
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
