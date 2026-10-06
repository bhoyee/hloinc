# HLO Inc. — Website & Staff Portal

Node.js (Express) public website and role-based staff portal for Healthy Living Option Inc.
Scope and phases: [ROADMAP.md](ROADMAP.md). Hosting: [DEPLOY.md](DEPLOY.md).

## Local setup

Requires Node 20+ and MySQL 8 / MariaDB.

```bash
npm install
cp .env.example .env          # set DB_* and SESSION_SECRET
# create the database: CREATE DATABASE hloinc CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
npm run migrate
npm run seed
npm run create-admin -- --name "Your Name" --email you@example.com
npm run css:watch             # terminal 1
npm run dev                   # terminal 2
```

> On this dev machine WAMP runs MySQL 8.4 on port **3308** (MariaDB is on 3306), and the app runs on
> port **4310** because 3000/3100 are used by other projects.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start with auto-restart on changes |
| `npm start` | Start (production) |
| `npm run css:build` / `css:watch` | Compile Tailwind to `public/css/app.css` (commit the output) |
| `npm run migrate` / `migrate:rollback` | Database migrations |
| `npm run seed` | Default site settings (safe to re-run) |
| `npm run create-admin` | Create an Admin account from the terminal |
| `npm test` | Run tests (needs local MySQL; uses a separate `<DB_NAME>_test` database) |
| `npm run test:a11y` | WCAG 2.1 AA scan with axe (app must be running) |
| `npm run screens -- <outDir> <paths…>` | Desktop + mobile screenshots (app must be running) |

## Layout

```
app.js                 entry point (Passenger / cPanel)
knexfile.js            database config
src/
  config/              env loading + validation
  server.js            Express app (security, sessions, views, routes)
  auth/permissions.js  roles & permission matrix (requirements §4)
  middleware/          security (CSP, CSRF, rate limits), session, errors
  routes/              public site; routes/portal = staff portal
  services/            audit log, notifications (email; SMS-ready)
  lib/                 site defaults, icons, form helpers
  content/             page text, services, areas, resources (defaults)
  validation/          zod schemas for public forms
  db/migrations, seeds
  views/               Nunjucks layouts, partials, pages
  assets/css/app.css   Tailwind source + design tokens
public/                static files served as-is
storage/               private files (never served)
scripts/               CLI tools
tests/                 Vitest + Supertest
```
