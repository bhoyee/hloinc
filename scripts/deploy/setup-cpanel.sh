#!/usr/bin/env bash
# One-time setup of the website on cPanel. Run it in cPanel → Terminal.
#
# Preview (staging) site, preview.hloinc.com, updated from the "main" branch:
#   git clone https://github.com/bhoyee/hloinc.git ~/hloinc-preview && bash ~/hloinc-preview/scripts/deploy/setup-cpanel.sh
#
# Live site, hloinc.com, updated from the "live" branch (main is promoted to live when
# ready). Copies the website content from the preview site, and moves an old WordPress
# site in hloinc.com's folder aside after backing it up (it asks first):
#   git clone -b live https://github.com/bhoyee/hloinc.git ~/hloinc-live && HLO_SITE=live bash ~/hloinc-live/scripts/deploy/setup-cpanel.sh
#
# To run it again later (e.g. after a fix):
#   cd ~/hloinc-preview && git pull && bash scripts/deploy/setup-cpanel.sh
#   cd ~/hloinc-live && git pull && HLO_SITE=live bash scripts/deploy/setup-cpanel.sh
#
# It creates (or reuses, if run again):
#   - preview.hloinc.com            the test website
#   - notify.hloinc.com             a mail-only subdomain the website sends email from
#   - a MySQL database and user
#   - noreply@notify.hloinc.com     the sending mailbox, with SPF and DKIM
#   - the Node.js app (cPanel "Setup Node.js App")
#   - .env with new random passwords and secrets (made here, never shown or sent anywhere)
#   - a cron job that installs each new version from GitHub after its tests pass
# Safe to run again: anything that already exists is kept.
set -euo pipefail

ROOT_DOMAIN="hloinc.com"
MODE="${HLO_SITE:-preview}"                  # preview | live
MAIL_SUB="notify"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_NAME="$(basename "$APP_DIR")"            # e.g. hloinc-preview, hloinc-live
CP_USER="$(whoami)"
if [ "$MODE" = "live" ]; then
  SITE_SUB=""
  SITE="$ROOT_DOMAIN"
  DB_NAME="${CP_USER}_live"
  DB_USER="${CP_USER}_live"
  BRANCH="live"
  PREVIEW_DIR="$HOME/hloinc-preview"
elif [ "$MODE" = "preview" ]; then
  SITE_SUB="preview"
  SITE="${SITE_SUB}.${ROOT_DOMAIN}"
  DB_NAME="${CP_USER}_preview"
  DB_USER="${CP_USER}_preview"
  BRANCH="main"
else
  echo "HLO_SITE must be preview or live" >&2; exit 1
fi
MAIL_DOMAIN="${MAIL_SUB}.${ROOT_DOMAIN}"
MAILBOX="noreply@${MAIL_DOMAIN}"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   ✓ %s\n' "$*"; }
warn() { printf '   ! %s\n' "$*"; }
rand() { { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; } 2>/dev/null || true; }

# Run a cPanel API call; "already exists" counts as success.
api() {
  local out
  out="$(uapi --output=json "$@" 2>&1 || true)"
  if printf '%s' "$out" | grep -q '"status":1'; then return 0; fi
  if printf '%s' "$out" | grep -qiE 'already exists|already has|is already'; then return 0; fi
  printf '   ✗ %s %s failed:\n%s\n' "$1" "$2" "$(printf '%s' "$out" | head -c 800)" >&2
  return 1
}

cd "$APP_DIR"
say "Setting up $SITE from $APP_DIR (cPanel user: $CP_USER)"
mkdir -p tmp backups storage/uploads "$HOME/logs"

# ── Subdomains ────────────────────────────────────────────────────────────────
say "Subdomains"
if [ "$MODE" = "preview" ]; then
  api SubDomain addsubdomain domain="$SITE_SUB" rootdomain="$ROOT_DOMAIN" dir="$SITE" && ok "$SITE"
fi
api SubDomain addsubdomain domain="$MAIL_SUB" rootdomain="$ROOT_DOMAIN" dir="$MAIL_DOMAIN" && ok "$MAIL_DOMAIN (email only)"

