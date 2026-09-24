import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { BRAND, ROLE_THEME } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { Parchment } from '../components/Brand';
import { Caption } from '../components/Caption';
import { Crop } from '../components/Crop';
import { Shot } from '../components/Shot';
import { ShotSequence } from '../components/ShotSequence';
import { useBeatDuration } from '../components/duration';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/**
 * The assistant answering in Hindi. Rules mode, asked through the panel's own
 * language selector set to हिन्दी — typed, not spoken: headless browsers cannot
 * exercise dictation, and a simulated microphone would be a lie.
 *
 * Shown as a crop of the panel rather than the whole screen: this capture is
 * from a later stack than the surrounding screens, and the page behind it
 * carries that stack's own attendance and notice counts.
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
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 96, padding: '0 120px' }}>
        <div style={{ width: 760, opacity: text, transform: `translateY(${(1 - text) * 22}px)` }}>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 18, letterSpacing: '.16em', color: BRAND.gold, textTransform: 'uppercase', marginBottom: 14 }}>
            Parent · हिन्दी
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 62, lineHeight: 1.06, color: ROLE_THEME.parent.accent, marginBottom: 18 }}>
            Ask in your own language.
          </div>
          <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: 25, lineHeight: 1.45, color: BRAND.text2 }}>
            Typed in Hinglish, answered in Hindi — from the same fee record.
          </div>
        </div>
        <div style={{ position: 'relative', opacity: enter, transform: `translateY(${(1 - enter) * 40}px) scale(${0.97 + enter * 0.03})` }}>
          {/* Header + both bubbles, enlarged so the exchange is legible. */}
          <Crop src="ask-agent-hindi-answer.png" rect={[1522, 0, 398, 430]} width={660} />
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
          {/* The panel's own language control, as set for this exchange. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 22, opacity: text }}>
            <Crop src="ask-agent-hindi-answer.png" rect={[1528, 1026, 190, 54]} width={220} style={{ borderRadius: 10 }} />
            <span style={{ fontFamily: BODY, fontWeight: 600, fontSize: 19, color: BRAND.textFaint }}>
              answer language, set in the panel
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * 40–60s — a day in the school, told with screens captured in that order
 * against the same data: the register the teacher saves, the family's view,
 * a real (sandbox) fee payment, and the principal's risk scan.
 */
export const Day: React.FC = () => (
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
              <Caption eyebrow="A day in the school · Teacher" title="Attendance, one tap per student." sub="Diya's class is marked — one late arrival noted." accent={ROLE_THEME.teacher.accent} from={0.08} />
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
              <Caption eyebrow="Parent" title="The family sees the same record." sub="Attendance, results, fees and notices for Diya, in one place." accent={ROLE_THEME.parent.accent} from={0.08} />
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
              <Caption eyebrow="Parent" title="Fees paid online, with a receipt." sub="The invoice closes on the school's own ledger." accent={ROLE_THEME.parent.accent} from={0.05} />
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
              <Caption eyebrow="Principal" title="Risk is flagged early — with the reason." sub="Every flagged signal, with the reasons behind it." accent={ROLE_THEME.principal.accent} from={0.08} />
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
              <Caption eyebrow="Principal" title="From signal to action." sub="Why a student was flagged, and who to call next." accent={ROLE_THEME.principal.accent} from={0.08} width={760} />
            </AbsoluteFill>
          ),
        },
      ]}
    />
  </AbsoluteFill>
);
