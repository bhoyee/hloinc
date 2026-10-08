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
   The first Admin signs in at `/portal`, sets up two-step sign-in, then invites everyone else from
   **Accounts** (staff choose their own passwords from the emailed link).
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

## Updating

```bash
# locally
npm run css:build && npm test
git push   # or upload changed files

# on the server
source /home/<user>/nodevenv/hloinc/20/bin/activate && cd ~/hloinc
git pull
npm ci --omit=dev
npx knex migrate:latest
touch tmp/restart.txt   # or press Restart in cPanel
```

## Notes for shared hosting
- The DB pool is capped at 5 connections (`knexfile.js`) to stay inside host limits.
- Sessions are stored in the `sessions` table, so restarts don't log staff out.
- `storage/` holds files that aren't part of the code. Only `storage/uploads/` (images uploaded in the page editor) is served, at `/uploads/`; the rest of `storage/` is never served. `git pull` doesn't touch it, but **include `storage/uploads/` in backups** alongside the database.
- Image uploads use `sharp`, which downloads a ready-made Linux build during `npm ci`. If `npm ci` reports a sharp error, run `npm rebuild sharp` once in the cPanel terminal.
- Back up the database via cPanel *Backup* or a cron job running `mysqldump` (retention period: client question 8).
