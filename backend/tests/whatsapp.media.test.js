import { describe, it, expect, afterEach, vi } from 'vitest';

const { env } = await import('../src/config/env.js');
const { downloadWhatsappDocument, downloadMetaMedia, downloadChatflowMedia } = await import('../src/modules/whatsapp/whatsapp.media.js');
const { parseChatflowEvent } = await import('../src/modules/whatsapp/chatflow.inbound.js');

/**
 * p7: WhatsApp media through the provider adapter -- a spreadsheet sent as a
 * document (bulk import) and a voice note -- from both providers. The rule for
 * both: bytes come only from the provider's own hosts, and the provider's
 * credential is never sent anywhere else.
 */

const KEYS = ['WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN', 'CHATFLOW_API_URL', 'CHATFLOW_API_KEY'];
const SAVED = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
afterEach(() => { Object.assign(env, SAVED); });

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } });
const fileResponse = (bytes, length = bytes.length) => ({
  ok: true, status: 200, headers: { get: (h) => (String(h).toLowerCase() === 'content-length' ? String(length) : null) },
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});
const CSV = [...Buffer.from('Title,Author\nRamayana,Valmiki\n')];

const metaLive = () => Object.assign(env, { WA_PHONE_NUMBER_ID: '123', WA_ACCESS_TOKEN: 'meta-token' });
const chatflowLive = () => Object.assign(env, { CHATFLOW_API_URL: 'https://api.chatflow.example/v1', CHATFLOW_API_KEY: 'cf-key' });
const offline = () => Object.assign(env, { WA_PHONE_NUMBER_ID: '', WA_ACCESS_TOKEN: '', CHATFLOW_API_URL: '', CHATFLOW_API_KEY: '' });

