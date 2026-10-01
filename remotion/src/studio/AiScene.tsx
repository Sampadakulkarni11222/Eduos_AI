import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { BRAND, ROLE_THEME } from '../config';
import { BODY, DISPLAY } from '../fonts';
import { Parchment } from '../components/Brand';
import { useBeatDuration } from '../components/duration';
import { CLAMP, ramp } from './ui';

/**
 * 68.5–82.4s — the assistant, drawn rather than captured. Two questions are
 * typed and answered, and beside them a four-step bridge lights up: the
 * request is understood, checked against what that person may see, answered
 * from the school's own records.
 *
 * The exchanges are sample data in a designed interface, and the bridge is
 * shown as a concept — no code, no internals.
 */
const EXCHANGES = [
  { q: "Show today's attendance for Class 8.", a: 'Class 8 attendance is 94% today — 42 of 45 present.', from: 0.06 },
  { q: 'Which students have pending fees?', a: '12 students have pending fees, totalling ₹2.4L.', from: 0.42 },
];

const STEPS = [
  { icon: '✦', label: 'Ask in plain language' },
  { icon: '◍', label: 'Understands the request' },
  { icon: '🔐', label: 'Checks your permissions' },
  { icon: '◫', label: 'Answers from school data' },
];

/** A chat bubble that types itself in, character by character. */
const Bubble: React.FC<{ text: string; mine?: boolean; t: number; typing?: boolean }> = ({ text, mine, t, typing }) => {
  const shown = typing ? text.slice(0, Math.round(text.length * ramp(t, 0.1, 0.8))) : text;
  const appear = ramp(t, 0, 0.18);
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', opacity: appear }}>
      <div
        style={{
          maxWidth: '82%',
          background: mine ? BRAND.green : '#20201E',
          color: mine ? '#062' : '#F4EFE4',
          borderRadius: 14,
          padding: '14px 18px',
          fontFamily: BODY,
          fontWeight: mine ? 700 : 500,
          fontSize: 21,
          lineHeight: 1.4,
          transform: `translateY(${(1 - appear) * 12}px)`,
          boxShadow: '0 10px 24px -14px rgba(0,0,0,.5)',
        }}
      >
        <span style={{ color: mine ? '#08301d' : '#F4EFE4' }}>{shown}</span>
        {typing && shown.length < text.length && <span style={{ opacity: 0.6 }}>▋</span>}
      </div>
    </div>
  );
};

export const AiScene: React.FC = () => {
  const frame = useCurrentFrame();
  const D = useBeatDuration();
  const p = frame / Math.max(1, D - 1);
  const accent = ROLE_THEME.principal.accent;

  const head = ramp(p, 0.02, 0.16);
  const panel = ramp(p, 0.06, 0.22);

  return (
    <AbsoluteFill>
      <Parchment />
      <AbsoluteFill style={{ padding: '70px 110px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ textAlign: 'center', opacity: head, transform: `translateY(${(1 - head) * 16}px)`, marginBottom: 34 }}>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 17, letterSpacing: '.18em', textTransform: 'uppercase', color: BRAND.gold, marginBottom: 10 }}>
            Ask Agent
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 56, color: BRAND.maroon, lineHeight: 1.06 }}>
            Ask your school, in plain language.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 56, alignItems: 'center', flex: 1 }}>
          {/* assistant panel */}
          <div
            style={{
              width: 880,
              height: 560,
              background: '#151513',
              borderRadius: 20,
              overflow: 'hidden',
              border: `1px solid ${BRAND.hairline}`,
              boxShadow: '0 44px 90px -40px rgba(58,34,41,.55)',
              opacity: panel,
              transform: `translateY(${(1 - panel) * 26}px)`,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ background: BRAND.green, padding: '16px 22px' }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 24, color: '#F2FBF5' }}>Ask Agent</div>
              <div style={{ fontFamily: BODY, fontSize: 14, color: '#E6F5EA', opacity: 0.85 }}>Answers from your school data</div>
            </div>
            <div style={{ flex: 1, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {EXCHANGES.map((e, i) => (
                <React.Fragment key={e.q}>
                  <Bubble text={e.q} mine t={ramp(p, e.from, e.from + 0.14)} typing />
                  <Bubble text={e.a} t={ramp(p, e.from + 0.16, e.from + 0.3)} />
                </React.Fragment>
              ))}
            </div>
            <div style={{ padding: 18, borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1, background: '#0E0E0D', borderRadius: 10, padding: '12px 16px', fontFamily: BODY, fontSize: 18, color: '#7c7566' }}>
                Ask anything…
              </div>
              <div style={{ background: BRAND.maroon, color: '#F4E7D2', borderRadius: 10, padding: '12px 22px', fontFamily: BODY, fontWeight: 700, fontSize: 18 }}>
                Send
              </div>
            </div>
          </div>

          {/* the bridge, as a concept */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
            {STEPS.map((s, i) => {
              const lit = ramp(p, 0.12 + i * 0.12, 0.24 + i * 0.12);
              return (
                <React.Fragment key={s.label}>
                  {i > 0 && (
                    <div style={{ width: 2, height: 26, background: BRAND.hairline, marginLeft: 33, position: 'relative' }}>
                      <div style={{ position: 'absolute', inset: 0, background: BRAND.gold, transform: `scaleY(${lit})`, transformOrigin: 'top' }} />
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 18,
                      background: BRAND.card,
                      border: `1px solid ${interpolate(lit, [0, 1], [0, 1], CLAMP) > 0.5 ? BRAND.gold : BRAND.cardBorder}`,
                      borderRadius: 16,
                      padding: '18px 22px',
                      opacity: 0.35 + lit * 0.65,
                      transform: `translateX(${(1 - lit) * 22}px)`,
                      boxShadow: lit > 0.5 ? '0 18px 40px -26px rgba(58,34,41,.5)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 14,
                        background: `linear-gradient(150deg, ${BRAND.cream1}, ${BRAND.cream2})`,
                        color: accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                        flex: 'none',
                      }}
                    >
                      {s.icon}
                    </div>
                    <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: 24, color: BRAND.text1 }}>{s.label}</div>
                  </div>
                </React.Fragment>
              );
            })}
            <div
              style={{
                marginTop: 12,
                fontFamily: BODY,
                fontWeight: 600,
                fontSize: 20,
                color: BRAND.text2,
                opacity: ramp(p, 0.7, 0.82),
                textAlign: 'center',
              }}
            >
              Permission-aware by design — and every change waits for your confirmation.
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
