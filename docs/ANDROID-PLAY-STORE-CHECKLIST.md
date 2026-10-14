# EduOS AI: Android and Play Store checklist

Status on 13 October 2026, branch `feature/eduos-android-twa`. Local only: not pushed, not merged, not deployed.

**No Android app exists yet.** The website is prepared for one and the build tools are installed, but no Android project has been generated and no APK or AAB has been built. Generating it needs four things this repository does not have: the production host, the application ID, confirmation of the app name, and approval to create a signing key.

Technical background is in [ANDROID-TWA.md](ANDROID-TWA.md). This document is the working checklist.

## 1. Completed

| Area | Done | How it was checked |
| --- | --- | --- |
| Web manifest | `/manifest.webmanifest`, start page `/find-school` | Served by a local production build; unit tests |
| Launcher icons | 192 and 512 px, standard and maskable; iOS touch icon | Served by a local production build; viewed |
| Theme colour and viewport | `#591620`, explicit viewport | Present in the served HTML |
| School finder | `/find-school`, using the existing public school endpoint | Unit tests only. Not viewed in a browser or on a phone. |
| Digital Asset Links route | `/.well-known/assetlinks.json`, 404 until configured | Local production build, with and without test values |
| Mock Google chooser | 404 in production; not in the production bundle | Local production build; searched the build output |
| Loading screen branding | Shows "E" | Source |
| Reserved school slugs | Refused on create and rename | Backend tests; a frontend test compares the list with the real routes |
| Security headers | Four enforced, content security policy report-only | Present in the served response headers |
| Sign-out after Google sign-in | Ends the NextAuth session as well as the EduOS one | Reproduced before the fix, regression tests after. Not tested against real Google sign-in. |
| Android build tools | JDK 17, SDK command-line tools, API 36, build-tools 36.1.0, Bubblewrap 1.27.0 | Each tool run; `bubblewrap doctor` passes |

## 2. Test results

Run locally on 13 October 2026. No CI run exists for this branch: CI runs on GitHub when a branch is pushed, and the branch has not been pushed.

| Check | Command | Result |
| --- | --- | --- |
| Frontend typecheck | `npm run typecheck` | Pass |
| Frontend lint | `npx next lint --dir src --max-warnings 0` | Pass |
| Frontend production build | `npm run build` | Pass |
| Frontend tests, four workers | `npx vitest run --maxWorkers=4` | Pass: 460 of 460, 33 files, none skipped (latest run, after the installable-app change) |
| Frontend tests, default workers | `npm test` | Not re-run since the latest changes. Earlier runs on this laptop had one or two 5-second timeouts with twelve workers; see below. |
| Backend lint | `npx eslint src scripts --ext .js --max-warnings 20` | Pass: 0 errors, 20 warnings (the CI cap) |
| Backend build | `npm run build`, then `node --check dist/app.js` | Pass |
| Backend tests | `npm test` | Not complete. A run on the current code was stopped by the system for low memory after 1,047 tests, all passing. The last complete run (before the sign-out fix, which changed no backend code) passed 3,963 of 3,970; the 7 failures were in one file during a laptop sleep and that file passes alone (312 of 312). |

No test is skipped in either suite.

**Frontend timeouts, two causes.**

1. *A slow test, fixed.* Rendering 2,500 rows took 40 ms, but one `getAllByRole` query over them took 3.5 seconds of a 5-second limit. The large-count cases in `expandable-result.test.tsx` now select the same elements by tag, with the same assertions. The smaller cases keep their role queries.
2. *This machine, not fixed.* With the default settings Vitest starts twelve workers here, on a laptop with about 2 GB of free memory. The first test in a file then sometimes takes more than 5 seconds; `user-guides.test.tsx` is the usual one, and it takes 0.6 seconds alone. Limited to four workers, the suite passed in full three times in a row. GitHub's runners have four cores, so CI should behave like the four-worker runs, but that is an expectation until CI has run.

No timeout was raised and no assertion was changed.

## 3. Technical blockers

| Blocker | Needed from |
| --- | --- |
| Production HTTPS host | Manager |
| Application ID (permanent once published) | Manager |
| App name confirmation ("EduOS AI", launcher "EduOS") | Manager |
| Upload keystore | Manager approval, then created locally |
| This branch deployed to the production host | Whoever deploys. Bubblewrap reads the live manifest. |
| Gradle build never run on this machine | Happens at the first `bubblewrap build` |
| Nothing tested on a device | After the first build |

