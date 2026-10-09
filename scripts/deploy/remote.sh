#!/usr/bin/env bash
# Runs ON THE SERVER after GitHub Actions has copied the new code into the app
# folder (see .github/workflows/ci-deploy.yml). Safe to run by hand too:
#
#   bash scripts/deploy/remote.sh /home/<user>/nodevenv/<app>/20/bin/activate
#
# 1. installs production packages   2. backs up the database
# 3. runs migrations and base seeds 4. restarts the app (Passenger)
set -euo pipefail

ACTIVATE="${1:?Usage: remote.sh PATH_TO_NODE_APP_BIN_ACTIVATE}"
cd "$(dirname "$0")/../.."
echo "→ Deploying in $(pwd)"

if [ ! -f .env ]; then
  echo "✗ .env is missing in $(pwd). Create it first (see DEPLOY.md)." >&2
  exit 1
fi

# The Node.js version and node_modules that cPanel's "Setup Node.js App" created.
# cPanel's activate script uses variables that may be unset, so relax `set -u` while loading it.
if [ ! -f "$ACTIVATE" ]; then
  echo "✗ $ACTIVATE not found. Check cPanel → Setup Node.js App." >&2
  exit 1
fi
set +u
# shellcheck disable=SC1090
source "$ACTIVATE"
set -u
echo "→ Node $(node -v), npm $(npm -v)"

# `npm install` (not `npm ci`): on CloudLinux, node_modules is a link into the
# app's virtual environment, which `npm ci` would delete.
echo "→ Installing production packages"
npm install --omit=dev --no-audit --no-fund --loglevel=error

echo "→ Backing up the database"
node scripts/db-backup.js

echo "→ Running migrations"
npx knex migrate:latest
# Base data only fills empty tables (demo data never runs in production).
npx knex seed:run

echo "→ Restarting"
mkdir -p tmp
touch tmp/restart.txt
echo "✓ Deployed"
