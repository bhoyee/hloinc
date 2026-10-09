#!/usr/bin/env bash
# Automatic deployment, run by cron every 5 minutes on the server (installed by
# setup-cpanel.sh). The server pulls from GitHub, so no inbound SSH is needed.
#
#   pull.sh <app dir> <branch> <path to the Node.js app's bin/activate>
#
# When <branch> on GitHub has a new commit whose "Test" check passed, it updates
# the code (keeping .env, uploads, backups and logs), then runs remote.sh:
# install, database backup, migrations, restart. If that fails, it goes back to
# the previous version.
set -uo pipefail

APP_DIR="${1:?app dir}"
BRANCH="${2:-main}"
ACTIVATE="${3:?activate path}"
cd "$APP_DIR" || exit 1
mkdir -p tmp
ts() { date '+%Y-%m-%d %H:%M:%S'; }

# One run at a time.
exec 9>tmp/deploy.lock
flock -n 9 || exit 0

git fetch --quiet origin "$BRANCH" || { echo "$(ts) ✗ git fetch failed"; exit 1; }
CURRENT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse "origin/$BRANCH")"
[ "$CURRENT" = "$TARGET" ] && exit 0
[ -f tmp/skipped-commit ] && [ "$(cat tmp/skipped-commit)" = "$TARGET" ] && exit 0

# Only deploy commits that passed the tests on GitHub (repo is public: no token needed).
REPO="$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
CHECK="$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/commits/$TARGET/check-runs?check_name=Test" 2>/dev/null)" || { echo "$(ts) ! couldn't reach GitHub; will retry"; exit 0; }
CONCLUSION="$(printf '%s' "$CHECK" | grep -o '"conclusion": *"[a-z_]*"' | head -1 | sed -E 's/.*"([a-z_]*)"$/\1/')"
STATUS="$(printf '%s' "$CHECK" | grep -o '"status": *"[a-z_]*"' | head -1 | sed -E 's/.*"([a-z_]*)"$/\1/')"

if [ "$CONCLUSION" != "success" ]; then
  if [ "$STATUS" = "completed" ]; then
    echo "$(ts) ✗ ${TARGET:0:7} failed its tests on GitHub ($CONCLUSION); not deploying it"
    echo "$TARGET" > tmp/skipped-commit
  fi
  exit 0   # still running, or not started yet: try again next time
fi

echo "$(ts) → deploying ${TARGET:0:7} (was ${CURRENT:0:7})"
# reset --hard keeps ignored files: .env, storage/uploads, backups, tmp, node_modules.
git reset --hard --quiet "$TARGET"
if bash scripts/deploy/remote.sh "$ACTIVATE"; then
  echo "$TARGET" > tmp/deployed-commit
  echo "$(ts) ✓ deployed ${TARGET:0:7}"
else
  echo "$(ts) ✗ deploy of ${TARGET:0:7} failed; going back to ${CURRENT:0:7}"
  git reset --hard --quiet "$CURRENT"
  # shellcheck disable=SC1090
  (set +u; source "$ACTIVATE" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
  touch tmp/restart.txt
  echo "$TARGET" > tmp/skipped-commit
  exit 1
fi
