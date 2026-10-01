import React from 'react';
import { useBeatDuration, BeatDuration } from './duration';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';

/**
 * Lays several beats out across the parent's duration by weight, with a
 * transition between each. Beat lengths are derived, never hardcoded, so the
 * sequence always fills exactly the time the timeline gives it.
 */
export type Beat = { weight: number; node: React.ReactNode; enter?: 'fade' | 'slide-left' | 'slide-up' };

export const ShotSequence: React.FC<{ beats: Beat[]; overlap?: number }> = ({ beats, overlap = 14 }) => {
  const durationInFrames = useBeatDuration();
  const totalWeight = beats.reduce((n, b) => n + b.weight, 0);
  const available = durationInFrames + overlap * (beats.length - 1);
  const lengths = beats.map((b) => Math.round((b.weight / totalWeight) * available));
  // Rounding drift goes to the last beat so the sequence ends on the last frame.
  lengths[lengths.length - 1] += available - lengths.reduce((a, b) => a + b, 0);

  return (
    <TransitionSeries>
      {beats.map((b, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <TransitionSeries.Transition
              presentation={
                b.enter === 'slide-left'
                  ? slide({ direction: 'from-right' })
                  : b.enter === 'slide-up'
                    ? slide({ direction: 'from-bottom' })
                    : fade()
              }
              timing={linearTiming({ durationInFrames: overlap })}
            />
          )}
          <TransitionSeries.Sequence durationInFrames={lengths[i]}>
            <BeatDuration frames={lengths[i]}>{b.node}</BeatDuration>
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>
  );
};
