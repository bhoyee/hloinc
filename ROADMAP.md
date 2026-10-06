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

## Phase 1 — Public website
- [ ] Design system: colors, type scale, buttons, cards, forms, header/footer, focus states (WCAG 2.1 AA)
- [ ] Header: logo, 4 nav links + **Intake** button; mobile menu
- [ ] Footer: address, phone 410-874-8551, info@hloinc.com, hours Mon–Fri 9–5
- [ ] **Home** — intro, paths to Services / Location / Careers / Contact, intake CTA
- [ ] **About HLO** — mission, vision, values, support needs (no eligibility/clinical promises)
- [ ] **Services** — index + the five non-nursing service pages
- [ ] **Service Areas** — the ten Central & Southern Maryland counties
- [ ] **Getting Started / Intake** — guidance, comparisons, "Talk to us about intake" (referrals)
- [ ] **Resources** — national orgs + Maryland planning resources (marked as independent)
- [ ] **Careers** — reads job postings from DB, Apply → ADP link
- [ ] **Contact** — form with recipient dropdown (More inquiry, Program coordinator, Program director, CEO/COO, Intake specialist), map/directions link, walk-in info
- [ ] **Appointment request** form (scheduled, in advance; no diagnoses/medication fields)
- [ ] Public announcements display **(CONFIRM placement)**
- [ ] All page text stored in DB (`site_settings` / `page_content`) so Phase 4 editor needs no rework
- [ ] SEO: titles/meta, sitemap.xml, robots.txt, 301 redirects from old WordPress URLs
- Client input: ZIP code, logo, brand colors, photos, recipient emails

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
- [ ] Jobs: create/edit/publish/unpublish/archive; fields title, department, description, requirements, location, status, ADP link
- [ ] Announcements: public / internal / both, start & end dates (auto-expire)
- [ ] Contacts inbox: routed by recipient, statuses New / In progress / Resolved, internal notes; Intake Specialist sees intake & referral only; Reception view-only
- [ ] Contact submissions emailed (plain text) to the matching HLO address; honest failure messages
- [ ] Site content editor: page text, office hours, address, contact details (Program Director limited to announcements, careers text, office hours **(CONFIRM)**)

## Phase 5 — Testing & launch
- [ ] Automated tests: validation, permissions matrix, form handling
- [ ] Accessibility audit (axe + manual keyboard/screen reader)
- [ ] Cross-browser/device testing
- [ ] Security review: CSP, headers, rate limits, session settings, dependency audit
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
