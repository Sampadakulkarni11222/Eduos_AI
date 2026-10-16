# Connecting ad platforms and social networks

EduOS talks to Meta (Facebook Pages, Instagram, Meta Ads), Google (Google Ads, Analytics 4, YouTube),
LinkedIn (organisation page, Campaign Manager) and X through their **official APIs**, using OAuth: the
school signs in on the provider's own page and approves the permissions; EduOS never sees a password.

There are two steps, done by two different people:

1. **The platform administrator** (whoever runs this EduOS installation) registers one app per provider and
   puts its client id and secret in the server's environment. This is done once for every school.
2. **A school administrator** opens *Marketing → Ad connectors* (ads) or *Community → Social Publishing →
   Accounts* (posting) and presses **Connect** for each provider, then chooses which ad account, Page or
   organisation the school uses.

Until step 1 is done for a provider, its card says *"App not configured · Simulated"* and nothing can be
connected. Until step 2 is done, ad figures come from CSV imports and every social send is recorded as
**"Simulated — not posted"**. Nothing ever claims success that did not happen.

> Status: built and tested against the providers' documented API shapes (requests are stubbed in the test
> suite). It needs live verification with real app credentials before it is relied on.

---

## The redirect URL (all providers)

Every provider app is registered with the same redirect (callback) URL:

```
https://<your EduOS web address>/oauth/callback
```

