# EduOS AI on Android (Trusted Web Activity)

The Android app is a **Trusted Web Activity (TWA)**: a small Android shell that opens the live EduOS AI website in Chrome, full screen, with no browser bar. There is no second copy of the product inside the app. Everything a user sees is served by the same frontend and backend as the website.

**Status: web-side preparation only.** No Android project has been generated, nothing has been built for Android, and nothing has been tested on a device. The steps that remain need values this repository does not contain (see [Values still to be supplied](#values-still-to-be-supplied)).

## Why a TWA

| Reason | Detail |
| --- | --- |
| The frontend needs its server | Session cookies (`/api/session`), Google sign-in (NextAuth) and the school-domain middleware all run in the Next.js server. The app cannot be exported as static files and bundled into an APK. |
| Google sign-in | Google refuses OAuth inside an embedded WebView. A TWA is Chrome, so sign-in works as it does on the web. |
| One codebase | A release of the website is a release of the app. The Android shell only changes when its name, icon, package or signing changes. |

## What is in the repository

| Path | Purpose |
| --- | --- |
| `frontend/src/app/manifest.ts` | Web app manifest, served at `/manifest.webmanifest`. Bubblewrap generates the Android project from it. |
| `frontend/public/icons/` | Launcher icons: 192 and 512 px, standard and maskable, plus the iOS touch icon. |
| `frontend/scripts/generate-icons.mjs` | Regenerates those icons from the EduOS AI mark. |
| `frontend/src/lib/app-identity.ts` | Theme colour (`#591620`) and splash background (`#F2E4CC`). |
| `frontend/src/app/find-school/` and `components/find-school.tsx` | The school finder, which is the app's start page. |
| `frontend/src/lib/school-lookup.ts` | School-code validation and lookup. |
| `frontend/src/app/.well-known/assetlinks.json/route.ts` | Serves Digital Asset Links from environment variables. Answers 404 until configured. |
| `android/twa-manifest.template.json` | Decided values for the Android shell, with the undecided ones marked `REPLACE_`. |

The generated Android project (`android/app`, Gradle files, `twa-manifest.json`), build outputs and every keystore are gitignored.

## How the app starts

The manifest's `start_url` is `/find-school`, not `/`. `/` sends anyone who is not signed in to the platform sign-in, which only admits Super Admins.

| Visitor | Where `/find-school` sends them |
| --- | --- |
| Signed in | Their own portal |
| Not signed in, school remembered on this device | That school's sign-in screen (`/<school>`) |
| Not signed in, no school remembered | The "Find your school" form |
| Arrives with `?change=1` | The form; the remembered school is forgotten |

The form takes a school code (the slug, such as `oakridge`) or the school's link pasted whole. It resolves the code with the existing public endpoint `GET /api/v1/schools/public/:slug`, which returns a school's name and branding for an exact, active slug. No backend change was needed.

The finder is a lookup, not a search. There is no endpoint that lists schools or matches them by name, and one was deliberately not added: it would publish the platform's customer list. The finder grants no access. It ends at the school's ordinary sign-in screen, and the backend still refuses an account at the wrong school.

Two things to know:

- **School custom domains.** On a school's own domain the middleware redirects `/find-school` to that school's sign-in, because only that school exists there. The app must be built against the platform host.
- **Reserved slugs.** Static routes win over `/<school>`, so a school whose slug is `find-school`, `login`, `super-admin`, `select-profile`, `public`, `api` or `icons` could not be reached. The backend does not reserve these names today (`SLUG_RE` in `backend/src/modules/schools/school.service.js` accepts them). Recommended follow-up: refuse them when a school is created. Not done here, because it changes backend behaviour.

## Values still to be supplied

None of these may be guessed.

| Value | Who decides or where it comes from | Used in |
| --- | --- | --- |
| Production host (platform domain, HTTPS) | Manager / whoever runs the deployment | `bubblewrap init`, `twa-manifest.json`, Play listing |
| Application ID (e.g. `com.company.eduos`) | Manager. Permanent once published. | `twa-manifest.json`, `TWA_PACKAGE_NAME`, Play Console |
| App name and launcher name | Manager (currently "EduOS AI" / "EduOS") | Manifest, `twa-manifest.json`, Play listing |
| Upload keystore: location, alias, passwords | Created with approval, stored outside the repo | `twa-manifest.json` `signingKey`, build prompts |
| SHA-256 of the **app signing** certificate | Play Console → Setup → App integrity, after the first upload | `TWA_SHA256_FINGERPRINTS` |
| SHA-256 of the **upload** certificate | `keytool -list -v -keystore <keystore>` | `TWA_SHA256_FINGERPRINTS`, only if locally built packages are tested |
| Privacy policy URL | Company | Play Console, and it should be linked in the app |
| Reviewer demo account | Company | Play Console → App content → App access |
| Play Console developer account | Company (organisation account recommended) | Everything in Play Console |

Frontend server environment variables added by this work (both optional; the route is a 404 without them):

| Variable | Value |
| --- | --- |
| `TWA_PACKAGE_NAME` | The application ID |
| `TWA_SHA256_FINGERPRINTS` | Comma-separated SHA-256 certificate fingerprints, in `AA:BB:…` form |

They are read at request time, so setting them needs a restart of the frontend but not a rebuild.

## Build requirements

| Tool | Requirement | This machine (13 Oct 2026) |
| --- | --- | --- |
| Node.js | 22 (`.nvmrc`) | 24 installed |
| JDK | 17 | Present (`JAVA_HOME`); `java` on PATH is 23 |
| Android SDK platform | API 36. Play has required new apps to target Android 16 (API 36) since 31 August 2026. | Only API 35 installed |
| Android build-tools | Matching the platform | 35.0.0 and 35.0.1 only |
| SDK command-line tools (`sdkmanager`) | Needed to install API 36 | Not installed |
| Bubblewrap CLI | `npm i -g @bubblewrap/cli` | Not installed |
| Emulator / device | For testing | One API 35 virtual device exists |

Bubblewrap can download its own JDK and SDK on first run, which is the simplest way to satisfy the three missing rows.

## Build steps

These have not been run. They are the documented Bubblewrap flow, adapted to this repository.

1. Deploy this branch's frontend to the production host, so the manifest and icons are live.
2. Check the web side:
   ```bash
   curl -I https://<host>/manifest.webmanifest
   curl -I https://<host>/icons/icon-512.png
   ```
3. Install Bubblewrap and generate the project:
   ```bash
   npm i -g @bubblewrap/cli
   cd android
   bubblewrap init --manifest=https://<host>/manifest.webmanifest
   ```
   Answer its prompts with the values from `twa-manifest.template.json` and the table above. When it asks about a signing key, point it at the approved upload keystore, or let it create one **only with approval**, and keep that file outside the repository.
4. Before building, open the generated `android/twa-manifest.json` and `android/app/build.gradle` and confirm:
   - `fallbackType` is `customtabs` (a WebView fallback breaks Google sign-in),
   - `targetSdkVersion` is 36 or higher. If the installed Bubblewrap generates a lower value, update Bubblewrap; do not ship a lower target.
5. Build:
   ```bash
   bubblewrap build
   ```
   This produces `app-release-bundle.aab` (for Play) and `app-release-signed.apk` (for testing).
6. Publish Digital Asset Links by setting `TWA_PACKAGE_NAME` and `TWA_SHA256_FINGERPRINTS` on the frontend server and restarting it, then check:
   ```bash
   curl https://<host>/.well-known/assetlinks.json
   ```
   With Play App Signing, the fingerprint users' devices verify is Google's app signing key, not the upload key. Until the right fingerprint is published the app still opens, but with a browser bar.
7. Install and test on a device or emulator:
   ```bash
   adb install app-release-signed.apk
   adb logcat | grep -e OriginVerifier -e digital_asset_links
   ```
8. Upload the `.aab` to an internal testing track in Play Console.

## What must be tested on a device

None of this has been verified. Each item is a place where the app could behave differently from desktop Chrome.

| Area | What to check |
| --- | --- |
| Asset links | No browser bar on the platform host |
| Sign-in | Phone OTP, email OTP, Google sign-in (leaves to accounts.google.com and returns) |
| Session | Stays signed in after the app is closed and reopened; the 10-minute inactivity sign-out |
| Back button | Steps back through pages, then leaves the app |
| School finder | New device, returning device, changing school, unknown code |
| Uploads | File pickers, including camera capture for photos |
| Downloads | Receipts, report cards and ID cards, which open as blob URLs in a new tab (`openProtectedFile` in `lib/api.ts`). This is the most likely thing to behave differently on Android. |
| Payments | Razorpay Checkout, including UPI app hand-off and return |
| Voice input | Web Speech API in the assistant |
| Offline | There is no service worker, so the app shows Chrome's offline page with no connection |
| Layout | Small phones (360 px wide), tablets, landscape |
| External links | Open outside the app and return |

## Recommended, not implemented

### Security headers

The frontend sets no security headers. Recommended addition to `frontend/next.config.mjs`, via `headers()`:

| Header | Value | Note |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Production only. Check the reverse proxy does not already send it. |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `X-Frame-Options` | `DENY` | The app does not frame itself (no `<iframe>` in the source). |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=()` | Microphone is used by voice input. Photo upload goes through the system file picker and needs no camera grant. |
| `Content-Security-Policy-Report-Only` | See below | Start report-only, then enforce. |

A content security policy needs care here, so it should be introduced in report-only mode and watched before it is enforced. It has to allow at least: the backend origin (API calls, uploaded images), `checkout.razorpay.com` and `api.razorpay.com` (scripts and frames), `fonts.googleapis.com` and `fonts.gstatic.com`, `blob:` and `data:` images, school logos at arbitrary `https:` URLs, and Next.js inline scripts (which need a nonce or `'unsafe-inline'`).

These were left out of this branch because a wrong value breaks payments or sign-in in production, and that cannot be tested without the live domain.

### Other

- Reserve route names as school slugs in the backend (see above).
- The demo account list still ships as an unreferenced JavaScript chunk in production builds. The page that used it now answers 404. The addresses are the seeded demo accounts already listed in the README.
- A minimal service worker with an offline page would give a better no-connection experience. It is not required for a TWA.

## Google Play: requirements and open questions

Checked against Google's published pages on 13 October 2026. "Confirmed" means the page states it. "Needs a decision" means Google's text does not settle it for this app.

| Topic | Status | Finding |
| --- | --- | --- |
| Target API level | Confirmed | New apps and updates must target Android 16 (API 36). |
| App bundle | Confirmed | Play takes an `.aab`; Bubblewrap produces one. |
| Digital Asset Links | Confirmed | Required for full-screen display; without it the app shows a browser bar. |
| Closed testing | Confirmed | Personal developer accounts created after 13 November 2023 need 12 testers opted in for 14 continuous days before production access. Not stated for organisation accounts. |
| Privacy policy | Confirmed | Required, linked in the listing and inside the app. The app has none today. |
| App access | Confirmed | Reviewers need working sign-in details. OTP and multi-step sign-in must be explained in "Any other instructions". A demo school and accounts that do not depend on a real phone are needed. |
| Data safety form | Confirmed required | Answers must describe what the app actually collects: names, phone numbers, email, student records, attendance, marks, medical records, fee and payment records, uploaded files, AI assistant messages (sent to the configured AI provider). To be completed with the company, not guessed. |
| Target audience / Families | Needs a decision | Students use the app. If children are declared in the target audience, the Families policy applies. Legal input recommended. |
| Account deletion | Needs a decision | Required when users can create an account in the app. Here accounts are created by school administrators. Google's page does not address that case. The Data safety deletion questions must be answered regardless. |
| AI credits (Razorpay) | Needs a decision; high risk | Google lists virtual currencies and in-app digital content as requiring Play Billing. AI credits bought by students and parents fit that description. |
| School fees (Razorpay) | Needs a decision | Google's pages do not mention tuition or school fees. Fees for in-person schooling resemble the "physical services" exemption, but that is an interpretation. |
| Seat purchases by School Admins | Needs a decision | Google lists "business productivity software" under cloud services that require Play Billing. |
| Ads declaration | Confirmed | The source contains no ad SDK; declare "no ads". |
| Content rating | Confirmed | Questionnaire required. |

For the three payment rows the safe options are to ask Google Play support for a determination before submission, or to make those purchases unavailable inside the Android app. Neither has been done: existing payment behaviour is unchanged.
