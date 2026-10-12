#!/usr/bin/env bash
#
# Deploys one commit of EduOS on the VPS: fast-forward, install, build, restart.
#
# Runs ON the server, from the checkout it deploys. The Deploy workflow reaches
# it over SSH with a key whose authorized_keys entry is pinned to this script
# (`command="bash <checkout>/.github/scripts/deploy-vps.sh"`), so the only thing
# that key can ever do is ask for a deploy. The commit to deploy arrives as the
# SSH command and is read from SSH_ORIGINAL_COMMAND; run by hand, pass it as the
# first argument instead:
#
#   bash .github/scripts/deploy-vps.sh <40-character commit sha>
#
# The server shares its box with other projects, so nothing here touches
# anything outside this checkout and these two PM2 processes.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF="$APP_DIR/.github/scripts/deploy-vps.sh"

BACKEND_PROCESS="${EDUOS_BACKEND_PROCESS:-eduos-backend}"
FRONTEND_PROCESS="${EDUOS_FRONTEND_PROCESS:-eduos-frontend}"
# The ports the server's own backend/.env and PM2 setup use. They are not read
# from this repository because the repository does not decide them.
BACKEND_HEALTH_URL="${EDUOS_BACKEND_HEALTH_URL:-http://127.0.0.1:5300/api/v1/health}"
FRONTEND_HEALTH_URL="${EDUOS_FRONTEND_HEALTH_URL:-http://127.0.0.1:3300/}"
# The floor from package.json's `engines`; .nvmrc names the exact line to use.
MIN_NODE_MAJOR=20

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

# Selects the Node this project builds with, and refuses to go on with any other.
#
# The server's system Node is older than Next.js accepts and is shared with the
# other projects on the box, so it is never the right one and never upgraded
# from here. The version comes from .nvmrc through nvm; a non-interactive SSH
# session does not read ~/.bashrc, so nvm has to be loaded by hand. This runs
# before the checkout is touched: a wrong Node stops the deploy with nothing
# changed, rather than halfway through a build.
load_node() {
  local wanted="" major
  if [ -f "$APP_DIR/.nvmrc" ]; then wanted="$(tr -d '[:space:]' < "$APP_DIR/.nvmrc")"; fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # nvm is not written for `set -eu` and trips over both.
    set +eu
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    if [ -n "$wanted" ]; then nvm use "$wanted" >/dev/null 2>&1; fi
    set -eu
  fi
  for tool in git node npm pm2 curl flock; do
    command -v "$tool" >/dev/null || die "'$tool' is not on PATH for this SSH session"
  done
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt "$MIN_NODE_MAJOR" ] || { [ -n "$wanted" ] && [ "$major" != "${wanted%%.*}" ]; }; then
    die "Node $(node -v) is active but this project builds with Node ${wanted:-$MIN_NODE_MAJOR+}. On the server run: source ~/.nvm/nvm.sh && nvm install ${wanted:-$MIN_NODE_MAJOR}"
  fi
}

# Everything a deploy depends on, checked without changing anything. Run it on
# the server after any change there (Node, PM2, the git remote):
#   env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin bash .github/scripts/deploy-vps.sh --check
# The `env -i` gives it the same bare environment an SSH deploy gets.
check() {
  log "node $(node -v) at $(command -v node), npm $(npm -v), pm2 at $(command -v pm2)"
  cd "$APP_DIR"
  [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "$APP_DIR is not on the main branch"
  git fetch --quiet origin main || die "cannot fetch origin/main without a prompt"
  log "git: on main at $(git rev-parse --short HEAD), origin/main at $(git rev-parse --short origin/main)"
  for process in "$BACKEND_PROCESS" "$FRONTEND_PROCESS"; do
    pm2 describe "$process" >/dev/null 2>&1 || die "PM2 has no process named '$process'"
  done
  curl -fsS -o /dev/null --max-time 5 "$BACKEND_HEALTH_URL" || die "backend is not answering at $BACKEND_HEALTH_URL"
  curl -fsS -o /dev/null --max-time 5 "$FRONTEND_HEALTH_URL" || die "frontend is not answering at $FRONTEND_HEALTH_URL"
  log "ready: a deploy can run from this environment"
}

# npm ci empties node_modules before refilling it, which the running app would
# notice. Skipping it when the lockfile did not move keeps most deploys from
# touching the live dependency tree at all.
install_if_needed() {
  local package="$1" before="$2" after="$3"
  if [ -d "$APP_DIR/$package/node_modules" ] \
    && git -C "$APP_DIR" diff --quiet "$before" "$after" -- "$package/package-lock.json"; then
    log "$package: lockfile unchanged, keeping node_modules"
    return
  fi
  log "$package: installing dependencies"
  # --include=dev: the build tools (esbuild, Next's compiler plugins) are dev
  # dependencies, and npm drops those whenever NODE_ENV=production is exported.
  (cd "$APP_DIR/$package" && npm ci --include=dev --no-audit --no-fund)
}

wait_for() {
  local name="$1" url="$2" attempt
  for attempt in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 5 "$url"; then
      log "$name is answering at $url"
      return
    fi
    sleep 2
  done
  die "$name did not answer at $url within 60s; check 'pm2 logs'. Nothing is rolled back automatically."
}

# Stage 1: move the checkout to the requested commit, then hand over to the
# copy of this script that commit contains, so a deploy that changes the deploy
# steps runs the new steps rather than the ones already loaded.
update_checkout() {
  local sha="$1" before
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "expected a full commit sha, got '${sha}'"

  exec 9>"/tmp/eduos-deploy.lock"
  flock -n 9 || die "another deploy is already running"

  cd "$APP_DIR"
  [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "$APP_DIR is not on the main branch"
  before="$(git rev-parse HEAD)"

  git fetch --quiet origin main
  # Only commits that are on main get deployed, whatever sha was asked for.
  git merge-base --is-ancestor "$sha" origin/main || die "$sha is not on origin/main"
  # --ff-only: a server checkout with local commits or conflicting edits stops
  # here instead of being silently merged or overwritten.
  git merge --ff-only "$sha"

  exec bash "$SELF" --release "$before" "$(git rev-parse HEAD)"
}

# Stage 2: build both apps, and restart only once both builds have succeeded,
# so a commit that does not build leaves the running processes alone.
release() {
  local before="$1" after="$2"
  log "releasing ${after:0:7} (was ${before:0:7})"

  install_if_needed backend "$before" "$after"
  log "backend: building"
  (cd "$APP_DIR/backend" && npm run build && node --check dist/app.js)

  install_if_needed frontend "$before" "$after"
  log "frontend: building"
  (cd "$APP_DIR/frontend" && npm run build)

  log "restarting $BACKEND_PROCESS and $FRONTEND_PROCESS"
  pm2 restart "$BACKEND_PROCESS" "$FRONTEND_PROCESS" --update-env

  wait_for backend "$BACKEND_HEALTH_URL"
  wait_for frontend "$FRONTEND_HEALTH_URL"
  log "done: ${after:0:7} is live"
}

main() {
  load_node
  if [ "${1:-}" = "--release" ]; then
    release "$2" "$3"
  elif [ "${1:-}" = "--check" ]; then
    check
  else
    update_checkout "${1:-${SSH_ORIGINAL_COMMAND:-}}"
  fi
}

# Everything above is a function and this is the last line, so the whole file
# is parsed before anything runs; the pull in stage 1 can then replace this
# file on disk without bash reading a half-old, half-new script.
main "$@"; exit
