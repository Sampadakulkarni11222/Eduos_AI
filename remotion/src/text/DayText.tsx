import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { BRAND, ROLE_THEME } from '../config';
import { BODY } from '../fonts';
import { Parchment } from '../components/Brand';
import { Crop } from '../components/Crop';
import { Shot } from '../components/Shot';
import { ShotSequence } from '../components/ShotSequence';
import { useBeatDuration } from '../components/duration';
import { TextPlate } from './overlays';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * The Hindi exchange, text-led: the panel is the subject, the type is a
 * three-word label. Rules mode, asked through the panel's own language
 * selector set to हिन्दी — typed, not spoken. Cropped to the panel because
 * this capture comes from a later stack than the screens around it.
 */
const HindiMoment: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const enter = interpolate(frame, [0, 20], [0, 1], { ...clamp, easing: EASE });
  const text = interpolate(frame, [8, 30], [0, 1], { ...clamp, easing: EASE });
  const ring = interpolate(frame, [D * 0.42, D * 0.42 + 12], [0, 1], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 110, padding: '0 130px' }}>
        <div style={{ width: 700, opacity: text, transform: `translateY(${(1 - text) * 22}px)` }}>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 17, letterSpacing: '.18em', color: BRAND.gold, textTransform: 'uppercase', marginBottom: 16 }}>
            Ask Agent · हिन्दी
          </div>
          <div style={{ fontFamily: 'Newsreader, serif', fontWeight: 600, fontSize: 76, lineHeight: 1.04, color: ROLE_THEME.parent.accent }}>
            Ask in your
            <br />
            language
          </div>
        </div>
        <div style={{ position: 'relative', opacity: enter, transform: `translateY(${(1 - enter) * 40}px) scale(${0.97 + enter * 0.03})` }}>
          <Crop src="ask-agent-hindi-answer.png" rect={[1522, 0, 398, 320]} width={660} />
          <div
            style={{
              position: 'absolute',
              left: 37,
              top: 244,
              width: 250,
              height: 69,
              borderRadius: 12,
              border: `3px solid ${BRAND.gold}`,
              boxShadow: '0 0 0 6px rgba(201,162,63,.18), 0 0 28px rgba(201,162,63,.35)',
              opacity: ring,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * 38.1–59.6s — one school day, told as four short instructions over the real
 * screens: mark attendance, stay connected, manage payments, identify risks.
 */
export const DayText: React.FC = () => (
  <AbsoluteFill>
    <Parchment />
    <ShotSequence
      beats={[
        {
          weight: 1.25,
          node: (
            <AbsoluteFill>
              <Shot
                src="teacher-attendance.png"
                camera={[{ at: 0, x: 960, y: 540, z: 1 }, { at: 0.45, x: 900, y: 360, z: 1.45 }, { at: 1, x: 930, y: 390, z: 1.5 }]}
                highlights={[{ rect: [285, 432, 1177, 44], from: 0.42, to: 0.99, radius: 8 }]}
              />
              <TextPlate kicker="A day in the school · Teacher" title="Mark attendance" accent={ROLE_THEME.teacher.accent} from={0.08} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 1.1,
          enter: 'slide-left',
          node: (
            <AbsoluteFill>
              <Shot
                src="parent-dashboard.png"
                camera={[{ at: 0, x: 960, y: 540, z: 1 }, { at: 0.5, x: 900, y: 360, z: 1.35 }, { at: 1, x: 900, y: 370, z: 1.38 }]}
                highlights={[{ rect: [285, 283, 222, 126], from: 0.4, to: 0.99, radius: 14 }]}
              />
              <TextPlate kicker="Parent" title="Stay connected" accent={ROLE_THEME.parent.accent} from={0.08} />
            </AbsoluteFill>
          ),
        },
        { weight: 0.85, enter: 'fade', node: <HindiMoment /> },
        {
          weight: 0.8,
          enter: 'slide-left',
          node: (
            <AbsoluteFill>
              <Shot
                src="parent-payments.png"
                camera={[{ at: 0, x: 900, y: 300, z: 1.25 }, { at: 1, x: 1080, y: 230, z: 1.55 }]}
                highlights={[{ rect: [1255, 149, 131, 37], from: 0.35, to: 0.99, radius: 10 }]}
              />
              <TextPlate kicker="Parent" title="Manage payments" accent={ROLE_THEME.parent.accent} from={0.1} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 0.9,
          enter: 'fade',
          node: (
            <AbsoluteFill>
              <Shot
                src="parent-pay-done.png"
                camera={[{ at: 0, x: 1000, y: 560, z: 1.05 }, { at: 1, x: 1380, y: 800, z: 1.45 }]}
                highlights={[{ rect: [1541, 998, 358, 61], from: 0.3, to: 0.99, radius: 12 }]}
              />
              <TextPlate kicker="Parent" title="Receipt issued" accent={ROLE_THEME.parent.accent} from={0.06} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 1.0,
          enter: 'slide-left',
          node: (
            <AbsoluteFill>
              <Shot
                src="principal-risk.png"
                camera={[{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 470, z: 1.25 }]}
                highlights={[{ rect: [285, 490, 1177, 118], from: 0.35, to: 0.99, radius: 8 }]}
              />
              <TextPlate kicker="Principal" title="Identify risks" accent={ROLE_THEME.principal.accent} from={0.08} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 1.1,
          enter: 'fade',
          node: (
            <AbsoluteFill>
              <Shot
                src="principal-risk-drawer.png"
                camera={[{ at: 0, x: 1200, y: 540, z: 1.05 }, { at: 1, x: 1640, y: 400, z: 1.55 }]}
                highlights={[{ rect: [1492, 206, 410, 103], from: 0.4, to: 0.99, radius: 10 }]}
              />
              <TextPlate kicker="Principal" title="Act early" accent={ROLE_THEME.principal.accent} from={0.08} width={620} />
            </AbsoluteFill>
          ),
        },
      ]}
    />
  </AbsoluteFill>
);
