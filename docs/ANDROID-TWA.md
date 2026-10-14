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
| `frontend/security-headers.mjs` | Response headers for production, including the report-only content security policy. |
| `backend/src/modules/schools/school.slug.js` | School slug rule and the route names a school may not take. |
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
- **Reserved slugs.** Static routes win over `/<school>`, so a school whose slug is `find-school`, `login`, `super-admin`, `select-profile`, `public`, `api` or `icons` could not be reached. The backend now refuses these when a school is created or renamed (`backend/src/modules/schools/school.slug.js`). A school that already has one of these names is not touched; whether any exists in production has not been checked.

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

Bubblewrap 1.27.0 generates a project with `compileSdkVersion` and `targetSdkVersion` 36, which is what Play requires for new apps since 31 August 2026. It needs JDK 17 exactly and build-tools 36.1.0.

| Tool | Requirement | This machine (13 Oct 2026) |
| --- | --- | --- |
| Node.js | 18 or newer for Bubblewrap; 22 for the project (`.nvmrc`) | 24 |
| JDK | 17 exactly | Temurin 17.0.20.1 at `%USERPROFILE%.jdksjdk-17.0.20.1+1`. The system `JAVA_HOME` points at a JDK 17 folder that does not exist; JDK 21 and 23 are installed but Bubblewrap rejects them. |
| Android SDK platform | API 36 | Installed (`platforms;android-36`) |
| Android build-tools | 36.1.0 | Installed (also 36.0.0) |
| SDK command-line tools | `sdkmanager` | Installed, version 22.0 |
| Bubblewrap CLI | 1.27.0 | Installed for the current user |
| Emulator | For testing | One API 35 virtual device. Enough to test on; an API 36 image is not installed. |

`bubblewrap doctor` passes. Two things were needed to get there, and both are per-user and reversible:

- `%USERPROFILE%.bubblewrapconfig.json` names the JDK 17 and SDK paths above.
- Bubblewrap looks for `sdkmanager` at `<sdk>	oolsin`, the old SDK layout. A directory junction `<sdk>	ools` → `<sdk>cmdline-toolslatest` satisfies it. Remove it with `rmdir "%LOCALAPPDATA%AndroidSdk	ools"`.

To reproduce on another Windows machine:

```powershell
# SDK command-line tools: unzip Google's commandlinetools-win zip to <sdk>cmdline-toolslatest, then
sdkmanager "platforms;android-36" "build-tools;36.1.0"
cmd /c mklink /J "$env:LOCALAPPDATAAndroidSdk	ools" "$env:LOCALAPPDATAAndroidSdkcmdline-toolslatest"
# JDK 17: unzip a Temurin 17 JDK anywhere, then
npm i -g @bubblewrap/cli
bubblewrap updateConfig --jdkPath <jdk-17-folder> --androidSdkPath "$env:LOCALAPPDATAAndroidSdk"
bubblewrap doctor
```

## Build steps

These have not been run. They are the documented Bubblewrap flow, adapted to this repository.

1. Deploy this branch's frontend to the production host, so the manifest and icons are live.
2. Check the web side:
   ```bash
   curl -I https://<host>/manifest.webmanifest
   curl -I https://<host>/icons/icon-512.png
   ```
3. Generate the project:
   ```bash
   cd android
   bubblewrap init --manifest=https://<host>/manifest.webmanifest
   ```
   Answer its prompts with the values from `twa-manifest.template.json` and the table above. When it asks about a signing key, point it at the approved upload keystore, or let it create one **only with approval**, and keep that file outside the repository.
4. Before building, open the generated `android/twa-manifest.json` and `android/app/build.gradle` and confirm:
   - `fallbackType` is `customtabs` (a WebView fallback breaks Google sign-in),
   - `targetSdkVersion` is 36 or higher (Bubblewrap 1.27.0's template sets 36).
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

## Security headers

Set for every page in production by `frontend/security-headers.mjs`, through `headers()` in `next.config.mjs`.

| Header | Value | Enforced |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Yes |
| `X-Frame-Options` | `DENY` | Yes. No page of the portal is framed by another (there is no `<iframe>` in the source). If a school embeds a portal page in its own website, that embed will stop working. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Yes |
| `Permissions-Policy` | `geolocation=()` | Yes. Microphone is left alone because voice input uses it. |
| `Content-Security-Policy-Report-Only` | See the file | **No.** The browser logs violations and blocks nothing. |

The content security policy is report-only on purpose. A wrong policy breaks Razorpay Checkout or Google sign-in, and neither can be exercised without the live domain. Watch the browser console on production through a sign-in and a payment; when it stays quiet, rename the header to `Content-Security-Policy`.

`Strict-Transport-Security` is not set by the frontend. It belongs on the reverse proxy that terminates TLS.

## Findings that need a decision or a device

### Protected downloads

Receipts, report cards and ID cards are fetched with the access token and opened with `window.open(blobUrl, '_blank')` (`openProtectedFile` in `lib/api.ts`). Two things can go wrong on Android, and neither can be settled from the source:

- The `window.open` call runs after the download finishes. On a slow connection that can fall outside the tap that started it, and Chrome then treats it as a pop-up and blocks it.
- A new tab holding a `blob:` PDF may open outside the app, or download with a generated file name, depending on the Chrome version.

The robust alternative is to save the file with a real name (`<a download>`) on Android. That changes what desktop users see today, so it was not changed. Test on a device first.

### Inactivity sign-out

The limit is 10 minutes, set at build time by `NEXT_PUBLIC_INACTIVITY_MINUTES` (1 to 120). It can be lengthened without a code change. It was not changed.

It does not behave as a strict limit on a phone, which matters for whichever value is chosen:

- If Android closes the app in the background, reopening it signs the user straight back in from the refresh cookie, however long they were away. The idle clock lives in page memory and starts again.
- If the app is only paused, returning to it fires both "tab is visible again" (which counts as activity) and the overdue idle timer. Which runs first is not guaranteed, so the same absence can end in either a sign-out or a renewed session.

If the 10 minutes is a school security requirement, it needs a server-side idle limit to be reliable. If it is a convenience default, a longer value suits a phone better.

### Other

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
