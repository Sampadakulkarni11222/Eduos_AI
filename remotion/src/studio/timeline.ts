import { VIDEO } from '../config';

/**
 * The designed cut's running order. Its own structure — dashboard first, then
 * features, roles, the assistant and the close — so it does not share the
 * captured cut's timeline. Still 90.00 s at 30 fps.
 */
export const TRANSITION = 0.6;

export const SCENES = [
  { id: 'intro', seconds: 8.0, enter: 'fade' },
  { id: 'dashboard', seconds: 20.5, enter: 'fade' },
  { id: 'bridge', seconds: 4.5, enter: 'fade' },
  { id: 'features', seconds: 20.5, enter: 'slide' },
  { id: 'roles', seconds: 18.0, enter: 'slide' },
  { id: 'ai', seconds: 14.5, enter: 'fade' },
  { id: 'close', seconds: 7.6, enter: 'fade' },
] as const;
export type SceneId = (typeof SCENES)[number]['id'];

export const sec = (s: number) => Math.round(s * VIDEO.fps);
export const TRANSITION_FRAMES = sec(TRANSITION);

export const TOTAL_FRAMES =
  SCENES.reduce((n, s) => n + sec(s.seconds), 0) - TRANSITION_FRAMES * (SCENES.length - 1);

/** Where each scene starts on the master timeline — the narration is cut to these. */
export const sceneStarts = () => {
  let t = 0;
  return SCENES.map((s) => {
    const start = t;
    t += sec(s.seconds) - TRANSITION_FRAMES;
    return { id: s.id, startSec: +(start / VIDEO.fps).toFixed(2) };
  });
};
