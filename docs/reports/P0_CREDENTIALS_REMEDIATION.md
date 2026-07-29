# P0 — Committed Credentials: Findings & Remediation

_Date: 2026-07-29 · Status: working tree remediated (commit `5804f0a`); **credential rotation and history purge pending — owner action required**_

## 1. What was exposed, where

| Secret | Severity | Where it lives(d) | Exposure |
|---|---|---|---|
| **MongoDB Atlas password** — user `kulkarnisampada07_db_user`, cluster `cluster0.alhw4up.mongodb.net`, DB `school_erp` | **Critical** | `render.yaml` (tracked, at HEAD and 7 earlier commits); 6 deleted debug scripts (`backend/check_atlas.js`, `debug_databases.js`, `force_migrate_to_atlas.js`, `inspect_atlas.js`, `list_teachers.js`, `test_student_dashboard.js`) in older commits; local untracked `.env` and `backend/.env` | Pushed to GitHub (`Sampadakulkarni11222/Eduos_AI`). Repo returns 404 unauthenticated → appears **private**, which limits exposure to collaborators + anyone who ever had access — but the credential grants full read/write to the live database (student PII, fees, medical) and must be treated as compromised. |
| **Shared demo password** `ChangeMe@123!` for all staff accounts incl. Owner/Admin | High | `credentials.md` (was tracked), `README.md` §5, seed scripts | If the Atlas DB is seeded with these accounts and the Render backend is deployed, **anyone with the repo can log in as Owner** on the live instance. |
| `JWT_SECRET`, `MEDICAL_ENCRYPTION_KEY` | OK / verify | `render.yaml` had `JWT_SECRET: sync:false` (dashboard-managed — not leaked). Local `.env.example` has placeholder values only. | Verify the production values on Render are not the `change-this-*` defaults — if they are, rotate them too. |

Additional finding while here: `render.yaml` shipped production with `SWAGGER_ENABLED="true"` (now flipped to `"false"`), and `backend/src/config/env.js:11` prefers `MONGO_URI_ATLAS` over `MONGO_URI` — meaning **local dev has been running against the live Atlas cluster**, not localhost.

## 2. What was changed (done, commit `5804f0a`)

1. `render.yaml` — hardcoded Atlas URI replaced with `sync: false` (value entered once in the Render dashboard); `MEDICAL_ENCRYPTION_KEY` added as a dashboard-managed secret; Swagger disabled in production.
2. `.gitignore` — now blocks `.env`, `.env.*`, `*.env` (all directories, `.env.example` excepted) and `credentials.md`.
3. `credentials.md` — removed from git tracking (`git rm --cached`); the local file remains for dev reference. Verified via `git check-ignore` that all four credential-file paths are now ignored.

## 3. What YOU must do (I cannot — these are your accounts)

**Do these in this order, before the history purge:**

1. **Rotate the Atlas password now** (MongoDB Atlas → Database Access → `kulkarnisampada07_db_user` → Edit Password). Better: delete that user and create a new one with a least-privilege role scoped to `school_erp`.
2. While in Atlas: **Network Access → remove `0.0.0.0/0`** if present; allowlist only Render's egress IPs and your own.
3. **Check Atlas access history** (Atlas → Activity Feed / Database Access History) for unfamiliar client IPs — this determines whether this was a leak or a breach.
4. Update the new password in: Render dashboard (`MONGO_URI` env var) and your local `.env` / `backend/.env` files (untracked — safe).
5. If the deployed instance is reachable: **change every seeded account password** away from `ChangeMe@123!` (or re-seed with random passwords). Verify Render's `JWT_SECRET` / `MEDICAL_ENCRYPTION_KEY` are strong non-default values; rotate if not.

## 4. History purge (ready to execute after rotation)

`git filter-repo` is not installed; install with `pip install git-filter-repo`. Then, from a **fresh clone**:

```bash
git clone https://github.com/Sampadakulkarni11222/Eduos_AI.git purge-work && cd purge-work
git filter-repo --invert-paths --path credentials.md \
  --path backend/check_atlas.js --path backend/debug_databases.js \
  --path backend/force_migrate_to_atlas.js --path backend/inspect_atlas.js \
  --path backend/list_teachers.js --path backend/test_student_dashboard.js \
  --replace-text <(echo "REDACTED-ROTATED==>REDACTED")
git remote add origin https://github.com/Sampadakulkarni11222/Eduos_AI.git
git push origin --force --all && git push origin --force --tags
```

**Honest caveats, so the purge isn't false comfort:**
- GitHub retains unreachable commits and **pull-request refs** (PR #1) even after a force-push; cached views can survive. GitHub Support can run a garbage-collect on request, or delete-and-recreate the repo for a guaranteed clean slate.
- Every existing clone (this working copy included) still contains the old history until re-cloned.
- **Rotation is therefore the real fix; the purge is hygiene.** Once the password is rotated, the leaked string is inert.
- I did **not** force-push a rewritten history myself: it rewrites `main` on a shared remote and every collaborator's clone breaks — that call is yours, and doing it before rotation would be security theater. Say the word after rotating and I'll execute the purge end-to-end.

## 5. Verification performed

- `git grep` of the secret across **all** commits (`git rev-list --all`) — found only in the files listed above; no other secret-bearing files (searched for the password and the cluster host).
- `git ls-files` confirms no `.env` file is tracked at HEAD; only `backend/.env.example` (placeholders only — reviewed).
- `API_KEYS_REQUIRED.md` reviewed — documentation only, no real keys; safe to keep tracked.
- Frontend bundle: no secret is referenced in `frontend/src` (`NEXT_PUBLIC_*` vars are URLs only); no `.env` exists in `frontend/`.
- Unauthenticated GitHub API call returns 404 for the repo → private at time of writing.
