import { VIDEO } from './config';

/**
 * The promo's running order, in seconds. This is the only place timing lives:
 * scenes receive their length as `durationInFrames` and lay their beats out
 * as fractions of it, so changing a number here (or VIDEO.fps) re-times the
 * whole video. Scenes overlap by TRANSITION seconds.
 */
export const TRANSITION = 0.7;

/**
 * `enter` is how a scene arrives: a fade where one side is mostly type on
 * parchment, a slide between two screen-filled scenes (a cross-fade of two
 * full dashboards double-exposes into mud).
 */
export const SCENES = [
  { id: 'intro', seconds: 8.3, enter: 'fade' },
  { id: 'platform', seconds: 10.7, enter: 'fade' },
  { id: 'roles', seconds: 21.2, enter: 'slide' },
  { id: 'day', seconds: 22.2, enter: 'slide' },
  { id: 'agent', seconds: 20.7, enter: 'slide' },
  { id: 'trust', seconds: 10.4, enter: 'fade' },
] as const;
export type SceneId = (typeof SCENES)[number]['id'];

export const sec = (s: number) => Math.round(s * VIDEO.fps);

export const TRANSITION_FRAMES = sec(TRANSITION);

export const sceneFrames = (id: SceneId) => sec(SCENES.find((s) => s.id === id)!.seconds);

/** Total length: scenes minus the overlap each transition takes. */
export const TOTAL_FRAMES =
  SCENES.reduce((n, s) => n + sec(s.seconds), 0) - TRANSITION_FRAMES * (SCENES.length - 1);

/** Where each scene starts on the master timeline — used by the voiceover script. */
export const sceneStarts = () => {
  let t = 0;
  return SCENES.map((s) => {
    const start = t;
    t += sec(s.seconds) - TRANSITION_FRAMES;
    return { id: s.id, startFrame: start, startSec: +(start / VIDEO.fps).toFixed(2) };
  });
};
