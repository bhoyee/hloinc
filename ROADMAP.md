# HLO Inc. Website & Staff Portal — Roadmap

Source of truth: `HLO_Requirements_Document.docx` (v1.0 draft, Oct 6 2026).
Items marked **(CONFIRM)** are still waiting on client answers (Section 10 of the doc).
Additions/removals agreed later go in the **Change log** at the bottom.

---

## Tech stack (fixed for shared cPanel Node.js hosting)

| Concern | Choice |
|---|---|
| Runtime | Node.js 20+ (plain JavaScript, CommonJS for Passenger compatibility, no server build step) |
| Web server | Express 5, started from `app.js` (Passenger-compatible) |
| Views | Nunjucks, server-rendered |
| Styling | Tailwind CSS v4, compiled locally, output committed to `public/css` |
| Interactivity | Small vanilla JS / Alpine.js only where needed; FullCalendar for calendars |
| Database | MySQL 8 / MariaDB via Knex + mysql2 (migrations + seeds) |
| Sessions | express-session with MySQL store; httpOnly, secure, expiring, revocable |
| Passwords | bcryptjs (pure JS — no native compile on shared hosting) |
| MFA | TOTP via otplib (Admin + Program Director) **(CONFIRM)** |
| Security | helmet (strict CSP), CSRF tokens, express-rate-limit, zod validation, honeypot spam check |
| Email | Nodemailer over HLO SMTP, behind a `notify()` service (SMS can plug in later) |
| Tests | Vitest + Supertest (routes, permissions, validation); Playwright + axe (accessibility, Phase 5) |

---

## Phase 0 — Project setup ✅ done
- [x] Folder structure, package.json, scripts
- [x] Express app with security middleware (helmet/CSP, CSRF, rate limits, sessions)
- [x] Config loading from `.env` with validation
- [x] Knex + MySQL connection, migrations and seeds wired up
- [x] Base migrations: `users`, `audit_log`, `site_settings` (+ `sessions` created by the session store)
- [x] Nunjucks layouts: public layout + portal layout
- [x] Tailwind build with HLO design tokens (colors/typography placeholders until logo/brand colors arrive)
- [x] Error pages (404/500), health check
- [x] Test runner + first tests
- [x] Deployment notes for cPanel (`DEPLOY.md`)
- [x] Permissions matrix (§4) in `src/auth/permissions.js` with tests — pulled forward from Phase 2
- [x] Audit + notify services; `create-admin` CLI