By default this is `PUBLIC_WEB_URL` (or the first `CORS_ORIGIN`) followed by `/oauth/callback`. Set
`INTEGRATIONS_REDIRECT_URI` to override it. The address must be the one people sign in at (the sign-in session
and the browser tab's connection nonce live on that origin): a school on its own custom domain connects
accounts from the platform address.

The connection `state` is random, stored only as a hash, bound to the school, the person and the browser tab,
valid for ten minutes and usable once. Google and X also use PKCE (S256).

## Server environment

| Variable | What it is |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | The Meta app (developers.facebook.com) |
| `META_WEBHOOK_VERIFY_TOKEN` | Any random string; also typed into the Meta app's Webhooks settings |
| `META_GRAPH_VERSION` | Optional, default `v21.0` |
| `GOOGLE_APP_CLIENT_ID`, `GOOGLE_APP_CLIENT_SECRET` | A Google Cloud OAuth client (type *Web application*) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | From the Google Ads API Center of a manager account; needed only for Google Ads/YouTube ad metrics |
| `GOOGLE_ADS_API_VERSION` | Optional, default `v21` |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | The LinkedIn app (linkedin.com/developers) |
| `LINKEDIN_API_VERSION` | Optional, `YYYYMM`, default `202409` |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | The X app's OAuth 2.0 client (developer.x.com), confidential client |
| `INTEGRATIONS_REDIRECT_URI` | Optional, see above |
| `PUBLIC_API_URL` | Public https address of the API, so Meta can fetch a stored photo for Instagram/Facebook (a short-lived signed link is used) |
| `MEDICAL_ENCRYPTION_KEY` | Already required: tokens are encrypted with it (AES-256-GCM) |

Restart the API after changing them. Secrets are read from the environment only and never shown on screen.

## Meta (Facebook Pages, Instagram, Meta Ads, lead ads)

1. developers.facebook.com → *Create app* → type *Business*. Add the products **Facebook Login for Business**,
   **Marketing API**, **Instagram Graph API** and **Webhooks**.
2. Facebook Login → Settings → *Valid OAuth Redirect URIs*: the redirect URL above.
3. Permissions EduOS asks for:
   - ads: `ads_read`, `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `business_management`
   - posting: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `read_insights`, `business_management`

   Outside development mode these need Meta's App Review (and Business Verification).
4. Lead ads webhook (optional): Webhooks → *Page* → subscribe to `leadgen` with callback URL
   `https://<API address>/api/v1/public/integrations/meta/webhook` and the verify token `META_WEBHOOK_VERIFY_TOKEN`.
   Meta signs each delivery with the app secret (`X-Hub-Signature-256`); EduOS verifies it, finds the school
   by the Page id, fetches the lead's answers from Graph with that Page's token, and creates the enquiry (a
   repeat delivery of the same lead id is recognised). The school must also subscribe its Page to the app
   (Meta Business Suite → Integrations / Leads Access).
5. Instagram posting needs an Instagram **professional** account linked to the chosen Facebook Page, and every
   post needs a photo at a public https address (JPEG).

Tokens: Meta has no refresh tokens. EduOS exchanges the login for a long-lived token (about 60 days) and
extends it automatically in its last week while it is still valid; Page tokens derived from it do not expire.
If it lapses the card shows *Needs reconnecting*.

## Google (Google Ads, Analytics 4, YouTube)

1. console.cloud.google.com → a project → enable **Google Ads API**, **Google Analytics Data API**,
   **Google Analytics Admin API** and **YouTube Data API v3**.
2. *OAuth consent screen*: External, add the scopes below; publish (Google verification is required for
   `adwords` outside testing).
3. *Credentials → Create OAuth client ID → Web application*; authorised redirect URI: the redirect URL above.
4. Google Ads: apply for a **developer token** (Basic access) in the API Center of a manager account and set
   `GOOGLE_ADS_DEVELOPER_TOKEN`. If the school's account sits under a manager account, choose it as the
   login customer on the card.

Scopes: `https://www.googleapis.com/auth/adwords`, `https://www.googleapis.com/auth/analytics.readonly`
(ads); `https://www.googleapis.com/auth/youtube.readonly` (YouTube channel). Access tokens last an hour and are
refreshed automatically with the refresh token.

**YouTube posting:** YouTube has no public API for community posts. A post sent to YouTube is marked
*"Not supported by this network"* and is never faked. Video upload is not offered from EduOS. YouTube **ad**
metrics come from Google Ads (video campaigns).

## LinkedIn (organisation page, Campaign Manager)

1. linkedin.com/developers → *Create app*, associated with the school's LinkedIn Page (a Page admin verifies it).
2. Products: **Community Management API** (organisation posts) and **Advertising API** (ad reporting); both
   need LinkedIn's approval.
3. Auth → *Authorized redirect URLs*: the redirect URL above.

Scopes: `r_organization_social`, `w_organization_social`, `rw_organization_admin` (posting);
`r_ads`, `r_ads_reporting` (ads). Access tokens last 60 days; refresh tokens are used when LinkedIn has enabled
them for the app, otherwise the card asks to reconnect when the token expires.

## X (posts)

1. developer.x.com → a Project and App → *User authentication settings*: OAuth 2.0, type **Web App
   (confidential client)**, permissions *Read and write*, callback URI: the redirect URL above.
2. Copy the OAuth 2.0 Client ID and Client Secret into `X_CLIENT_ID` / `X_CLIENT_SECRET`.
3. Posting needs an X API plan that allows writing posts.

Scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`. Access tokens last two hours and are
refreshed automatically (X rotates the refresh token each time; EduOS refreshes one at a time).

---

## What happens after connecting

**Ad sync.** *Sync now* on a connector card (or the assistant: "sync ad data now") pulls daily campaign spend,
impressions, clicks, leads and conversions for the chosen account:

| Connector | API |
|---|---|
| Meta Ads | Marketing API insights, `level=campaign`, `time_increment=1` |
| Google Ads | Google Ads API `googleAds:searchStream` (GAQL), non-video campaigns |
| YouTube ads | the same, video campaigns |
| Google Analytics 4 | Data API `runReport`: sessions and key events by session campaign (no spend) |
| LinkedIn | `adAnalytics` pivoted by campaign, daily |

Rows are one per platform + day + campaign. Re-syncing replaces those days (never doubles; a renamed campaign's
old rows for the synced days are removed); a CSV import of the same day and campaign is replaced too. The
range is fetched in seven-day windows: if one window fails the others are kept and the card shows a partial
sync with the problems. Rate limits are retried with backoff. Each card shows *last synced*, the range and any
problem. With the school feature **"Live ad-platform sync"** switched on (Tenant Settings → Features), the
scheduler syncs the last three days every six hours; without a connected account it makes no request at all.

**Posting.** Social Publishing posts each network once per post (a delivered post is never sent again; a failed
one can be retried). Every pictured child's public media consent is re-checked at the moment of posting.
Limits are respected: X 280 characters (a link counts as 23), Instagram a photo and 2,200 characters with at
most 30 hashtags, LinkedIn 3,000, Facebook 63,206. A person's own text that is too long is refused when the
post is written; a shared newsroom story is shortened to fit with "…". The network's post id and link are
stored, and likes/comments/shares are read back every six hours for 30 days (or with *Refresh engagement*).

**Disconnect** revokes the access at the provider where it offers revocation (Meta, Google, LinkedIn, X) and
always deletes the stored tokens. Synced figures stay.

## Security notes

- Requests go only over HTTPS to the official API hosts (`graph.facebook.com`, `googleads.googleapis.com`,
  `analyticsdata.googleapis.com`, `analyticsadmin.googleapis.com`, `www.googleapis.com`, `oauth2.googleapis.com`,
  `api.linkedin.com`, `www.linkedin.com`, `api.x.com`); every other host, plain http, credentials in a URL and
  redirects are refused, including a "next page" link a provider returns. Each call has a timeout and size cap.
- Account ids chosen on the cards must be ones the provider listed for the connected account.
- Tokens are encrypted at rest, sent only in the `Authorization` header, never returned to the browser and
  never written to logs or error messages.
- Webhooks are verified with `X-Hub-Signature-256` (HMAC-SHA256 of the exact body) in constant time.
