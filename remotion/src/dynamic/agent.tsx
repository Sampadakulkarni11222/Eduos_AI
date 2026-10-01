import React from 'react';
import { AbsoluteFill } from 'remotion';
import { BRAND, ROLE_THEME } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { Parchment } from '../components/Brand';
import { CameraKey, Shot } from '../components/Shot';
import { Beats, Card, CardRing, Kicker, Rise, StepRail, Tag, f, useT } from './kit';

/**
 * 66–82 s. Every frame is the real Ask Agent panel in Rules mode, driven by
 * capture/capture.mjs and capture/hindi.mjs — nothing typed or answered here
 * is invented. The panel sits at x ≥ 1521 of the viewport.
 */
const cam = (...keys: [number, number, number, number][]): CameraKey[] => keys.map(([at, x, y, z]) => ({ at, x, y, z }));
const PANEL = 1720;

// ─── HINDI · 66–69 s ────────────────────────────────────────────────────────

/** Typed through the panel's language selector set to हिन्दी — not spoken. */
const HINDI_CROP: [number, number, number, number] = [1522, 0, 398, 205];

export const HindiSection: React.FC = () => {
  const { at } = useT();
  const text = at(0.05, 0.45);
  const card = at(0, 0.5);
  const ring = at(0.9, 1.25);
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 100 }}>
        <div style={{ width: 640 }}>
          <Kicker t={text} style={{ marginBottom: 16 }}>Ask Agent · हिन्दी</Kicker>
          <Rise t={text} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 92, lineHeight: 1.02, color: ROLE_THEME.parent.accent }}>
            Ask in your language
          </Rise>
        </div>
        <div style={{ opacity: card, transform: `translateY(${(1 - card) * 40}px)` }}>
          <Card src="ask-agent-hindi-answer.png" rect={HINDI_CROP} width={720} radius={18}>
            <CardRing rect={[1539, 148, 162, 40]} crop={HINDI_CROP} width={720} t={ring} />
          </Card>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── ASK AGENT HERO · 69–82 s ───────────────────────────────────────────────

/** Two real answers to one real question: the principal's and a parent's. */
const SameQuestion: React.FC = () => {
  const { at } = useT();
  const h1 = at(0, 0.35);
  const h2 = at(0.2, 0.55);
  const left = at(0.3, 0.7);
  const right = at(0.7, 1.1);
  const column = (t: number, role: 'principal' | 'parent', src: string, rect: [number, number, number, number], scope: string) => (
    <div style={{ opacity: t, transform: `translateY(${(1 - t) * 40}px)`, display: 'flex', flexDirection: 'column', gap: 18, width: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ padding: '9px 20px', borderRadius: 999, background: ROLE_THEME[role].accent, color: ROLE_THEME[role].onAccent, fontFamily: DISPLAY, fontWeight: 600, fontSize: 30 }}>
          {ROLE_THEME[role].label}
        </span>
        <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 23, color: BRAND.text2 }}>{scope}</span>
      </div>
      <Card src={src} rect={rect} width={760} />
    </div>
  );
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ padding: '80px 110px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 50 }}>
          <Kicker style={{ marginBottom: 10 }}>“Show fee collection summary”</Kicker>
          <Rise t={h1} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 74, lineHeight: 1.05, color: BRAND.maroon }}>
            Same question.
          </Rise>
          <Rise t={h2} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 74, lineHeight: 1.05, color: BRAND.gold }}>
            Different access.
          </Rise>
        </div>
        <div style={{ display: 'flex', gap: 70, alignItems: 'flex-start' }}>
          {column(left, 'principal', 'ask-agent-read.png', [1528, 90, 392, 150], 'Whole school')}
          {column(right, 'parent', 'ask-agent-parent-read.png', [1528, 90, 392, 110], 'Only their own child')}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The guarantee, held long enough to read twice. */
const CONFIRM_CROP: [number, number, number, number] = [1539, 257, 319, 151];
const Guarantee: React.FC = () => {
  const { at } = useT();
  const k = at(0.05, 0.4);
  const l1 = at(0.1, 0.5);
  const l2 = at(0.3, 0.7);
  const card = at(0.2, 0.7);
  const ring = at(0.8, 1.1);
  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 100 }}>
        <div style={{ width: 900 }}>
          <Kicker t={k} style={{ marginBottom: 18 }}>Every write waits for you</Kicker>
          <Rise t={l1} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 90, lineHeight: 1.04, color: ROLE_THEME.admin.accent }}>
            Nothing changes
          </Rise>
          <Rise t={l2} style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 90, lineHeight: 1.04, color: ROLE_THEME.admin.accent }}>
            without your confirmation.
          </Rise>
        </div>
        <div style={{ opacity: card, transform: `translateY(${(1 - card) * 30}px)` }}>
          <Card src="ask-agent-confirmation.png" rect={CONFIRM_CROP} width={640} radius={18}>
            <CardRing rect={[1553, 336, 142, 38]} crop={CONFIRM_CROP} width={640} t={ring} />
          </Card>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const WRITE = ['Take action', 'Review', 'Confirm', 'Done'];