## 4. Open findings

Each of these was found by reading the code. None has been reproduced on a device or against a live server.

### 4.1 Signing out did not end a Google session (fixed on this branch)

**What was wrong.** "Continue with Google" returns through NextAuth, whose session cookie carried the EduOS tokens back to the sign-in screen and then kept them for 30 days. The sign-in screen signed in with whatever tokens it found there, and signing out of EduOS never cleared that cookie.

**Reproduced locally**, with an in-memory database and mocked Google sign-in:

- After sign-out the backend still accepts the access token until it expires (15 minutes). It revokes the refresh tokens, but the access token is not checked against a session.
- With the old code, opening the school's sign-in page after signing out went straight back into the portal.
- With the old code, every later visit to the sign-in page wrote the original refresh token back over the current one. The backend treats a replaced token as stolen and ends every session on the account, so a signed-in Google user who revisited their school's address could be signed out everywhere a little later.
- A refused Google sign-in ("no account is linked") was shown again on every visit for 30 days.

Phone and email OTP sign-in do not use NextAuth and did not have the problem on their own. They were affected when the same browser had an earlier Google sign-in.

**The fix**, in `sign-in.tsx`, `lib/auth.tsx` and the NextAuth route:

- The sign-in screen takes the tokens out of the NextAuth session once and ends that session immediately.
- Signing out ends the NextAuth session too.
- The NextAuth session now lasts 5 minutes instead of 30 days, as a backstop.

Google sign-in, OTP sign-in, profile selection and the EduOS session itself are unchanged. Eight regression tests cover it (`frontend/tests/google-sign-out.test.tsx`); five of them fail on the old code.

**Not covered.** This has not been tested against real Google sign-in, which needs the OAuth client and a deployed host. The 15-minute life of an access token after sign-out is unchanged: nothing in the browser holds it after signing out, but a copy taken beforehand would still work until it expires. Closing that needs a server-side session check, which is a larger change and a product decision.

### 4.2 Protected downloads

Receipts, report cards and ID cards open as a `blob:` URL in a new tab after the file has downloaded. On Android, Chrome may block that as a pop-up on a slow connection, or open it outside the app. Not changed, because the fix alters what desktop users see. Test on a device first.

### 4.3 Inactivity sign-out

The 10-minute limit is not reliable on a phone. If Android closes the app in the background, reopening it signs the user back in from the cookie however long they were away. The value is set by `NEXT_PUBLIC_INACTIVITY_MINUTES` at build time. Not changed.

### 4.4 `X-Frame-Options: DENY`

Now sent on every page. Nothing in the source or the docs describes a school embedding a portal page in its own website, and the portal has no embed feature. If any school does embed one, for example the public announcements page, that embed will stop working. Confirm with whoever handles school onboarding before deploying. The header is one line in `frontend/security-headers.mjs`.

### 4.5 Existing schools with a reserved slug

The new rule applies when a school is created or renamed. It does not touch existing schools, and the production database has not been queried. Someone with read access should run this once:

```js
db.schools.find(
  { slug: { $in: ['api', 'find-school', 'icons', 'login', 'public', 'select-profile', 'super-admin'] } },
  { slug: 1, name: 1 }
)
```

Any school it returns is already unreachable at its own address and needs `npm run schools:rename`.

`backend/scripts/migrate-to-schools.js` creates schools from legacy data without this check. It is a one-off migration script and was left alone.

### 4.6 Content security policy

Report-only is the right setting for now: it blocks nothing and logs what it would block. Two limits to know:

- No `report-uri` is set, so violations appear only in the browser console of whoever is looking. Someone has to open the console on production during a sign-in and a payment.
- It allows inline scripts and styles, which the portal relies on. It will limit where scripts load from, not stop an inline injection.

### 4.7 What the school finder exposes

The finder calls `GET /api/v1/schools/public/:slug`, which the school sign-in page already called. For an exact, active slug it returns the school's name, logo, favicon, tagline and theme colours. It returns nothing about people or records, and there is no listing or search.

