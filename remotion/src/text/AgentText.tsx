import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { BRAND, ROLE_THEME } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { Parchment } from '../components/Brand';
import { Crop } from '../components/Crop';
import { Shot } from '../components/Shot';
import { ShotSequence } from '../components/ShotSequence';
import { useBeatDuration } from '../components/duration';
import { FlowRow, TextPlate } from './overlays';

/**
 * 59.6–79.6s — the hero, text-led. Every frame is the real Ask Agent panel in
 * Rules mode: a read, the same question from two roles, then a write that
 * waits for Confirm and lands in the audit log. The four-step flow
 * (Ask → Review → Confirm → Done) runs across the write beats so the
 * guarantee reads without a word of narration.
 */
const PANEL_X = 1720;
const FLOW = ['Ask', 'Review', 'Confirm', 'Done'];
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const AgentText: React.FC = () => (
  <AbsoluteFill>
    <Parchment />
    <ShotSequence
      beats={[
        {
          weight: 0.75,
          node: (
            <AbsoluteFill>
              <Shot src="ask-agent-read-question.png" camera={[{ at: 0, x: 1200, y: 540, z: 1 }, { at: 1, x: PANEL_X, y: 860, z: 1.7 }]} />
              <TextPlate kicker="Ask Agent" title="Ask your school data" accent={ROLE_THEME.principal.accent} from={0.12} to={1.1} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 1.0,
          enter: 'fade',
          node: (
            <AbsoluteFill>
              <Shot
                src="ask-agent-read.png"
                camera={[{ at: 0, x: PANEL_X, y: 420, z: 1.7 }, { at: 1, x: PANEL_X, y: 300, z: 2.0 }]}
                highlights={[{ rect: [1539, 149, 309, 79], from: 0.2, to: 0.99, radius: 12 }]}
              />
              <TextPlate
                kicker="Principal · answered from school data"
                title="Get an instant answer"
                accent={ROLE_THEME.principal.accent}
                from={0.06}
              />
            </AbsoluteFill>
          ),
        },
        { weight: 1.3, enter: 'slide-up', node: <SameQuestion /> },
        {
          weight: 0.65,
          enter: 'fade',
          node: (
            <AbsoluteFill>
              <Shot src="ask-agent-write-question.png" camera={[{ at: 0, x: 1250, y: 540, z: 1.05 }, { at: 1, x: PANEL_X, y: 860, z: 1.7 }]} />
              <FlowRow steps={FLOW} active={0} accent={ROLE_THEME.admin.accent} />
              <TextPlate kicker="School Admin" title="Take action" accent={ROLE_THEME.admin.accent} from={0.1} to={1.1} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 1.35,
          enter: 'fade',
          node: (
            <AbsoluteFill>
              <Shot
                src="ask-agent-confirmation.png"
                camera={[{ at: 0, x: PANEL_X, y: 420, z: 1.7 }, { at: 1, x: PANEL_X - 20, y: 320, z: 2.15 }]}
                highlights={[{ rect: [1539, 257, 319, 151], from: 0.18, to: 0.99, radius: 12 }]}
              />
              <FlowRow steps={FLOW} active={1} accent={ROLE_THEME.admin.accent} />
              <TextPlate
                kicker="Checked against your permissions"
                title="Nothing changes without your confirmation."
                accent={ROLE_THEME.admin.accent}
                from={0.1}
                size={46}
              />
            </AbsoluteFill>
          ),
        },
        {
          weight: 0.75,
          enter: 'fade',
          node: (
            <AbsoluteFill>
              <Shot
                src="ask-agent-confirmed.png"
                camera={[{ at: 0, x: PANEL_X - 20, y: 320, z: 2.15 }, { at: 1, x: PANEL_X - 20, y: 300, z: 2.2 }]}
                highlights={[{ rect: [1539, 280, 248, 40], from: 0.15, to: 0.99, radius: 10 }]}
              />
              <FlowRow steps={FLOW} active={3} accent={ROLE_THEME.admin.accent} />
              <TextPlate kicker="Confirmed" title="Done" accent={ROLE_THEME.admin.accent} from={0.1} width={520} />
            </AbsoluteFill>
          ),
        },
        {
          weight: 1.0,
          enter: 'slide-left',
          node: (
            <AbsoluteFill>
              <Shot
                src="admin-audit.png"
                camera={[{ at: 0, x: 960, y: 450, z: 1.1 }, { at: 1, x: 880, y: 330, z: 1.4 }]}
                highlights={[{ rect: [285, 216, 1177, 180], from: 0.25, to: 0.99, radius: 10 }]}
              />
              <TextPlate kicker="Audit log" title="Every action, on the record" accent={ROLE_THEME.admin.accent} from={0.1} />
            </AbsoluteFill>
          ),
        },
      ]}
    />
  </AbsoluteFill>
);

/** Two real answers to one real question, side by side. */
const SameQuestion: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const head = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: EASE });
  const head2 = interpolate(frame, [8, 26], [0, 1], { ...clamp, easing: EASE });
  const left = interpolate(frame, [D * 0.12, D * 0.12 + 20], [0, 1], { ...clamp, easing: EASE });
  const right = interpolate(frame, [D * 0.3, D * 0.3 + 20], [0, 1], { ...clamp, easing: EASE });

  const column = (t: number, role: 'principal' | 'parent', src: string, rect: [number, number, number, number], scope: string) => (
    <div style={{ opacity: t, transform: `translateY(${(1 - t) * 40}px)`, display: 'flex', flexDirection: 'column', gap: 18, width: 740 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ padding: '9px 20px', borderRadius: 999, background: ROLE_THEME[role].accent, color: ROLE_THEME[role].onAccent, fontFamily: DISPLAY, fontWeight: 600, fontSize: 30 }}>
          {ROLE_THEME[role].label}
        </span>
        <span style={{ fontFamily: BODY, fontWeight: 600, fontSize: 21, color: BRAND.text2 }}>{scope}</span>
      </div>
      <Crop src={src} rect={rect} width={740} />
    </div>
  );

  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ padding: '90px 120px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 54 }}>
          <div style={{ overflow: 'hidden', paddingBottom: 2 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 68, lineHeight: 1.08, color: BRAND.maroon, transform: `translateY(${(1 - head) * 112}%)` }}>
              Same question.
            </div>
          </div>
          <div style={{ overflow: 'hidden', paddingBottom: 2 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 68, lineHeight: 1.08, color: BRAND.gold, transform: `translateY(${(1 - head2) * 112}%)` }}>
              Different access.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 70, alignItems: 'flex-start' }}>
          {column(left, 'principal', 'ask-agent-read.png', [1528, 90, 392, 150], 'Whole school')}
          {column(right, 'parent', 'ask-agent-parent-read.png', [1528, 90, 392, 110], 'Only their own child')}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
