import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.hoisted(() => { process.env.RATE_LIMIT_AI_MAX = '100000'; });

const { env } = await import('../src/config/env.js');
const { sttProvider, transcribe } = await import('../src/modules/ai/speech/stt.js');
const { downloadMetaMedia, downloadChatflowMedia } = await import('../src/modules/whatsapp/whatsapp.media.js');
const { extractMessages } = await import('../src/modules/whatsapp/whatsapp.service.js');
const { parseChatflowEvent } = await import('../src/modules/whatsapp/chatflow.inbound.js');
const { StaffLeave } = await import('../src/models/staffLeave.model.js');
const { resetMcpClient } = await import('../src/modules/ai/mcp/client.js');
const { resetAgentThrottle } = await import('../src/modules/ai/agent/throttle.js');
const { startApi } = await import('./support/mcpHttp.js');
const { inSchool, OAK } = await import('./support/mcpSchool.js');
const { seedConversationSchool } = await import('./support/askAiConversationSchool.js');

/**
 * p7 voice: WhatsApp voice notes (downloaded through the provider adapter,
 * transcribed by the speech adapter) and the website's microphone. What is
 * heard is shown back before anything else; a spoken "yes" never confirms a
 * change; with no speech service configured, the reply says so -- nothing is
 * ever transcribed by guesswork.
 */

const KEYS = ['STT_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_STT_API_KEY', 'GOOGLE_STT_API_KEY', 'WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN', 'CHATFLOW_API_URL', 'CHATFLOW_API_KEY'];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, env[k]])); });
afterEach(() => { Object.assign(env, saved); });

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } });

describe('speech-to-text adapter', () => {
  it('is off without a key, and says so', async () => {
    Object.assign(env, { STT_PROVIDER: 'auto', OPENAI_API_KEY: null, OPENAI_STT_API_KEY: null, GOOGLE_STT_API_KEY: null });
    expect(sttProvider()).toBeNull();
    expect(await transcribe({ audio: Buffer.from('x') })).toEqual({ configured: false, provider: null, text: '' });
  });

  it('OpenAI Whisper: posts the audio with the language hint and returns the text', async () => {
    Object.assign(env, { STT_PROVIDER: 'auto', OPENAI_STT_API_KEY: 'sk-test-whisper', GOOGLE_STT_API_KEY: null });
    expect(sttProvider()).toBe('whisper');
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return jsonResponse({ text: ' आज की उपस्थिति दिखाओ ' }); };
    const out = await transcribe({ audio: Buffer.from('OggS fake opus'), mimeType: 'audio/ogg; codecs=opus', lang: 'hi', fetchImpl });
    expect(out).toMatchObject({ configured: true, provider: 'whisper', text: 'आज की उपस्थिति दिखाओ' });
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-test-whisper');
    expect(calls[0].init.body.get('language')).toBe('hi');
    expect(calls[0].init.body.get('model')).toBe('whisper-1');
  });

  it('Google Speech-to-Text: OGG_OPUS in the person\'s language, key never logged', async () => {
    Object.assign(env, { STT_PROVIDER: 'google', OPENAI_API_KEY: 'sk-other', GOOGLE_STT_API_KEY: 'AIza-test-key' });
    expect(sttProvider()).toBe('google');
    let sent;
    const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return jsonResponse({ results: [{ alternatives: [{ transcript: 'நாளை வீட்டுப்பாடம் என்ன' }], languageCode: 'ta-in' }] }); };
    const out = await transcribe({ audio: Buffer.from('OggS'), mimeType: 'audio/ogg', lang: 'ta', fetchImpl });
    expect(out.text).toBe('நாளை வீட்டுப்பாடம் என்ன');
    expect(sent.url).toMatch(/^https:\/\/speech\.googleapis\.com\/v1p1beta1\/speech:recognize\?key=AIza-test-key$/);
    expect(sent.body.config).toMatchObject({ encoding: 'OGG_OPUS', languageCode: 'ta-IN' });
    const failed = await transcribe({ audio: Buffer.from('OggS'), lang: 'ta', fetchImpl: async () => jsonResponse({}, 500) });
    expect(failed).toMatchObject({ configured: true, text: '', error: 'PROVIDER_ERROR' });
  });
});