It does let anyone test whether a given slug is a school, and tell a suspended school (403) from a missing one (404). That was already true before the finder. The only limit is the general API limit of 2,000 requests per 15 minutes per address.

### 4.8 Sign-in compatibility with a TWA

| Method | Expected in a TWA | Why |
| --- | --- | --- |
| Phone and email OTP | Works as on the web | Ordinary same-site requests. Needs a real SMS or email provider in production. |
| Google sign-in | Works, with a browser bar while on Google's pages | A TWA is Chrome, so Google allows it. Needs `NEXTAUTH_URL` and the Google OAuth redirect URI set for the production host, as the website already does. |
| Session refresh | Works as on the web | The refresh cookie is first-party and lives in Chrome's storage. |

All three are expectations from the design, not test results.

## 4A. Changes that alter production behaviour

Everything on this branch takes effect only when it is deployed. These are the changes an existing user or integration could notice.

| Change | Why | Who it could affect | Backward-compatible | How to test | Approval |
| --- | --- | --- | --- | --- | --- |
| `X-Frame-Options: DENY` on every page | Stops another site framing the portal to trick a signed-in user into clicking (clickjacking) | Any school that embeds a portal page in its own website. None is documented and the portal has no embed feature. | Yes, unless such an embed exists | Load a portal page inside an `<iframe>` on another origin: it must refuse | **Yes.** Confirm with whoever onboards schools. |
| Reserved school slugs | A static route wins over `/<school>`, so a school called `login` or `api` was created and then unreachable | Super Admins creating or renaming a school with one of seven names | Yes for existing schools, which are not touched. A new school can no longer take those names. | Backend tests; try creating a school called `login` | **Yes**, and run the query in 4.5 first |
| School finder at `/find-school` | The installed app needs a first screen that school users can use | Anyone following the new links on the sign-in screens | Yes. `/` and `/login` behave as before. | Unit tests; open `/find-school` and enter a school code | No |
| Content security policy, report-only | To learn what a real policy would block before enforcing one | Nobody: the browser logs and blocks nothing | Yes | Open the browser console on production during sign-in and payment | No. Enforcing it later needs approval. |
| Other security headers (`nosniff`, referrer policy, no geolocation) | Standard hardening | Other sites receive only the origin as referrer, not the full path. Nothing in the portal uses geolocation. | Yes | Check the response headers | No |
| Mock Google page is a 404 in production | It was a public page drawn to look like Google's account chooser, listing demo accounts | Nobody: it could not sign anyone in | Yes. Development is unchanged. | `curl -I https://<host>/login/google-mock-auth` returns 404 | No |
| Sign-out ends the NextAuth session; that session lasts 5 minutes | Section 4.1 | Google sign-in users. A sign-in left for more than 5 minutes between Google and the portal has to be started again. | Yes | Regression tests; on a deployed host, sign in with Google, sign out, reopen the school's address | **Yes**: it is a change to authentication code |
| Dockerfile copies `public/` and `security-headers.mjs` | The image would otherwise lack the icons, and fail to start because `next.config.mjs` imports the headers file | Docker deployments only | Yes | `docker build` and run the image. **Not tested: Docker is not installed on this machine.** | No, but test before relying on the image |

## 4B. Before this branch is deployed

1. Push the branch and let CI run; fix anything it finds.
2. Review and approve the three items marked **Yes** above.
3. Run the reserved-slug query (section 4.5) against production, read-only.
4. If the Docker image is how production runs, build and start it once.
5. Confirm `PLATFORM_APP_HOSTS`, `NEXTAUTH_URL` and `NEXT_PUBLIC_BACKEND_URL` are set for the production host.
6. Deploy, then check `/manifest.webmanifest`, `/icons/icon-512.png`, `/find-school` and the response headers on the live site.
7. Sign in with Google on the live site, sign out, and reopen the school's address: it must show the sign-in screen.

Deployment has not been authorised and nothing has been deployed.

## 5. Manager decisions

Google's wording is quoted from its Play Console Help pages as read on 13 October 2026.

