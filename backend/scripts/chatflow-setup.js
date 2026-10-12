/**
 * Chatflow-Pro connection check and webhook registration.
 *
 *   npm run chatflow:check                         verify key, show workspace + numbers
 *   npm run chatflow:webhook -- --origin=https://api.example.com
 *                                                  also register the EduOS webhook URL
 *
 * --origin defaults to WA_CALLBACK_ORIGIN. Registration needs a key with the
 * `webhooks:write` scope; without it, paste the printed URL into Chatflow-Pro →
 * Settings → Webhook instead. Secrets are never printed in full.
 */
import { env, isChatflowLive } from '../src/config/env.js';
import { getIdentity, registerWebhook } from '../src/modules/whatsapp/chatflow.client.js';

const WEBHOOK_PATH = '/api/v1/whatsapp/chatflow/webhook';
const args = process.argv.slice(2);
const register = args.includes('--register');
const origin = (args.find((a) => a.startsWith('--origin='))?.split('=')[1] ?? env.WA_CALLBACK_ORIGIN ?? '')
  .trim()
  .replace(/\/+$/, '');

const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : '(unset)');

async function main() {
  console.log('Chatflow-Pro configuration');
  console.log(`  CHATFLOW_API_URL        ${env.CHATFLOW_API_URL || '(unset)'}`);
  console.log(`  CHATFLOW_API_KEY        ${mask(env.CHATFLOW_API_KEY)}`);
  console.log(`  CHATFLOW_WA_NUMBER_ID   ${env.CHATFLOW_WA_NUMBER_ID || '(unset — Chatflow picks)'}`);
  console.log(`  CHATFLOW_WEBHOOK_TOKEN  ${env.CHATFLOW_WEBHOOK_TOKEN ? 'set' : '(unset)'}`);
  console.log(`  CHATFLOW_WEBHOOK_SECRET ${env.CHATFLOW_WEBHOOK_SECRET ? 'set' : '(unset)'}`);

  if (!isChatflowLive()) {
    console.error('\n✘ Set CHATFLOW_API_URL (…/api/v1/public) and CHATFLOW_API_KEY first.');
    process.exit(1);
  }

  const me = await getIdentity();
  console.log(`\n✔ Key accepted — workspace "${me?.workspace?.name}" (${me?.workspace?.id})`);
  const scopes = me?.apiKey?.scopes;
  console.log(`  scopes: ${scopes == null ? 'all (legacy key)' : scopes.join(', ')}`);
  if (Array.isArray(scopes) && !scopes.includes('messages:send')) {
    console.error('✘ This key lacks messages:send — EduOS cannot reply with it.');
  }
  for (const n of me?.waNumbers ?? []) {
    console.log(`  number ${n.id}  ${n.phoneNumber}  ${n.status}${n.verificationExpired ? '  VERIFICATION EXPIRED' : ''}`);
  }
  if (!me?.waNumbers?.length) console.error('✘ No WhatsApp number is connected to this workspace.');

  if (!origin) {
    console.log(`\nWebhook URL: https://<your-api-origin>${WEBHOOK_PATH}?token=<CHATFLOW_WEBHOOK_TOKEN>`);
  } else {
    const url = `${origin}${WEBHOOK_PATH}${env.CHATFLOW_WEBHOOK_TOKEN ? `?token=${env.CHATFLOW_WEBHOOK_TOKEN}` : ''}`;
    console.log(`\nWebhook URL: ${origin}${WEBHOOK_PATH}${env.CHATFLOW_WEBHOOK_TOKEN ? '?token=<CHATFLOW_WEBHOOK_TOKEN>' : ''}`);
    if (register) {
      if (!env.CHATFLOW_WEBHOOK_TOKEN) console.warn('! CHATFLOW_WEBHOOK_TOKEN is unset — production will refuse to start like this.');
      try {
        await registerWebhook(url);
        console.log('✔ Registered as the Chatflow-Pro workspace webhook.');
      } catch (err) {
        console.error(`✘ Could not register: ${err.message}`);
        if (err.code === 'CHATFLOW_SCOPE') console.error('  The key needs webhooks:write — or paste the URL in Chatflow-Pro → Settings → Webhook.');
        process.exitCode = 1;
      }
    }
  }
  // The workspace's OWN automation answers the same inbound message EduOS does.
  // It is not EduOS and knows nothing about the school: a workspace still
  // carrying a demo agent replied to a teacher's "Yes" with a refusal about
  // selling phones, next to EduOS's own confirmation. EduOS cannot switch it
  // off through the Public API, so anything the key's own profile reveals about
  // it is reported here, and the instruction below is not optional.
  const automation = [];
  const scan = (value, path, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    for (const [key, item] of Object.entries(value)) {
      const where = path ? `${path}.${key}` : key;
      if (/(?:ai|bot|agent|auto[-_ ]?reply|autoreply|chatbot|workflow|welcome|away|keyword)/i.test(key)) {
        const on = item === true || item === 'enabled' || item === 'ACTIVE' || item === 'active'
          || (item && typeof item === 'object' && (item.enabled === true || item.active === true || item.isActive === true));
        if (on) automation.push(where);
      }
      if (item && typeof item === 'object') scan(item, where, depth + 1);
    }
  };
  scan(me?.workspace, 'workspace');
  for (const n of me?.waNumbers ?? []) scan(n, `number ${n.id ?? ''}`.trim());
  if (automation.length) {
    console.error(`\n✘ This workspace has its own automation switched ON: ${automation.join(', ')}.`);
    console.error('  It will answer every WhatsApp message alongside EduOS, with replies that have nothing to do with the school.');
    process.exitCode = 1;
  }

  console.log('\nREQUIRED in Chatflow-Pro: turn OFF this workspace\'s own AI agent, keyword triggers, workflows and welcome/away messages.');
  console.log('  Otherwise every message gets two replies -- one from EduOS, and one from that agent, which is not EduOS and');
  console.log('  will answer about whatever it was configured for (a second, unrelated reply to a "Yes" is this, every time).');
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
