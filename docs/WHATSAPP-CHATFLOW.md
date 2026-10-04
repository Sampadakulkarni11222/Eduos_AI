# WhatsApp Ask AI via Chatflow-Pro

Chatflow-Pro owns the WhatsApp/Meta connection. EduOS receives its
`message.received` webhook, runs the turn through the same Ask AI + MCP path as
the web assistant, and replies through Chatflow-Pro's Public API.

```
WhatsApp → Meta → Chatflow-Pro ──POST message.received──▶ /api/v1/whatsapp/chatflow/webhook?token=…
                                                          │ verify token (+ HMAC if configured)
                                                          │ 200 immediately, process in background
                                                          ▼
                       chatflow.inbound.js  normalise → { messageId, phoneNumber, text, … }
                       whatsapp.service.js  dedupe on messageId (Meta wamid, unique index)
                       whatsapp.agent.js    phone → ERP account/profile/role (live, every turn)
                                            runWithTenant(school) → runAgentSafely(source: WHATSAPP)
                       orchestrator → MCP client → MCP server (authorize, scope, confirm, audit) → ERP
                       chatflow.client.js   POST {CHATFLOW_API_URL}/messages  (x-api-key)
WhatsApp ◀── Meta ◀── Chatflow-Pro ◀──────────────────────┘
```

The Meta webhook (`/api/v1/whatsapp/webhook`) is unchanged and still works;
each message is answered through the provider it arrived from. Conversation
memory is keyed on the phone number, so it carries across both.

## Chatflow-Pro contract used

Taken from Chatflow-Pro's source (`routes/public.routes.js`,
`services/outgoingWebhook.service.js`):

| | |
|---|---|
| Auth | `x-api-key: cfp_…` — workspace-bound, scope `messages:send` |
| Send | `POST /api/v1/public/messages` `{ to, type: "text", body, waNumberId? }` |
| Identity | `GET /api/v1/public/me` |
| Register webhook | `POST /api/v1/public/webhooks` `{ webhookUrl }` (scope `webhooks:write`) |
| Inbound | `{ id, event, workspaceId, sentAt, data: { conversationId, contact, message: { id, type, body, from, timestamp } } }`, header `X-ChatFlow-Signature-256: sha256=HMAC(rawBody, workspace Verify Token)` |

Chatflow's Verify Token defaults to empty and cannot be set over its API, so
the HMAC alone can prove nothing. EduOS therefore also requires a shared
`?token=` in the registered URL (`CHATFLOW_WEBHOOK_TOKEN`), and production
refuses to boot without it once Chatflow is live.

## Setup

1. Set `CHATFLOW_API_URL`, `CHATFLOW_API_KEY`, `CHATFLOW_WEBHOOK_TOKEN`
   (`openssl rand -hex 24`), optionally `CHATFLOW_WA_NUMBER_ID` and
   `CHATFLOW_WEBHOOK_SECRET`. See `backend/.env.example`.
2. `npm run chatflow:check` — confirms the key, scopes and connected numbers.
3. `npm run chatflow:webhook -- --origin=https://<eduos-api-origin>` — or paste
   `https://<eduos-api-origin>/api/v1/whatsapp/chatflow/webhook?token=<CHATFLOW_WEBHOOK_TOKEN>`
   into Chatflow-Pro → Settings → Webhook.
4. In Chatflow-Pro, turn off the workspace's own AI agent, keyword triggers,
   workflows and welcome/away messages, or users get two replies.
5. Each WhatsApp user's number must be the `phoneE164` on their EduOS account.

Tests: `npx vitest run tests/whatsapp.chatflow.test.js`.