| # | Decision | What Google says | Options |
| --- | --- | --- | --- |
| 1 | **AI credits** bought by students and parents through Razorpay | In-app "digital items (such as virtual currencies…)" require Play's billing system. Virtual currencies may only be used in the app they were bought for. | (a) Hide the purchase in the Android app. (b) Integrate Play Billing. (c) Enrol in Google's alternative billing programme for India, which still requires offering Play Billing alongside and reporting transactions. (d) Ask Google for a ruling first. |
| 2 | **School fees** through Razorpay | Not mentioned. Physical goods and "physical services" must not use Play Billing. Education *subscriptions* are listed as requiring it. | (a) Treat fees for in-person schooling as a physical service, accepting the risk. (b) Ask Google first. (c) Hide fee payment in the Android app. |
| 3 | **Seat purchases** by School Admins | "Cloud software and services (such as… business productivity software)" require Play Billing. | Same as decision 1. Hiding it in the app is simplest: admins can buy seats on the website. |
| 4 | **Privacy policy** | Required for apps handling sensitive data or targeting children. It must be an active URL, be about this app, and be linked in the listing and inside the app. | Decide who writes it, who approves it, and where it is hosted. A link in the app is a small change once the URL exists. |
| 5 | **Data safety form** | Declare each data type the app sends off the device, why, whether it is shared, and whether users can request deletion. Service providers acting on the developer's instructions are not "sharing". | Name someone who can confirm the facts in section 6. |
| 6 | **AI provider** | Not addressed directly. The service-provider test applies. | Confirm which provider production uses and whether its terms keep it a service provider (no use of the data for its own purposes). |
| 7 | **Student age groups** | Target ages 5 and under, 6–8 and 9–12 are "considered to include children in most locales". An app with children in its audience must meet the Families policy. | State which ages use the app. If under-13s do, the Families policy applies. Legal advice is recommended. |
| 8 | **Account deletion** | Required when users can create an account in the app. Accounts created by an administrator are not addressed. The deletion questions in the Data safety form must be answered either way. | Define how a user asks for deletion, who actions it, and what is retained. Provide a web page for the request. |
| 9 | **Reviewer credentials** | Required when any part of the app needs sign-in. OTP and multi-step sign-in must be explained. Up to five sets. | Create a demo school with accounts for the main roles that a reviewer can use without a real phone. |
| 10 | **Play Console account** | Personal accounts created after 13 November 2023 need a closed test with 12 testers opted in for 14 continuous days before production. Alternative billing requires a business account. | Confirm whether an account exists and its type. An organisation account is recommended. |
| 11 | **Application ID and name** | The ID cannot be changed after publishing. | Choose the ID, in reverse-domain form using a domain the company controls, and confirm the name. |
| 12 | **Signing key** | New apps use Play App Signing: Google holds the app signing key, the developer holds an upload key. A lost upload key can be reset through Play Console. | Approve creating the upload key. Decide where the file and its passwords are kept (a password manager or secrets vault, with a backup, never the repository). |
| 13 | **Sign-out fix** (section 4.1) | — | Implemented on the branch. Review it before merge. Decide separately whether access tokens should stop working at sign-out, which needs a server-side check. |
| 14 | **Inactivity limit** (section 4.3) | — | Keep 10 minutes, lengthen it, or ask for a server-side limit. |
| 15 | **Frame blocking** (section 4.4) | — | Confirm no school embeds portal pages. |

## 6. Data the app handles

This is what the source code shows the product stores or transmits. It is the starting point for the Data safety form, not the completed form. Retention, sharing and the production configuration have to be confirmed by the company.

| Data | Where it appears in the product | Data safety category |
| --- | --- | --- |
| Name | Accounts and profiles | Personal info › Name |
| Email address | Sign-in, profiles | Personal info › Email address |
| Phone number | Sign-in, profiles, WhatsApp assistant | Personal info › Phone number |
| Student records: class, attendance, marks, timetable, leave | Core product | To be classified with the company (likely Personal info › Other info) |
| Medical records | Medical module, encrypted at rest | Health and fitness › Health info |
| Fee invoices, payments, receipts | Fees module | Financial info › Purchase history |
| Card or UPI details | Entered in Razorpay's own checkout; the app does not receive them | Generally not declared, per Google's guidance |
| Profile photos | Student profile | Photos and videos › Photos |
| Uploaded documents and assignments | Uploads | Files and docs |
| Assistant and tutor messages | Sent to the configured AI provider | Messages › Other in-app messages |
| Tickets and announcements | Support and communication | App activity › Other user-generated content |
| Voice input | Processed by the browser's speech service, not stored by the app | To be confirmed |

