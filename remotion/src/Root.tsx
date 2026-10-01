import React from 'react';
import { Composition } from 'remotion';
import { VIDEO } from './config';
import { TOTAL_FRAMES } from './timeline';
import { Promo } from './Promo';
import { TextPromo } from './text/TextPromo';
import { StudioPromo } from './studio/StudioPromo';
import { TOTAL_FRAMES as STUDIO_FRAMES } from './studio/timeline';
import { DynamicPromo, DYNAMIC_FRAMES } from './dynamic/DynamicPromo';
import './fonts';

/**
 * Two cuts of the same 90 seconds, from the same captures and timeline:
 * - EduOSPromo      the narrated cut (assets/audio/voiceover.mp3)
 * - EduOSPromoText  the text-led cut, minimal voice (voiceover-minimal.mp3)
 * - EduOSPromoStudio the designed cut: EduOS redrawn in code, no captures
 * - EduOSPromoDynamic the pacing pass: real captures, a new beat every 1–2 s
 */
export const Root: React.FC = () => (
  <>
    <Composition
      id="EduOSPromo"
      component={Promo}
      durationInFrames={TOTAL_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="EduOSPromoStudio"
      component={StudioPromo}
      durationInFrames={STUDIO_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="EduOSPromoDynamic"
      component={DynamicPromo}
      durationInFrames={DYNAMIC_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
    <Composition
      id="EduOSPromoText"
      component={TextPromo}
      durationInFrames={TOTAL_FRAMES}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  </>
);
