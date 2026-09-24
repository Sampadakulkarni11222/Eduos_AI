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

/**
 * 60–80s — HERO. Every frame here is the real Ask Agent panel in Rules mode,
 * answering through the MCP server: a read, the same question from two roles,
 * then a write that waits for Confirm and lands in the audit log.
 */
const PANEL_X = 1720;

export const Agent: React.FC = () => (
  <AbsoluteFill>
    <Parchment />
    <ShotSequence
      beats={[
        {
          weight: 0.75,
          node: (
            <AbsoluteFill>
              <Shot src="ask-agent-read-question.png" camera={[{ at: 0, x: 1200, y: 540, z: 1 }, { at: 1, x: PANEL_X, y: 860, z: 1.7 }]} />
              <Caption eyebrow="Ask Agent" title="Ask in plain language." sub="Principal · “Show fee collection summary”" accent={ROLE_THEME.principal.accent} from={0.1} to={1.1} width={820} />
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
              <Caption eyebrow="Answered from school data" title="Read through MCP tools." sub="Within exactly what the Principal is allowed to see." accent={ROLE_THEME.principal.accent} from={0.05} width={820} />
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
              <Caption eyebrow="Ask Agent · School Admin" title="Now, a change." sub="“Post an announcement saying the annual sports day is on 5 October”" accent={ROLE_THEME.admin.accent} from={0.08} to={1.1} width={860} />
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
              <Caption eyebrow="Checked against permissions first" title="Nothing changes without your confirmation." sub="The server writes the summary. You approve exactly what will run." accent={ROLE_THEME.admin.accent} from={0.08} width={860} />
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
              <Caption eyebrow="Confirmed" title="Done — and posted to the school." accent={ROLE_THEME.admin.accent} from={0.08} width={820} />
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
              <Caption eyebrow="Audit log" title="Every AI action is on the record." sub="Who asked, as which role, through which channel, and when." accent={ROLE_THEME.admin.accent} from={0.08} />
            </AbsoluteFill>
          ),
        },
      ]}
    />
  </AbsoluteFill>
);

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/** The same question, asked by a principal and by a parent — two real answers. */
const SameQuestion: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const head = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: EASE });
  const left = interpolate(frame, [D * 0.1, D * 0.1 + 20], [0, 1], { ...clamp, easing: EASE });
  const right = interpolate(frame, [D * 0.28, D * 0.28 + 20], [0, 1], { ...clamp, easing: EASE });

  const column = (t: number, role: 'principal' | 'parent', src: string, rect: [number, number, number, number], scope: string) => (
    <div style={{ opacity: t, transform: `translateY(${(1 - t) * 40}px)`, display: 'flex', flexDirection: 'column', gap: 22, width: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ padding: '10px 22px', borderRadius: 999, background: ROLE_THEME[role].accent, color: ROLE_THEME[role].onAccent, fontFamily: DISPLAY, fontWeight: 600, fontSize: 32 }}>
          {ROLE_THEME[role].label}
        </span>
        <span style={{ fontFamily: BODY, fontWeight: 600, fontSize: 22, color: BRAND.text2 }}>{scope}</span>
      </div>
      <Crop src={src} rect={rect} width={760} />
    </div>
  );

  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ padding: '96px 120px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ opacity: head, transform: `translateY(${(1 - head) * 20}px)`, textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 18, letterSpacing: '.16em', color: BRAND.gold, textTransform: 'uppercase', marginBottom: 12 }}>
            Permissions matter
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 64, color: BRAND.maroon }}>Same question. Different access.</div>
          <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: 26, color: BRAND.text2, marginTop: 12 }}>“Show fee collection summary”</div>
        </div>
        <div style={{ display: 'flex', gap: 80, alignItems: 'flex-start' }}>
          {column(left, 'principal', 'ask-agent-read.png', [1528, 90, 392, 150], 'Whole school')}
          {column(right, 'parent', 'ask-agent-parent-read.png', [1528, 90, 392, 110], 'Only their own child')}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