No advertising or analytics SDK is present in the source.

## 7. Environment configuration

No secrets belong in this document or in the repository.

**Frontend server**, set at deployment:

| Variable | Purpose | Status |
| --- | --- | --- |
| `NEXT_PUBLIC_BACKEND_URL` | Public address of the API. Fixed at build time. Also used by the content security policy. | Existing |
| `NEXTAUTH_URL` | The production origin, for Google sign-in | Existing |
| `PLATFORM_APP_HOSTS` | Hostnames that are the platform itself. Must include the production host. | Existing |
| `TWA_PACKAGE_NAME` | The Android application ID | **New.** Set after decision 11. |
| `TWA_SHA256_FINGERPRINTS` | Certificate fingerprints, comma-separated | **New.** Set after the first upload to Play. |

Both new variables are read at request time: set them and restart, no rebuild.

**Build machine**, per user:

| Item | Value on this machine |
| --- | --- |
| JDK 17 | `%USERPROFILE%\.jdks\jdk-17.0.20.1+1` |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk` |
| Bubblewrap config | `%USERPROFILE%\.bubblewrap\config.json` |
| Upload keystore | Does not exist. Keep it outside the repository. |

## 8. Build commands

Not yet run. Replace the values in angle brackets; do not run with placeholders.

```powershell
# 0. Once per machine: confirm the tools
bubblewrap doctor

# 1. Confirm the deployed site serves the manifest and icons
curl.exe -I https://<host>/manifest.webmanifest
curl.exe -I https://<host>/icons/icon-512.png

# 2. Generate the Android project (interactive)
cd "<repo>\android"
bubblewrap init --manifest=https://<host>/manifest.webmanifest
```

Answers for `bubblewrap init`:

| Prompt | Answer |
| --- | --- |
| Domain | `<host>` |
| URL path (start URL) | `/find-school` |
| Application name | The confirmed name |
| Launcher name | `EduOS` unless changed |
| Application ID | The approved ID |
| Display mode | `standalone` |
| Status bar colour | `#591620` |
| Splash screen colour | `#F2E4CC` |
| Icon URL | `https://<host>/icons/icon-512.png` |
| Maskable icon URL | `https://<host>/icons/icon-maskable-512.png` |
| Key store location | A path outside the repository |
| Key name | The agreed alias |

```powershell
# 3. Check the generated configuration before building
Select-String -Path twa-manifest.json -Pattern '"fallbackType"|"packageId"|"host"|"startUrl"'
Select-String -Path app\build.gradle -Pattern 'targetSdkVersion|compileSdkVersion'
#    fallbackType must be "customtabs"; both SDK versions must be 36

# 4. Build (prompts for the keystore passwords)
bubblewrap build
#    Produces app-release-bundle.aab (for Play) and app-release-signed.apk (for testing)

# 5. Fingerprint of the upload key, for local testing only
& "$env:USERPROFILE\.jdks\jdk-17.0.20.1+1\bin\keytool.exe" -list -v -keystore <keystore> -alias <alias>

# 6. Install on a device or the emulator
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install app-release-signed.apk
```

For a later release, raise `appVersionCode` and `appVersionName` in `twa-manifest.json`, then run `bubblewrap update` and `bubblewrap build`.

## 9. Digital Asset Links

Without this the app still opens, but with a browser bar.

1. Upload the first `.aab` to Play Console (an internal testing track is enough).
2. In Play Console open **Protected with Play › Play Store distribution › Play app signing** and copy the SHA-256 fingerprint of the **app signing key**. This is Google's key, not the upload key.
3. On the frontend server set `TWA_PACKAGE_NAME` to the application ID and `TWA_SHA256_FINGERPRINTS` to that fingerprint. To test locally built APKs as well, add the upload key's fingerprint after a comma.
4. Restart the frontend and check:
   ```powershell
   curl.exe https://<host>/.well-known/assetlinks.json
   ```
   It must return JSON naming the package and fingerprint. A 404 means a value is missing or malformed.