const AGENT_BEATS = [1.6, 1.9, 2.9, 1.0, 1.4, 0.9, 0.8, 2.5];
const start = (i: number) => AGENT_BEATS.slice(0, i).reduce((a, b) => a + b, 0);

export const AgentSection: React.FC = () => {
  const { frame, at } = useT();
  const admin = ROLE_THEME.admin.accent;
  const principal = ROLE_THEME.principal.accent;
  // The write rail rides over beats 3–6 (take action → done).
  const s0 = f(start(3));
  const s4 = f(start(7));
  const writeStep = [3, 4, 5, 6].reduce((n, b, i) => (frame >= f(start(b)) ? i : n), 0);
  const railIn = at(start(3), start(3) + 0.3);
  const showRail = frame >= s0 && frame < s4;
  return (
    <AbsoluteFill>
      <Beats
        beats={[
          {
            s: AGENT_BEATS[0],
            name: 'ask',
            node: (
              <AbsoluteFill>
                <Shot src="ask-agent-read-question.png" camera={cam([0, 1100, 540, 1.0], [1, PANEL, 860, 1.7])} highlights={[{ rect: [1684, 1028, 180, 40], from: 0.45, radius: 10 }]} />
                <Tag title="Ask your school data" kicker="Ask Agent" accent={principal} size={72} />
              </AbsoluteFill>
            ),
          },
          {
            s: AGENT_BEATS[1],
            enter: 'fade',
            t: 8,
            name: 'answer',
            node: (
              <AbsoluteFill>
                <Shot src="ask-agent-read.png" camera={cam([0, PANEL, 420, 1.7], [1, PANEL, 300, 2.0])} highlights={[{ rect: [1539, 149, 309, 79], from: 0.15, radius: 12 }]} />
                <Tag title="Get an instant answer" kicker="Principal · answered from school data" accent={principal} size={72} />
              </AbsoluteFill>
            ),
          },
          { s: AGENT_BEATS[2], enter: 'slide-up', name: 'same-question', node: <SameQuestion /> },
          {
            s: AGENT_BEATS[3],
            enter: 'push',
            name: 'take-action',
            node: (
              <AbsoluteFill>
                <Shot src="ask-agent-write-question.png" camera={cam([0, 1250, 560, 1.1], [1, PANEL, 860, 1.7])} highlights={[{ rect: [1684, 1028, 180, 40], from: 0.3, radius: 10 }]} />
                <Tag title="Take action" kicker="School Admin · “Post an announcement…”" accent={admin} />
              </AbsoluteFill>
            ),
          },
          {
            s: AGENT_BEATS[4],
            enter: 'fade',
            t: 8,
            name: 'review',
            node: (
              <AbsoluteFill>
                <Shot src="ask-agent-confirmation.png" camera={cam([0, PANEL, 420, 1.7], [1, PANEL, 320, 2.15])} highlights={[{ rect: [1539, 257, 319, 151], from: 0.15, radius: 12 }]} />
                <Tag title="Review" kicker="Affects other people's records" accent={admin} size={80} />
              </AbsoluteFill>
            ),
          },
          {
            s: AGENT_BEATS[5],
            enter: 'cut',
            name: 'confirm',
            node: (
              <AbsoluteFill>
                <Shot src="ask-agent-confirmation.png" camera={cam([0, PANEL, 320, 2.15], [1, PANEL, 340, 2.35])} highlights={[{ rect: [1553, 336, 142, 38], from: 0.05, radius: 10 }]} />
                <Tag title="Confirm" kicker="Only when you say so" accent={admin} size={80} delay={0.02} />
              </AbsoluteFill>
            ),
          },
          {
            s: AGENT_BEATS[6],
            enter: 'fade',
            t: 6,
            name: 'done',
            node: (
              <AbsoluteFill>
                <Shot src="ask-agent-confirmed.png" camera={cam([0, PANEL, 320, 2.2], [1, PANEL, 300, 2.25])} highlights={[{ rect: [1539, 280, 248, 40], from: 0.1, radius: 10 }]} />
                <Tag title="Done" kicker="Posted · on the audit log" accent={admin} size={80} delay={0.02} />
              </AbsoluteFill>
            ),
          },
          { s: AGENT_BEATS[7], enter: 'fade', name: 'guarantee', node: <Guarantee /> },
        ]}
      />
      {showRail && <StepRail steps={WRITE} active={writeStep} accent={admin} enterT={railIn} />}
    </AbsoluteFill>
  );
};