# ── Live only: the main domain, and the old WordPress site ─────────────────────
if [ "$MODE" = "live" ]; then
  say "Domain $SITE"
  DOCROOT="$(uapi --output=json DomainInfo single_domain_data domain="$SITE" 2>/dev/null | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print(((d.get("result") or {}).get("data") or {}).get("documentroot", ""))
except Exception:
    print("")' || true)"
  if [ -z "$DOCROOT" ]; then
    echo "   ✗ $SITE isn't a domain on this cPanel account, so it can't be set up here." >&2
    echo "     Add it first (cPanel → Domains), or ask the host to make it this account's main domain." >&2
    exit 1
  fi
  ok "$SITE is on this account (folder: $DOCROOT)"
  THIS_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  DNS_IP="$( (dig +short "$SITE" A 2>/dev/null || getent hosts "$SITE" | awk '{print $1}') | tail -1)"
  if [ -n "$DNS_IP" ] && [ "$DNS_IP" != "$THIS_IP" ]; then
    warn "$SITE points to $DNS_IP, but this server is $THIS_IP. The new site is set up here anyway;"
    warn "visitors see it once $SITE's A record (and www) point to $THIS_IP. Keep the MX records (Microsoft 365) as they are."
  else
    ok "$SITE points to this server ($THIS_IP)"
  fi
  if [ -f "$DOCROOT/wp-config.php" ]; then
    TS="$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$HOME/backups"
    say "Old WordPress site found in $DOCROOT"
    echo "   It will be backed up to ~/backups, then moved to ~/wordpress-old-$TS (nothing is deleted)."
    read -r -p "   Type YES to continue: " answer
    [ "$answer" = "YES" ] || { echo "   Stopped. Nothing was changed."; exit 1; }
    tar -czf "$HOME/backups/wordpress-files-$TS.tar.gz" -C "$DOCROOT" . && ok "files backed up: ~/backups/wordpress-files-$TS.tar.gz"
    wp() { grep -E "define\(\s*['\"]$1['\"]" "$DOCROOT/wp-config.php" | head -1 | sed -E "s/.*,\s*['\"]([^'\"]*)['\"].*/\1/"; }
    WP_DB="$(wp DB_NAME)"; WP_USER="$(wp DB_USER)"; WP_PASS="$(wp DB_PASSWORD)"; WP_HOST="$(wp DB_HOST)"
    if [ -n "$WP_DB" ] && MYSQL_PWD="$WP_PASS" mysqldump -h "${WP_HOST:-localhost}" -u "$WP_USER" --single-transaction "$WP_DB" | gzip > "$HOME/backups/wordpress-db-$TS.sql.gz"; then
      ok "database $WP_DB backed up: ~/backups/wordpress-db-$TS.sql.gz"
    else
      echo "   ✗ Couldn't back up the WordPress database. Nothing was moved; back it up in cPanel → phpMyAdmin, then run this again." >&2
      exit 1
    fi
    mkdir -p "$HOME/wordpress-old-$TS"
    find "$DOCROOT" -mindepth 1 -maxdepth 1 ! -name .well-known ! -name cgi-bin -exec mv {} "$HOME/wordpress-old-$TS/" \;
    ok "WordPress moved aside to ~/wordpress-old-$TS (its database is kept as it is)"
  fi
fi