describe('a spreadsheet sent as a WhatsApp document', () => {
  it('refuses anything that is not a spreadsheet, before downloading', async () => {
    metaLive();
    const fetchImpl = vi.fn();
    const got = await downloadWhatsappDocument({ id: '42', filename: 'photo.jpg' }, { fetchImpl });
    expect(got.error).toBe('UNSUPPORTED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('simulator: the inline file is honoured only off-live, and labelled simulated', async () => {
    offline();
    const simulatedBase64 = Buffer.from(CSV).toString('base64');
    const got = await downloadWhatsappDocument({ filename: 'books.csv', simulatedBase64 });
    expect(got).toMatchObject({ filename: 'books.csv', simulated: true });
    expect(got.buffer.toString()).toMatch(/Ramayana/);

    metaLive();
    const fetchImpl = vi.fn(async (url) => (String(url).startsWith('https://graph.facebook.com/')
      ? jsonResponse({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=2', mime_type: 'text/csv' })
      : fileResponse(CSV)));
    const live = await downloadWhatsappDocument({ id: '42', filename: 'books.csv', simulatedBase64: Buffer.from('x').toString('base64') }, { fetchImpl });
    expect(live.simulated).toBeUndefined();
    expect(live.buffer.toString()).toMatch(/Ramayana/);
  });

  it('Meta: the media id is looked up and fetched from a Meta host with the token', async () => {
    metaLive();
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url: String(url), auth: init?.headers?.Authorization });
      if (String(url).startsWith('https://graph.facebook.com/')) return jsonResponse({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=2', mime_type: 'text/csv' });
      return fileResponse(CSV);
    };
    const got = await downloadWhatsappDocument({ id: '42', filename: 'books.csv' }, { fetchImpl });
    expect(got).toMatchObject({ filename: 'books.csv', mimeType: 'text/csv' });
    expect(got.buffer.toString()).toMatch(/Ramayana/);
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.auth === 'Bearer meta-token')).toBe(true);
  });

  it('Meta: a media URL on any other host is refused (the token goes nowhere else)', async () => {
    metaLive();
    const fetchImpl = vi.fn(async (url) => (String(url).startsWith('https://graph.facebook.com/')
      ? jsonResponse({ url: 'https://evil.example.com/books.csv' }) : fileResponse(CSV)));
    const got = await downloadWhatsappDocument({ id: '42', filename: 'books.csv' }, { fetchImpl });
    expect(got.error).toBe('DOWNLOAD_FAILED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a file over the importers\' 2 MB limit is refused, by its declared size', async () => {
    metaLive();
    const fetchImpl = async (url) => (String(url).startsWith('https://graph.facebook.com/')
      ? jsonResponse({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'text/csv' })
      : fileResponse(CSV, 3 * 1024 * 1024));
    expect((await downloadWhatsappDocument({ id: '42', filename: 'big.csv' }, { fetchImpl })).error).toBe('TOO_LARGE');
  });

  it('Chatflow: the forwarded URL is fetched from Chatflow\'s API host with its key', async () => {
    chatflowLive();
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url: String(url), key: init?.headers?.['x-api-key'] }); return fileResponse(CSV); };
    const got = await downloadWhatsappDocument({ filename: 'books.csv', chatflowMedia: { url: 'https://api.chatflow.example/media/abc', mimeType: 'text/csv' } }, { fetchImpl });
    expect(got).toMatchObject({ filename: 'books.csv', mimeType: 'text/csv' });
    expect(seen).toEqual([{ url: 'https://api.chatflow.example/media/abc', key: 'cf-key' }]);
  });

  it('Chatflow: any other host, or plain http, is refused without a request', async () => {
    chatflowLive();
    const fetchImpl = vi.fn();
    for (const url of ['https://evil.example.com/books.csv', 'http://api.chatflow.example/media/abc', 'https://api.chatflow.example.evil.com/x']) {
      expect((await downloadWhatsappDocument({ filename: 'books.csv', chatflowMedia: { url } }, { fetchImpl })).error, url).toBe('DOWNLOAD_FAILED');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('nothing is downloaded without live credentials', async () => {
    offline();
    const fetchImpl = vi.fn();
    expect((await downloadWhatsappDocument({ id: '42', filename: 'books.csv' }, { fetchImpl })).error).toBe('NOT_AVAILABLE');
    expect((await downloadWhatsappDocument({ filename: 'books.csv', chatflowMedia: { url: 'https://api.chatflow.example/m' } }, { fetchImpl })).error).toBe('NOT_AVAILABLE');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a Chatflow document event carries the URL and file name, never the bytes', () => {
    const [msg] = parseChatflowEvent({
      event: 'message.received', workspaceId: 'w1',
      data: { message: { id: 'm1', from: '919800000001', type: 'DOCUMENT', mediaUrl: 'https://api.chatflow.example/media/abc', filename: 'books.csv', mimeType: 'text/csv' } },
    });
    expect(msg.type).toBe('document');
    expect(msg.media).toMatchObject({ url: 'https://api.chatflow.example/media/abc', filename: 'books.csv', mimeType: 'text/csv' });
  });
});

describe('a voice note, alongside documents', () => {
  it('Meta and Chatflow voice downloads still work and keep their host rules', async () => {
    metaLive();
    chatflowLive();
    const ogg = [79, 103, 103, 83];
    const meta = await downloadMetaMedia('987654', {
      fetchImpl: async (url) => (String(url).startsWith('https://graph.facebook.com/')
        ? jsonResponse({ url: 'https://lookaside.fbsbx.com/a', mime_type: 'audio/ogg' }) : fileResponse(ogg)),
    });
    expect(meta.audio.toString()).toBe('OggS');
    const cf = await downloadChatflowMedia({ url: 'https://api.chatflow.example/media/v1', mimeType: 'audio/ogg' }, { fetchImpl: async () => fileResponse(ogg) });
    expect(cf).toMatchObject({ mimeType: 'audio/ogg' });
    const fetchImpl = vi.fn();
    expect(await downloadChatflowMedia({ url: 'https://evil.example.com/a.ogg' }, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