## Phase 1 — Public website ✅ done (content awaiting client approval)
- [x] Design system: brand palette from logo (green #189F67 / red #E3242C), Plus Jakarta Sans + Inter (self-hosted), buttons, cards, forms, focus states
- [x] Header: logo, 4 nav links + **Start intake** button, office-hours bar; accessible mobile menu
- [x] Footer: address, phone, email, hours, site links, staff login
- [x] **Home** — hero, quick paths (Services / Location / Careers / Contact), services, approach, service areas, CTA
- [x] **About HLO** — mission, vision, values, support needs, eligibility note (no eligibility/clinical promises)
- [x] **Services** — index + five service pages **(DRAFT copy — HLO to approve the five services and wording)**
- [x] **Service Areas** — the ten Central & Southern Maryland counties
- [x] **Getting Started** — four steps, comparison table, "Talk to us about intake" (#referrals)
- [x] **Resources** — Maryland + national organizations, marked independent **(verify links before launch)**
- [x] **Careers** — published jobs from DB, job detail page, Apply → ADP (new tab)
- [x] **Contact** — recipient dropdown in §6.5 order, saves to DB + emails recipient, honest failure message, directions link, walk-in info
- [x] **Appointment request** — approved types only, weekday ≥ 1 day ahead ≤ 90 days, morning/afternoon, no medical fields, acknowledgement email
- [x] Public announcements: banner at top of the home page **(CONFIRM placement)**
- [x] Text served via `services/content.js` (defaults + `site_settings` overrides) so the Phase 4 editor needs no rework
- [x] SEO: titles/meta descriptions, sitemap.xml, robots.txt, 301s from old WordPress URLs, 410 for theme demo/spam pages
- [x] Spam protection: honeypot, minimum fill time, rate limits, CSRF
- [x] Tests: 52 passing (pages, redirects, forms, validation, careers, announcements) against `hloinc_test`
- [x] Accessibility: axe WCAG 2.1 AA scan clean at desktop + mobile (`npm run test:a11y`)
- [x] Redesign pass: red (actions/highlights) + green (brand/structure), real photography on every main page, hero photo first on mobile
- [x] Legal pages: Terms & Conditions, Privacy Policy, Data Protection, Cookie Policy (`src/content/legal.js`) **(DRAFT — HLO legal review before launch; add retention periods)**
- [x] Cookie notice (informational — only one strictly necessary cookie, `hlo.sid`; no tracking)
- [x] Footer: legal links + "Powered by GiddyHost"; favicon from logo; "not for emergencies — call 911 / 988" notice on contact page
- Still needed from HLO: corrected logo (current reads "Health Living", 300px JPG — ideally SVG), ZIP code, real photos of HLO staff/homes to replace the CC0 stock placeholders (see docs/photo-sources.md), recipient emails, approval of service copy + appointment types, "More inquiry" label wording

## Phase 2 — Auth, roles, accounts, audit
- [ ] Staff login/logout, session expiry + revocation, login rate limiting, lockout
- [ ] Password reset by Admin; "forgot password" email flow
- [ ] Permissions map (Section 4) enforced by middleware on every route/action
  - Roles: Admin (CEO/COO), Program Director, Program Coordinator, Intake Specialist, Reception **(CONFIRM)**
- [ ] MFA (TOTP) for Admin + Program Director **(CONFIRM)**
- [ ] Accounts module: create, edit, assign role, deactivate (soft delete), permanent delete (Admin only), reset access
- [ ] My Account: edit name/contact/password
- [ ] Audit log: who/what/when for create/change/delete/view-sensitive; Admin-only viewer with filters
- [ ] Portal shell: dashboard, sidebar nav filtered by role

## Phase 3 — Appointments & schedules
- [ ] Appointment types table (approved types only, no "General appointment") **(CONFIRM types, durations, capacity)**
- [ ] Website requests → status `Requested`; inbox of new requests
- [ ] Statuses: Requested, Confirmed, Completed, Cancelled, No-show
- [ ] Walk-in / phone logging by Reception and above
- [ ] Calendar view (day/week/month)
- [ ] Email confirmation to visitor on confirm/cancel (email only)
- [ ] Staff schedule: shifts/availability by day & week; own view vs manager edit; Reception view-only
- [ ] Leave / time-off requests **(CONFIRM — Q11)**

## Phase 4 — Jobs, announcements, contacts, site content
- [ ] Jobs: create/edit/publish/unpublish/archive; fields title, department, description, requirements, location, status, ADP link (validate ADP link is https://)
- [ ] Announcements: public / internal / both, start & end dates (auto-expire)
- [ ] Contacts inbox: routed by recipient, statuses New / In progress / Resolved, internal notes; Intake Specialist sees intake & referral only; Reception view-only
- [ ] Contact submissions emailed (plain text) to the matching HLO address; honest failure messages
- [ ] Site content editor: page text, office hours, address, contact details (Program Director limited to announcements, careers text, office hours **(CONFIRM)**)

## Phase 5 — Testing & launch
- [ ] Automated tests: validation, permissions matrix, form handling
- [ ] Accessibility audit (axe + manual keyboard/screen reader)
- [ ] Cross-browser/device testing
- [ ] Security review: CSP, headers, rate limits, session settings, dependency audit
- [ ] Re-check legal pages match the final build (cookies, MFA, retention, session revocation)
- [ ] Backups + data-retention job **(CONFIRM retention period — Q8)**
- [ ] Production deploy on cPanel, HTTPS, SMTP credentials, DNS cutover from WordPress
- [ ] Remove old WordPress (it currently has injected spam links — treat as compromised)

---

## Open client questions (from doc Section 10)
1. What did "can we integrate…" refer to?
2. Roles & permissions approval
3. ZIP code for 4 East Rolling Crossroads
4. Email address per contact recipient
5. Appointment types, durations, capacity
6. Announcements: public, internal, or both
7. MFA approval
8. Record retention period
9. Hosting/domain/email credential ownership — **answered: shared Node.js hosting with terminal**
10. Main contact for approvals/testing
11. Schedules: shifts only, or leave/time-off too

## Change log
| Date | Change | Reason |
|---|---|---|
| 2026-10-06 | Hosting = shared cPanel with Node.js; DB = MySQL; prototype phase skipped | Developer decision |
| 2026-10-06 | Phase 0 setup complete | — |
| 2026-10-06 | Five services drafted (Personal Supports, Community Residential, Supported Living, Respite Care, Community Development) | Live site listed only two; HLO to approve |
| 2026-10-06 | Contact recipient "More inquiry" shown as "General inquiry" | Clearer wording; HLO to confirm |
| 2026-10-06 | Phase 1 public website complete | — |
| 2026-10-06 | Added legal pages, cookie notice, "Powered by GiddyHost" | Developer request |