# ── Passwords: reuse the ones in .env if this has run before ──────────────────
envval() { [ -f .env ] && grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//' || true; }
DB_PASS="$(envval DB_PASSWORD)";        [ -n "$DB_PASS" ] || DB_PASS="$(rand 28)"
MAIL_PASS="$(envval SMTP_PASSWORD)";    [ -n "$MAIL_PASS" ] || MAIL_PASS="$(rand 28)"
SESSION_SECRET="$(envval SESSION_SECRET)"; [ -n "$SESSION_SECRET" ] || SESSION_SECRET="$(rand 64)"
APP_KEY="$(envval APP_KEY)";            [ -n "$APP_KEY" ] || APP_KEY="$(rand 64)"

# ── Database ──────────────────────────────────────────────────────────────────
say "Database"
api Mysql create_database name="$DB_NAME" && ok "database $DB_NAME"
if api Mysql create_user name="$DB_USER" password="$DB_PASS"; then ok "user $DB_USER"; fi
api Mysql set_password user="$DB_USER" password="$DB_PASS" >/dev/null && ok "password set"
api Mysql set_privileges_on_database user="$DB_USER" database="$DB_NAME" privileges="ALL PRIVILEGES" && ok "privileges"

# ── Email: noreply@notify.hloinc.com ──────────────────────────────────────────
say "Email"
MAIL_MODE="smtp"
if api Email add_pop email="noreply" domain="$MAIL_DOMAIN" password="$MAIL_PASS" quota=250 2>/tmp/hlo-mail-err.$$; then
  api Email passwd_pop email="noreply" domain="$MAIL_DOMAIN" password="$MAIL_PASS" >/dev/null && ok "mailbox $MAILBOX"
elif [ -x /usr/sbin/sendmail ]; then
  # No mailbox allowed on this plan: send through the server's mail program instead,
  # still as $MAILBOX (covered by the SPF and DKIM records below).
  MAIL_MODE="sendmail"
  ok "no mailbox available on this plan; sending as $MAILBOX through the server's mail program"
else
  cat /tmp/hlo-mail-err.$$ >&2
  warn "Couldn't create $MAILBOX and the server has no sendmail. Emails won't send until this is fixed."
fi
rm -f /tmp/hlo-mail-err.$$
api EmailAuth enable_dkim domain="$MAIL_DOMAIN" && ok "DKIM on for $MAIL_DOMAIN" || warn "Turn on DKIM: cPanel → Email Deliverability → $MAIL_DOMAIN → Repair"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
api EmailAuth install_spf_records domain="$MAIL_DOMAIN" record="v=spf1 +a +mx +ip4:${SERVER_IP} ~all" && ok "SPF for $MAIL_DOMAIN" \
  || warn "Set SPF: cPanel → Email Deliverability → $MAIL_DOMAIN → Repair"
# Mail TO @hloinc.com must keep going to Microsoft 365.
if uapi --output=json Email list_mx_records domain="$ROOT_DOMAIN" 2>/dev/null | grep -q '"detected":"local"'; then
  warn "Email Routing for $ROOT_DOMAIN is LOCAL. Set it to 'Remote Mail Exchanger' (cPanel → Email Routing), or staff emails won't reach Microsoft 365."
else
  ok "$ROOT_DOMAIN mail still goes to Microsoft 365"
fi

# ── Node.js app ───────────────────────────────────────────────────────────────
say "Node.js app"
NODE_VERSION="$( { cloudlinux-selector get --json --interpreter nodejs 2>/dev/null || echo '{}'; } | python3 -c '
import json, sys
data = json.load(sys.stdin)
av = data.get("available_versions", [])
if isinstance(av, dict):
    items = list(av.items())
else:
    items = [((v.get("version") if isinstance(v, dict) else v), v) for v in av]
def enabled(info):
    return not isinstance(info, dict) or str(info.get("status", "enabled")).lower() in ("enabled", "installed", "true")
majors = set()
for version, info in items:
    head = str(version).split(".")[0]
    if head.isdigit() and enabled(info):
        majors.add(int(head))
best = sorted(m for m in majors if m >= 20)
print(best[-1] if best else "")
' || true)"
if [ -z "$NODE_VERSION" ]; then
  echo "   ✗ Couldn't find Node.js 20 or newer. This is what the server reports:" >&2
  cloudlinux-selector get --json --interpreter nodejs 2>&1 | head -c 1500 >&2; echo >&2
  exit 1
fi
if cloudlinux-selector get --json --interpreter nodejs 2>/dev/null | grep -q "\"$APP_NAME\""; then
  ok "app $APP_NAME already exists"
else
  cloudlinux-selector create --json --interpreter nodejs --version "$NODE_VERSION" --app-root "$APP_NAME" \
    --domain "$SITE" --app-uri / --app-mode production --startup-file app.js >/dev/null
  ok "app $APP_NAME on Node $NODE_VERSION"
fi
ACTIVATE="$(ls -d "$HOME/nodevenv/$APP_NAME"/*/bin/activate 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$ACTIVATE" ] || { echo "   ✗ The Node.js app's environment wasn't created. Check cPanel → Setup Node.js App." >&2; exit 1; }
ok "environment: $ACTIVATE"