5. Install the app from the Play testing track and confirm there is no browser bar. To diagnose:
   ```powershell
   adb logcat | Select-String -Pattern 'OriginVerifier|digital_asset_links'
   ```

The app must point at the platform host. A school's custom domain is a different origin and would show the browser bar.

## 10. Device testing

Nothing here has been tested.

| # | Test | Pass when |
| --- | --- | --- |
| 1 | First launch | Splash screen, then the school finder, with no browser bar |
| 2 | School finder | A valid code opens that school's sign-in; an unknown code shows a clear message |
| 3 | Second launch, not signed in | Opens the remembered school's sign-in |
| 4 | Change school | "Not your school?" returns to the finder |
| 5 | Phone OTP sign-in | Code arrives; the keyboard offers it; sign-in completes |
| 6 | Email OTP sign-in | As above |
| 7 | Google sign-in | Goes to Google and returns signed in |
| 8 | Each role's portal | Student, parent, teacher and admin dashboards load |
| 9 | Close and reopen | Still signed in |
| 10 | Sign out, then reopen | Stays signed out, including after a Google sign-in and when reopened within a minute (finding 4.1) |
| 11 | Inactivity | Behaviour after 10 minutes idle, and after an hour in the background, is understood and accepted |
| 12 | Back button | Steps back through pages, then leaves the app |
| 13 | File upload | Assignment or document upload from files and from the camera |
| 14 | Protected download | A receipt, a report card and an ID card each open or save correctly (finding 4.2) |
| 15 | Payment | A Razorpay test payment, including hand-off to a UPI app and return |
| 16 | Voice input | Works in the assistant, or the button is hidden |
| 17 | No connection | The failure is understandable and the app recovers when the connection returns |
| 18 | Screen sizes | A 360 px wide phone, a large phone, a tablet, and landscape |
| 19 | Android versions | At least one older supported version and the newest |
| 20 | Console | No content security policy violations during sign-in and payment (finding 4.6) |

## 11. Play Store submission

In order. Stop at any step that needs a decision from section 5.

1. Create or confirm the Play Console developer account and complete identity verification.
2. Create the app: name, default language, app (not game), free.
3. Upload the `.aab` to **Internal testing** and add testers.
4. Set up Digital Asset Links (section 9) and complete device testing (section 10).
5. Complete **App content**: privacy policy URL, app access instructions with demo credentials, ads (none), content rating questionnaire, target audience, data safety form.
6. Complete the **store listing**: short description (80 characters), full description, app icon (512 × 512 PNG), feature graphic (1024 × 500), at least two screenshots (four phone screenshots at 1080 px or more are recommended), category (Education), contact details.
7. If the account is a personal one created after 13 November 2023: run a closed test with 12 testers for 14 days, then apply for production access.
8. Create the production release, review the pre-launch report, and submit for review.

Assets still to be made: feature graphic, screenshots, descriptions. The 512 px icon exists at `frontend/public/icons/icon-maskable-512.png`.

## 12. Release acceptance criteria

The app is ready to submit only when every line is true.

- [ ] All four suites pass on CI: frontend and backend, lint, build and tests.
- [ ] The branch is reviewed, merged and deployed to the production host.
- [ ] `https://<host>/manifest.webmanifest` and the icons are served.
- [ ] The Android project was generated with the approved application ID and name.
- [ ] `targetSdkVersion` is 36 or higher and `fallbackType` is `customtabs`.
- [ ] A signed `.aab` exists, built with the approved upload key, and the key is stored and backed up outside the repository.
- [ ] `assetlinks.json` is live with the Play app signing fingerprint, and the installed app shows no browser bar.
- [ ] Every device test in section 10 passes.
- [ ] Decisions 1, 2 and 3 are made and the app matches them.
- [ ] The privacy policy is live and linked in the listing and in the app.
- [ ] The data safety form, target audience and content rating are completed by someone who can vouch for the answers.
- [ ] Account deletion has a defined process and a web page.
- [ ] Reviewer credentials work without a real phone.
- [ ] The sign-out fix (4.1) is confirmed against real Google sign-in on the deployed site.
- [ ] Findings 4.2 to 4.5 are each fixed, or accepted in writing.
- [ ] No development URLs, demo credentials or secrets are in the build.
