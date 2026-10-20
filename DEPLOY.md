# Deploying to shared cPanel hosting (Node.js + terminal)

## One-time setup

1. **Database** — cPanel → *MySQL Databases*:
   create a database and user (e.g. `cpuser_hloinc` / `cpuser_hlo`), give the user *All privileges* on it.
2. **Upload the code** — either `git clone` over SSH into e.g. `~/hloinc`, or upload a zip.
   Upload everything **except** `node_modules/` and `.env`. `public/css/app.css` must be included
   (it is built locally; the server never runs Tailwind).
3. **Create the Node app** — cPanel → *Setup Node.js App* → *Create application*:
   - Node.js version: 20 or newer
   - Application mode: Production
   - Application root: `hloinc`
   - Application URL: the domain (or a subdomain while testing)
   - Application startup file: `app.js`
4. **Environment variables** — add them in the same screen (preferred) or create `~/hloinc/.env`
   from `.env.example`. Required in production:
   - `NODE_ENV=production`
   - `APP_URL=https://www.hloinc.com`
   - `SESSION_SECRET=` (48+ random bytes: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `APP_KEY=` (a *different* value made the same way; encrypts two-step sign-in secrets — keep a safe copy,
     changing it makes every staff member set up two-step sign-in again)
   - `DB_HOST=localhost`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
   - `SMTP_*` and `MAIL_FROM` from HLO's email account
   Do **not** set `PORT` — Passenger provides it.
5. **Install & migrate** — copy the `source .../activate` command shown at the top of the
   Node.js App screen, then over SSH:
   ```bash
   source /home/<user>/nodevenv/hloinc/20/bin/activate && cd ~/hloinc
   npm ci --omit=dev
   npx knex migrate:latest
   npx knex seed:run
   npm run create-admin -- --name "Full Name" --email admin@hloinc.com
   ```
   (`create-admin` lives in `scripts/` and only needs production dependencies.)
   The first Admin signs in at `/portal` with email and password, then invites everyone else from
   **Accounts** (staff choose their own passwords from the emailed link). Two-step sign-in starts
   **off**; the Admin can switch it on for everyone under **Administration → Security settings**.
6. **Restart** the app from the Node.js App screen and open `/healthz` and `/healthz/db`.
7. **HTTPS** — enable AutoSSL / Let's Encrypt for the domain. Secure cookies and HSTS
   are on automatically when `NODE_ENV=production`.

## Spam protection

Every public form (contact, referral, appointment) is protected by: hidden honeypot
fields, one-time form tokens with a minimum fill time, link-spam detection, duplicate
detection, a per-email daily limit (`FORMS_MAX_PER_EMAIL_PER_DAY`, default 10), CSRF and
cross-site checks, and per-IP rate limits. Blocked attempts are logged as `[spam] …`.

**Optional — Cloudflare Turnstile** (free, privacy-friendly CAPTCHA; most visitors see no puzzle):
1. Cloudflare dashboard → Turnstile → Add widget → domain `hloinc.com` → Managed mode.
2. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in the Node.js App environment and restart.
3. The widget, CSP allowance and Privacy/Cookie Policy wording switch on automatically.

## Quick start: the website (hloinc.com)

In cPanel → **Terminal**, paste:

```bash
git clone https://github.com/bhoyee/hloinc.git ~/hloinc-live && HLO_SITE=live bash ~/hloinc-live/scripts/deploy/setup-cpanel.sh
```

`scripts/deploy/setup-cpanel.sh` checks the domain, backs up and moves aside an old WordPress site in
hloinc.com's folder (it asks first; add `HLO_CONFIRM=YES` to run it in the background with `nohup`),
creates the database, the sending mailbox (with SPF and DKIM), the Node.js app and `.env` (with new
random passwords that only exist in that file), installs everything, runs the migrations, starts the
app and switches on automatic updates. Running it again is safe. It finishes by showing the command to
create the first CEO/COO login.

## Automatic deployment

The server **pulls** new versions itself, so no SSH access from outside is needed:

1. Every push and pull request runs the tests on GitHub (`.github/workflows/ci-deploy.yml`, check
   name **Test**): the full suite against MySQL 8.4. (Remember to run `npm run css:build` and commit
   `public/css/app.css` after changing styles; the server never builds it.)
2. A cron job on the server runs `scripts/deploy/pull.sh` every 5 minutes. When `main` has a new
   commit **and its Test check passed**, it updates the code (`git reset --hard`, which keeps `.env`,
   `storage/uploads/`, `backups/` and `node_modules/`), then runs `scripts/deploy/remote.sh`:
   `npm install --omit=dev`, a database backup (`backups/`, newest 14), `knex migrate:latest`, base
   seeds, and a restart. If any step fails it goes back to the previous version.
3. A commit whose tests fail is never deployed.

Log: `~/logs/hloinc-live-deploy.log`. The deployed commit is in `tmp/deployed-commit`.

To deploy straight away instead of waiting up to 5 minutes, run in cPanel → Terminal:

```bash
bash ~/hloinc-live/scripts/deploy/pull.sh ~/hloinc-live main ~/nodevenv/hloinc-live/24/bin/activate
```

### Rolling back

- **Code:** revert the commit on `main` and push; the server installs the revert after its tests pass.
- **Database:** `backups/` holds a dump from just before each deploy:
  `gunzip -c backups/db-YYYYMMDD-HHMMSS.sql.gz | mysql -u <user> -p <database>`.

## Email

HLO's own mail (`@hloinc.com`) is on **Microsoft 365**, and its SPF record (`-all`) rejects mail
sent as `@hloinc.com` from anywhere else. So the website sends from its own subdomain mailbox,
**`noreply@notify.hloinc.com`**, on this hosting:

- cPanel → *Domains*: `notify.hloinc.com` (no website; it only carries mail).
- cPanel → *Email Accounts*: `noreply@notify.hloinc.com`. If the hosting plan allows no more mailboxes, the setup script uses `MAIL_TRANSPORT=sendmail` instead: the same sender address, sent through the server's own mail program (still signed with DKIM).
- cPanel → *Email Deliverability*: SPF and DKIM for `notify.hloinc.com` must show **Valid**
  (use *Repair* if not). `hloinc.com` itself is left exactly as it is.
- cPanel → *Email Routing* for `hloinc.com` must stay **Remote Mail Exchanger**, so mail *to*
  `@hloinc.com` keeps going to Microsoft 365.
- `.env` (written by the setup script): `SMTP_HOST=` the server's hostname, `SMTP_PORT=465`, `SMTP_SECURE=true`,
  `SMTP_USER=noreply@notify.hloinc.com`, `MAIL_FROM="Healthy Living Option Inc. <noreply@notify.hloinc.com>"`.

Replies from visitors still reach the right person: staff emails use the visitor as *Reply-To*,
and replies to visitors use the HLO team address as *Reply-To*. To send from Microsoft 365
instead later, HLO's Microsoft 365 admin creates the mailbox and sending permission, and only
the `SMTP_*` / `MAIL_FROM` values change.

## Demo data

Demo data (made-up staff, appointments, messages and leads) is for a developer's own computer only.
**Never set `DEMO_DATA=true` on hloinc.com.** If it was ever added there, `npm run demo:remove`
deletes only the demo staff and the demo visitors' records; real accounts, enquiries and settings
are not touched.

## History: the preview site

From October 9 to 20, 2026 a test copy ran at preview.hloinc.com (from `main`, with demo data), and
hloinc.com followed a separate `live` branch. The preview was retired on October 20, 2026: hloinc.com
now installs every commit on `main` whose tests passed. `scripts/deploy/copy-content.js` (copy pages,
photos, settings and jobs from one copy of the site to another) is kept for setting up another copy.

## Notes for shared hosting
- The DB pool is capped at 5 connections (`knexfile.js`) to stay inside host limits.
- Sessions are stored in the `sessions` table, so restarts don't log staff out.
- `storage/` holds files that aren't part of the code. Only `storage/uploads/` (images uploaded in the page editor) is served, at `/uploads/`; the rest of `storage/` is never served. `git pull` doesn't touch it, but **include `storage/uploads/` in backups** alongside the database.
- Image uploads use `sharp`, which downloads a ready-made Linux build during `npm install`. If it reports a sharp error, run `npm rebuild sharp` once in the cPanel terminal (with the app's environment activated).
- Every deploy backs up the database first (`backups/`, newest 14). Also keep cPanel's own backups on, and include `storage/uploads/` (retention period: client question 8).
