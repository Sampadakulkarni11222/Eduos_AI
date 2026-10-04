import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { Account } from '../src/models/account.model.js';
import { Profile } from '../src/models/profile.model.js';
import { Role } from '../src/models/role.model.js';
import { School } from '../src/models/school.model.js';
import { env, productionConfigProblems } from '../src/config/env.js';
import { mayEchoOtp } from '../src/providers/notification.provider.js';
import {
  requestOtp, requestEmailOtp, verifyEmailOtp, login,
} from '../src/modules/auth/auth.service.js';

/**
 * One-time codes must never leave the server in a production response.
 *
 * render.yaml used to ship ALLOW_DEV_OTP_IN_PRODUCTION=true, which made every
 * OTP request answer with the code itself — account takeover for any known
 * phone or email, and (through the frontend's demo Google exchange) a session
 * for any email with no credential at all. These tests pin the replacement:
 * no switch echoes codes in production, a deployment without a provider still
 * boots and signs people in by password, and a real provider delivers codes.
 */

const PHONE = '+919812345678';
const EMAIL = 'prod.parent@example.test';
const PASSWORD = 'correct horse battery';
const SCHOOL = 'eduos-demo-tenant';

// The settings these tests override, restored after each one.
const OVERRIDDEN = ['NODE_ENV', 'isProd', 'isDev', 'ALLOW_DEV_OTP_IN_PRODUCTION', 'SHOW_OTP_ON_SCREEN', 'SMS_PROVIDER', 'EMAIL_PROVIDER',
  'RESEND_API_KEY', 'EMAIL_FROM', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
let saved;

// The demo opt-in is OFF unless a test turns it on: everything below pins the default.
const asProduction = (extra = {}) => Object.assign(env, { NODE_ENV: 'production', isProd: true, isDev: false, SHOW_OTP_ON_SCREEN: false, ...extra });

beforeEach(async () => {
  saved = Object.fromEntries(OVERRIDDEN.map((k) => [k, env[k]]));
  await School.create({ slug: SCHOOL, name: 'Demo School' });
  const role = await Role.create({ key: 'PARENT', name: 'Parent', permissions: [] });
  const account = await Account.create({
    phoneE164: PHONE, email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
  await Profile.create({ accountId: account._id, roleId: role._id, displayName: 'Prod Parent' });
});

afterEach(() => {
  Object.assign(env, saved);
  vi.unstubAllGlobals();
});

describe('which environments may echo a code', () => {
  it.each(['development', 'test'])('%s may', (nodeEnv) => {
    expect(mayEchoOtp(nodeEnv)).toBe(true);
  });

  it.each(['production', 'staging', '', null])('%s may not', (nodeEnv) => {
    expect(mayEchoOtp(nodeEnv)).toBe(false);
  });
});

describe('production never returns a one-time code', () => {
  it('answers an email OTP request with 503 and no code when no provider is configured', async () => {
    asProduction({ EMAIL_PROVIDER: 'console' });
    await expect(requestEmailOtp({ email: EMAIL, schoolId: SCHOOL }))
      .rejects.toMatchObject({ statusCode: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });
  });

  it('answers a phone OTP request with 503 and no code when no provider is configured', async () => {
    asProduction({ SMS_PROVIDER: 'console' });
    await expect(requestOtp({ phone: PHONE, schoolId: SCHOOL }))
      .rejects.toMatchObject({ statusCode: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });
  });

  it('ignores ALLOW_DEV_OTP_IN_PRODUCTION entirely', async () => {
    asProduction({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console', ALLOW_DEV_OTP_IN_PRODUCTION: true });
    await expect(requestEmailOtp({ email: EMAIL, schoolId: SCHOOL }))
      .rejects.toMatchObject({ statusCode: 503 });
    await expect(requestOtp({ phone: PHONE, schoolId: SCHOOL }))
      .rejects.toMatchObject({ statusCode: 503 });
  });

  it('does not echo a code on a non-production deployment that is not development/test', async () => {
    Object.assign(env, { NODE_ENV: 'staging', isProd: false, isDev: false, EMAIL_PROVIDER: 'console' });
    await expect(requestEmailOtp({ email: EMAIL, schoolId: SCHOOL }))
      .rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('sign-in still works with a production configuration', () => {
  it('delivers the code through Resend, never in the response, and the delivered code signs in', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    asProduction({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'EduOS <no-reply@example.test>' });

    const result = await requestEmailOtp({ email: EMAIL, schoolId: SCHOOL });
    expect(result.devOtp).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/\b\d{6}\b/);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const sent = JSON.parse(init.body);
    expect(sent.to).toEqual([EMAIL]);
    const code = /\b(\d{6})\b/.exec(sent.text)[1];

    const session = await verifyEmailOtp({ email: EMAIL, code, schoolId: SCHOOL }, {});
    expect(session.accessToken).toBeTruthy();
  });

  it('delivers a phone code through Twilio without echoing it', async () => {
    const fetchMock = vi.fn(async () => new Response('{"sid":"SM1"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    asProduction({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550001111' });

    const result = await requestOtp({ phone: PHONE, schoolId: SCHOOL });
    expect(result.devOtp).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/Accounts/AC123/Messages.json');
    expect(String(init.body)).toContain(encodeURIComponent(PHONE));
  });

  it('answers 503 — not "sent" — when the provider rejects the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    asProduction({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'bad', EMAIL_FROM: 'no-reply@example.test' });
    await expect(requestEmailOtp({ email: EMAIL, schoolId: SCHOOL }))
      .rejects.toMatchObject({ statusCode: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });
  });

  it('answers 503 when the provider is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    asProduction({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+15550001111' });
    await expect(requestOtp({ phone: PHONE, schoolId: SCHOOL }))
      .rejects.toMatchObject({ statusCode: 503 });
  });

  it('keeps password sign-in working with no OTP provider at all', async () => {
    asProduction({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
    const session = await login({ email: EMAIL, password: PASSWORD, schoolId: SCHOOL }, {});
    expect(session.accessToken).toBeTruthy();
  });
});

/**
 * SHOW_OTP_ON_SCREEN: the explicit demo opt-in. A deployment that sets it shows
 * codes on the sign-in screen when no provider is configured -- a deliberate,
 * loudly warned choice for demo data. These tests pin its edges: it must be
 * set to exactly 'true' to apply, a real provider is never affected, and the
 * old ALLOW_DEV_OTP_IN_PRODUCTION switch stays ignored.
 */
describe('demo opt-in: SHOW_OTP_ON_SCREEN', () => {
  it('returns the code for on-screen display, and that code signs in', async () => {
    asProduction({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console', SHOW_OTP_ON_SCREEN: true });
    const email = await requestEmailOtp({ email: EMAIL, schoolId: SCHOOL });
    expect(email.devOtp).toMatch(/^\d{6}$/);
    const session = await verifyEmailOtp({ email: EMAIL, code: email.devOtp, schoolId: SCHOOL }, {});
    expect(session.accessToken).toBeTruthy();

    const phone = await requestOtp({ phone: PHONE, schoolId: SCHOOL });
    expect(phone.devOtp).toMatch(/^\d{6}$/);
  });

  it('never shows a code that a real provider delivers', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    asProduction({
      EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'EduOS <no-reply@example.test>', SHOW_OTP_ON_SCREEN: true,
    });
    const result = await requestEmailOtp({ email: EMAIL, schoolId: SCHOOL });
    expect(result.devOtp).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is read only from exactly "true"', async () => {
    const readWith = async (value) => {
      process.env.SHOW_OTP_ON_SCREEN = value;
      vi.resetModules();
      return (await import('../src/config/env.js')).env.SHOW_OTP_ON_SCREEN;
    };
    try {
      for (const value of ['1', 'yes', 'TRUE ', 'false', '']) {
        expect(await readWith(value), JSON.stringify(value)).toBe(false);
      }
      expect(await readWith('true')).toBe(true);
    } finally {
      delete process.env.SHOW_OTP_ON_SCREEN;
      vi.resetModules();
    }
  });

  it('warns loudly at boot while it is on', () => {
    const { fatal, warnings } = productionConfigProblems({
      JWT_SECRET: 'x'.repeat(48), MEDICAL_ENCRYPTION_KEY: 'real-key', WHATSAPP_VERIFY_TOKEN: 'real-token',
      CORS_ORIGIN: 'https://app.example.test', PAYMENT_PROVIDER: 'none',
      SMS_PROVIDER: 'console', EMAIL_PROVIDER: 'console', SHOW_OTP_ON_SCREEN: true,
    });
    expect(fatal).toEqual([]);
    expect(warnings.join(' ')).toMatch(/SHOW_OTP_ON_SCREEN=true .*SHOWN ON THE SIGN-IN SCREEN/);
  });
});

describe('production boot configuration', () => {
  const base = {
    JWT_SECRET: 'x'.repeat(48), MEDICAL_ENCRYPTION_KEY: 'real-key', WHATSAPP_VERIFY_TOKEN: 'real-token',
    CORS_ORIGIN: 'https://app.example.test', PAYMENT_PROVIDER: 'none',
    SMS_PROVIDER: 'console', EMAIL_PROVIDER: 'console', ALLOW_DEV_OTP_IN_PRODUCTION: false,
  };

  it('boots without an OTP provider, warning that OTP sign-in is unavailable', () => {
    const { fatal, warnings } = productionConfigProblems(base);
    expect(fatal).toEqual([]);
    expect(warnings.join(' ')).toMatch(/SMS_PROVIDER=console/);
    expect(warnings.join(' ')).toMatch(/EMAIL_PROVIDER=console/);
  });

  it('warns that ALLOW_DEV_OTP_IN_PRODUCTION is ignored', () => {
    const { warnings } = productionConfigProblems({ ...base, ALLOW_DEV_OTP_IN_PRODUCTION: true });
    expect(warnings.join(' ')).toMatch(/ALLOW_DEV_OTP_IN_PRODUCTION .*IGNORED/);
  });

  it('refuses a chosen provider that is missing its credentials', () => {
    const { fatal } = productionConfigProblems({ ...base, SMS_PROVIDER: 'twilio', EMAIL_PROVIDER: 'resend' });
    expect(fatal).toEqual(expect.arrayContaining([
      expect.stringMatching(/^TWILIO_ACCOUNT_SID/), expect.stringMatching(/^TWILIO_AUTH_TOKEN/),
      expect.stringMatching(/^TWILIO_FROM_NUMBER/), expect.stringMatching(/^RESEND_API_KEY/), expect.stringMatching(/^EMAIL_FROM/),
    ]));
  });

  it('refuses an unknown provider name rather than falling back', () => {
    const { fatal } = productionConfigProblems({ ...base, SMS_PROVIDER: 'msg91' });
    expect(fatal.join(' ')).toMatch(/SMS_PROVIDER=msg91 \(unknown/);
  });

  it('accepts a fully configured provider with no warnings about it', () => {
    const { fatal, warnings } = productionConfigProblems({
      ...base, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.test',
      SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1555',
    });
    expect(fatal).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('still refuses the shipped placeholder secrets', () => {
    const { fatal } = productionConfigProblems({ ...base, JWT_SECRET: 'change-this-secret-in-production' });
    expect(fatal).toContain('JWT_SECRET');
  });
});