# ── .env ──────────────────────────────────────────────────────────────────────
say "Settings (.env)"
SMTP_HOST="$(hostname -f)"
cat > .env <<ENV
# Written by scripts/deploy/setup-cpanel.sh — keep private (chmod 600). Never commit.
NODE_ENV=production
APP_URL=https://${SITE}
$(if [ "$MODE" = "preview" ]; then printf '# Preview only: keep the test site out of Google.\nNOINDEX=true\n'; fi)
SESSION_SECRET=${SESSION_SECRET}
# Encrypts two-step sign-in secrets. Keep a safe copy; changing it makes staff set up two-step again.
APP_KEY=${APP_KEY}
SESSION_IDLE_MINUTES=60
SESSION_MAX_HOURS=12

DB_HOST=localhost
DB_PORT=3306
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}

$(if [ "$MAIL_MODE" = "sendmail" ]; then
  printf 'MAIL_TRANSPORT=sendmail\n'
else
  printf 'MAIL_TRANSPORT=smtp\nSMTP_HOST=%s\nSMTP_PORT=465\nSMTP_SECURE=true\nSMTP_USER=%s\nSMTP_PASSWORD=%s\n' "$SMTP_HOST" "$MAILBOX" "$MAIL_PASS"
fi)
MAIL_FROM="Healthy Living Option Inc. <${MAILBOX}>"

TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
FORMS_MAX_PER_EMAIL_PER_DAY=10
ENV
chmod 600 .env
ok ".env written (passwords are only in this file)"

# ── Install, migrate, start ───────────────────────────────────────────────────
say "Installing and starting"
bash scripts/deploy/remote.sh "$ACTIVATE"
git rev-parse HEAD > tmp/deployed-commit

# ── Automatic updates from GitHub (every 5 minutes) ───────────────────────────
say "Automatic updates"
CRON="*/5 * * * * bash $APP_DIR/scripts/deploy/pull.sh $APP_DIR $BRANCH $ACTIVATE >> $HOME/logs/$APP_NAME-deploy.log 2>&1"
{ { crontab -l 2>/dev/null || true; } | { grep -v "scripts/deploy/pull.sh $APP_DIR " || true; }; echo "$CRON"; } | crontab -
ok "checks GitHub's $BRANCH branch every 5 minutes (log: ~/logs/$APP_NAME-deploy.log)"

# ── Live only: the website content from the preview site ──────────────────────
if [ "$MODE" = "live" ] && [ -f "$PREVIEW_DIR/.env" ]; then
  say "Website content from the preview site"
  # shellcheck disable=SC1090
  (set +u; source "$ACTIVATE" && node scripts/deploy/copy-content.js "$PREVIEW_DIR") || warn "Copying the content failed; run it again: node scripts/deploy/copy-content.js $PREVIEW_DIR"
fi

say "Done"
cat <<NEXT
   Website:  https://${SITE}   (if the browser warns about the certificate, wait for
             cPanel AutoSSL or run it from cPanel → SSL/TLS Status)
   Health:   https://${SITE}/healthz/db

   Create the first CEO/COO login (you'll be asked for a password, 12+ characters):
     source "$ACTIVATE" && cd "$APP_DIR" && npm run create-admin -- --name "Full Name" --email someone@hloinc.com
NEXT
if [ "$MODE" = "live" ]; then
cat <<LIVE

   Live site checklist:
     - SSL: cPanel → SSL/TLS Status → run AutoSSL for $SITE and www.$SITE
     - Cloudflare Turnstile: add $SITE to the widget's hostnames, then set it in
       the live portal (Administration → Security settings)
     - Staff accounts: invite real staff in the live portal (demo staff aren't copied)
     - Updates: changes reach preview first; they reach $SITE when main is promoted to live
LIVE
fi