describe('downloading a voice note through the provider adapter', () => {
  it('Meta: looks the media id up, then fetches it from a Meta host with the token', async () => {
    Object.assign(env, { WA_PHONE_NUMBER_ID: '123', WA_ACCESS_TOKEN: 'meta-token' });
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url: String(url), auth: init?.headers?.Authorization });
      if (String(url).startsWith('https://graph.facebook.com/')) return jsonResponse({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg' });
      return { ok: true, status: 200, headers: { get: () => '4' }, arrayBuffer: async () => new Uint8Array([79, 103, 103, 83]).buffer };
    };
    const got = await downloadMetaMedia('987654', { fetchImpl });
    expect(got.mimeType).toBe('audio/ogg');
    expect(got.audio.toString()).toBe('OggS');
    expect(seen.every((s) => s.auth === 'Bearer meta-token')).toBe(true);
  });

  it('Meta: a media URL on any other host is refused (the token goes nowhere else)', async () => {
    Object.assign(env, { WA_PHONE_NUMBER_ID: '123', WA_ACCESS_TOKEN: 'meta-token' });
    let fetchedElsewhere = false;
    const fetchImpl = async (url) => {
      if (String(url).startsWith('https://graph.facebook.com/')) return jsonResponse({ url: 'https://evil.example.com/a.ogg' });
      fetchedElsewhere = true;
      return jsonResponse({});
    };
    expect(await downloadMetaMedia('987654', { fetchImpl })).toBeNull();
    expect(fetchedElsewhere).toBe(false);
  });

  it('nothing is downloaded without live credentials', async () => {
    Object.assign(env, { WA_PHONE_NUMBER_ID: '', WA_ACCESS_TOKEN: '', CHATFLOW_API_URL: '', CHATFLOW_API_KEY: '' });
    const fetchImpl = vi.fn();
    expect(await downloadMetaMedia('987654', { fetchImpl })).toBeNull();
    expect(await downloadChatflowMedia({ url: 'https://x.example/a.ogg' }, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('webhook payloads carry the voice note (Meta and Chatflow)', () => {
    const meta = extractMessages({ entry: [{ changes: [{ value: { messages: [{ from: '919811100001', id: 'wamid.v1', type: 'audio', audio: { id: '555', mime_type: 'audio/ogg; codecs=opus', voice: true } }] } }] }] });
    expect(meta[0]).toMatchObject({ type: 'audio', text: null, audio: { id: '555', mimeType: 'audio/ogg; codecs=opus', voice: true } });
    const cf = parseChatflowEvent({ event: 'message.received', data: { message: { id: 'wamid.v2', type: 'AUDIO', from: '919811100001', mediaUrl: 'https://cf.example/m/1.ogg', mimeType: 'audio/ogg' } } });
    expect(cf[0]).toMatchObject({ type: 'audio', text: null, media: { url: 'https://cf.example/m/1.ogg', mimeType: 'audio/ogg' } });
  });
});

describe('voice over WhatsApp and the website, end to end', () => {
  let api;
  let school;
  let seq = 0;
  beforeAll(async () => { api = await startApi(); });
  afterAll(async () => { await api.close(); await resetMcpClient(); });
  beforeEach(async () => {
    resetAgentThrottle();
    Object.assign(env, { STT_PROVIDER: 'auto', OPENAI_API_KEY: null, OPENAI_STT_API_KEY: null, GOOGLE_STT_API_KEY: null });
    school = await seedConversationSchool();
  });

  async function voiceNote(person, audio) {
    resetAgentThrottle();
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: `wamid.voice.${Date.now()}.${++seq}`, from: person.phone.replace('+', ''), type: 'audio', audio }] } }] }] };
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', env.WA_APP_SECRET).update(raw).digest('hex')}`;
    const res = await fetch(`${api.base}/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: raw });
    const body = await res.json();
    return String(body.data?.replies?.[0]?.reply ?? '');
  }
  const text = async (person, message) => { resetAgentThrottle(); return String((await api.whatsapp(person, message)).reply ?? ''); };

  it('with no speech service configured, a voice note is answered plainly -- never guessed', async () => {
    const reply = await voiceNote(school.people.STUDENT, { id: '555', mime_type: 'audio/ogg', voice: true });
    expect(reply).toMatch(/Voice notes need a speech service/);
  });

  it('what was heard is shown back, then answered like the typed words', async () => {
    const reply = await voiceNote(school.people.STUDENT, { id: '556', mime_type: 'audio/ogg', simulatedTranscript: 'show my timetable for tomorrow' });
    expect(reply).toMatch(/^_I heard: “show my timetable for tomorrow”_/);
    expect(reply.length).toBeGreaterThan(60);
  });

  it('a spoken change is drafted, a spoken "yes" does NOT confirm it, a typed YES does', async () => {
    const teacher = school.people.TEACHER;
    const before = await inSchool(OAK, () => StaffLeave.countDocuments({}));
    const draft = await voiceNote(teacher, { id: '557', simulatedTranscript: 'apply for casual leave tomorrow for a family function' });
    expect(draft).toMatch(/I heard: “apply for casual leave tomorrow for a family function”/);
    expect(draft).toMatch(/Reply YES to confirm/);
    const spokenYes = await voiceNote(teacher, { id: '558', simulatedTranscript: 'yes' });
    expect(spokenYes).toMatch(/a voice note cannot confirm a change/i);
    expect(await inSchool(OAK, () => StaffLeave.countDocuments({}))).toBe(before);
    const typed = await text(teacher, 'YES');
    expect(typed).not.toMatch(/voice note/i);
    expect(await inSchool(OAK, () => StaffLeave.countDocuments({}))).toBe(before + 1);
  });

  it('a voice note in Hindi is heard in Hindi and answered in Hindi', async () => {
    const reply = await voiceNote(school.people.PARENT, { id: '559', simulatedTranscript: 'कितनी फीस बाकी है?' });
    expect(reply).toMatch(/मैंने सुना: “कितनी फीस बाकी है\?”/);
    expect(reply).toMatch(/फीस|बकाया/);
  });

  it('the in-app simulator accepts a stand-in transcript and says it was simulated', async () => {
    resetAgentThrottle();
    const res = await api.post(school.people.STUDENT, '/whatsapp/simulate', { voice: { transcript: 'show my timetable for tomorrow' } });
    expect(res.status).toBe(200);
    expect(res.body.data.voice).toEqual({ transcript: 'show my timetable for tomorrow', simulated: true });
    expect(res.body.data.reply).toMatch(/I heard: “show my timetable for tomorrow”/);
  });

  it('the website microphone: what was heard is shown above the answer and above any draft', async () => {
    resetAgentThrottle();
    const read = await api.post(school.people.STUDENT, '/ai/agent', { message: 'show my timetable for tomorrow', inputMode: 'voice' });
    expect(read.body.data.reply).toMatch(/^_I heard: “show my timetable for tomorrow”_/);
    resetAgentThrottle();
    const typed = await api.post(school.people.STUDENT, '/ai/agent', { message: 'show my timetable for tomorrow' });
    expect(typed.body.data.reply).not.toMatch(/I heard/);
    resetAgentThrottle();
    const write = await api.post(school.people.TEACHER, '/ai/agent', { message: 'apply for casual leave tomorrow for a family function', inputMode: 'voice' });
    expect(write.body.data.reply).toMatch(/^_I heard:/);
    expect(write.body.data.action?.confirmToken).toBeTruthy();
  });
});
