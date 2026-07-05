'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';

interface Bubble { from: 'me' | 'bot'; text: string; buttons?: Array<{ id: string; title: string }> | null }

/**
 * WhatsApp Assistant preview. Drives the REAL bot brain (/whatsapp/simulate)
 * as the logged-in user — same identity resolution, role switching and scoped
 * tools that production WhatsApp uses. A safe way to demo and configure it.
 */
export default function WhatsAppPreview() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { from: 'bot', text: 'Hello! This is the EduOS WhatsApp assistant preview. Try "how is my child doing", "switch to teacher", or tap a role when offered.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [bubbles, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBubbles((b) => [...b, { from: 'me', text }]); setInput(''); setBusy(true);
    try {
      const res = await api.waSimulate(text);
      setBubbles((b) => [...b, { from: 'bot', text: res.reply, buttons: res.buttons }]);
    } catch {
      setBubbles((b) => [...b, { from: 'bot', text: 'Could not reach the assistant.' }]);
    } finally { setBusy(false); }
  };

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'WhatsApp Assistant', desc: 'Preview and configure the parent-facing WhatsApp bot.' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
        {/* phone frame */}
        <div style={{ background: '#0b141a', borderRadius: 28, padding: 10, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
          <div style={{ background: '#075E54', borderRadius: '20px 20px 0 0', padding: '12px 16px', color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>E</div>
            <div><div style={{ fontWeight: 600, fontSize: 14 }}>EduOS Assistant</div><div style={{ fontSize: 11, opacity: 0.8 }}>online</div></div>
          </div>
          <div ref={scrollRef} style={{ height: 440, overflowY: 'auto', background: '#0b141a', backgroundImage: 'radial-gradient(rgba(255,255,255,.02) 1px, transparent 1px)', backgroundSize: '14px 14px', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bubbles.map((b, i) => (
              <div key={i} style={{ alignSelf: b.from === 'me' ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                <div style={{ background: b.from === 'me' ? '#005C4B' : '#202C33', color: '#E9EDEF', padding: '7px 10px', borderRadius: 8, fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {b.text}
                </div>
                {b.buttons && b.buttons.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {b.buttons.map((btn) => (
                      <button key={btn.id} onClick={() => void send(btn.title)}
                        style={{ background: '#202C33', color: '#53BDEB', border: 'none', borderRadius: 8, padding: '8px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                        {btn.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <div style={{ alignSelf: 'flex-start', color: '#8696A0', fontSize: 12, padding: 4 }}>typing…</div>}
          </div>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); void send(input); }}
            style={{ display: 'flex', gap: 6, background: '#0b141a', padding: 8, borderRadius: '0 0 20px 20px' }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message"
              style={{ flex: 1, background: '#202C33', border: 'none', borderRadius: 18, padding: '9px 14px', color: '#E9EDEF', fontSize: 13 }} />
            <button type="submit" disabled={busy} style={{ background: '#00A884', border: 'none', borderRadius: '50%', width: 38, height: 38, color: '#fff', cursor: 'pointer' }}>➤</button>
          </form>
        </div>

        {/* setup / capabilities */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>How it works</strong>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.6 }}>
              The bot resolves a parent by their phone number, offers a role choice when the number holds
              multiple profiles, and answers using the same scoped tools the web copilot uses — so it can
              never reveal another family's data. Voice notes are transcribed; replies match the parent's
              language. This preview runs the real bot logic as your account.
            </p>
          </Card>
          <Card>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Connect a number</strong>
            <ol style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Create a Meta WhatsApp Business app and a phone number.</li>
              <li>Set the webhook to <code style={{ background: 'var(--panel-bg,#F3ECDC)', padding: '1px 5px', borderRadius: 4 }}>/api/v1/whatsapp/webhook</code> with your verify token.</li>
              <li>Add <code>WA_PHONE_NUMBER_ID</code>, <code>WA_ACCESS_TOKEN</code>, <code>WA_APP_SECRET</code>, <code>WA_WEBHOOK_VERIFY_TOKEN</code> to the server env.</li>
              <li>Inbound messages are signature-verified, then routed through the same brain shown here.</li>
            </ol>
          </Card>
          <Card>
            <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Proactive insights</strong>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.6 }}>
              High-risk flags become opt-in WhatsApp nudges to guardians, with significance scoring and a
              weekly per-parent cap so the channel never becomes spam.
            </p>
          </Card>
        </div>
      </div>
    </PortalShell>
  );
}
