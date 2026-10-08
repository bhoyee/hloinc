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
- [x] **Send a referral** page (`/referrals`) replacing the old WordPress referral form; saves to the intake inbox as type `referral`; old `/send-your-referrals/` URL redirects to it
- [x] Content carried over from current site: full conditions list (About), pledge + evidence-based approach (Services)
- [x] Layered spam protection on all public forms: 2 honeypots, one-time form tokens + minimum fill time, link-spam and duplicate detection, per-email daily limit, cross-site rejection, IP rate limits; optional Cloudflare Turnstile (off until keys are set)
- [x] Careers redesign: job cards with pay/location/schedule chips, "How to apply" card, job detail page with summary + sticky Apply (fixed bar on phones), Google JobPosting structured data; demo DSP jobs seeded in development only
- Still needed from HLO: corrected logo (current reads "Health Living", 300px JPG — ideally SVG), ZIP code, real photos of HLO staff/homes to replace the CC0 stock placeholders (see docs/photo-sources.md), recipient emails, approval of service copy + appointment types, "More inquiry" label wording

## Phase 2 — Auth, roles, accounts, audit ✅ done
- [x] Staff sign-in/out: new session ID on sign-in, 60-min idle + 12-hour absolute timeout, per-IP rate limit, 5-strike 15-minute lockout, identical error for every failure
- [x] Sessions revocable: deactivating, role/email change, password change and "sign out everywhere" end sessions immediately
- [x] Forgot password (same reply whether or not the email exists) and admin-sent reset links; one-time, hashed, expiring tokens; security-notice emails
- [x] Invitations: admins never see or set passwords — staff choose their own from a 72-hour one-time link
- [x] Permissions map (Section 4) enforced by middleware on every route; menu and dashboard tiles filtered by role **(roles still CONFIRM)**
- [x] Two-step sign-in (TOTP + 10 single-use recovery codes), secrets encrypted with APP_KEY, codes can't be replayed; required for Admin + Program Director **(CONFIRM — Q7)**
- [x] Accounts: list/search/filter, create + invite, edit, change role, resend invite, reset password, reset two-step, sign out, deactivate/reactivate, permanent delete (deactivated only, typed confirmation); can't change own role or lock out the last Admin
- [x] My Account: name/phone, change password, two-step set-up/manage, sign out other devices
- [x] Audit log: sign-ins (incl. failures/locks), all account and security changes; Admin viewer with search, person/action/date filters, details
- [x] Portal shell: sidebar (drawer on phones), dashboard with role-based counts, "Coming soon" list of later modules
- [x] Tests: 31 portal tests (152 total); axe clean on portal pages
- [x] **Roles & permissions (admin settings):** CEO/COO creates and edits roles; per-area View / Create & edit / Archive (temporary delete) / Delete permanently, plus area-specific options; per-role "require two-step sign-in"; Admin role locked; can't grant or assign more than you hold, edit your own role, or delete a role in use
- [x] Portal layout: full width, HLO logo, header with global search (live, Ctrl+K, permission-aware) and in-app notifications (bell, unread count, mark read, full page), profile menu, footer; mobile header, search bar and drawer
- [x] Notifications: new messages / referrals / appointment requests to roles that can see them; security alerts to the account owner
- [x] Idle timeout enforced server-side so background refreshes don't keep sessions alive
- [ ] Audit "viewed sensitive record" events — added with the modules that show sensitive records (Phases 3–4)

## Phase 3 — Appointments & schedules ✅ done
- [x] Appointment types managed in the portal (name, length, capacity, shown on website or not) — "Manage appointment types" permission **(CONFIRM real types — Q5)**
- [x] Inbox tabs: Requests, Upcoming, Needs outcome, All (search + type/source/status filters)
- [x] Confirm a request: date/time (Maryland time), length, assigned staff, optional note; visitor emailed; assignee notified
- [x] Statuses Requested → Confirmed → Completed / No-show, Cancel (with reason + email), Reopen; impossible moves refused
- [x] Walk-in / phone logging (Reception and above), optional email confirmation
- [x] Capacity and office-hours checks with "book anyway" (recorded in the audit log)
- [x] Calendar: week and month views, requests waiting panel; phone-friendly day list
- [x] Staff notes (internal), history timeline, permanent delete (Admin), "viewed appointment" audit events
- [x] Appointments in global search; dashboard tiles (requests, today, my next shift)
- [x] Staff schedule: team week grid (schedule.view) and "My schedule" for everyone; shifts and time off, overnight shifts, all-day, repeat weekly, clash checks; staff notified of changes
- [x] Fix: Directors, Coordinators and Intake can cancel appointments (§4) — migration adds the permission
- [ ] Leave / time-off *requests* by staff **(CONFIRM — Q11)**; managers can already record time off
- Tests: 22 new (201 total); axe clean on all Phase 3 screens
- Dashboard upgrade: live Maryland clock and office status, cards 3 per row (2 on phones) with hover effects, analytics charts (appointments by week and attendance rate, website enquiries, booking sources, staff sign-ins) with a table view, and silent refresh every 30 s that doesn't keep idle sessions alive
- New permission "Dashboard analytics → See charts" (Admin and Program Director by default); charts only cover areas the role can already see
- Tests: 8 more (209 total)

## Phase 4 — Jobs, announcements, contacts, site content ✅ done
- [x] Jobs: create, edit, publish, unpublish, archive, restore, copy, preview, permanent delete (archived only). ADP link must be https://. **Pay range + benefits required to publish** (Maryland Wage Range Transparency Act). Web address fixed once published. "- " bullet lines supported
- [x] Announcements: website / staff only / both, start and end dates in Maryland time (auto-expire), optional link, end now, archive, delete. Staff board on the dashboard; staff notified when a staff announcement goes live. Website ones show in the home page banner **(CONFIRM placement, client Q6)**
- [x] Contacts inbox: messages and referrals (with referral details), routed by recipient; New / In progress / Resolved; assign (notifies), internal notes, email replies (plain text, kept in history), honest "email not delivered" with resend; archive and permanent delete; viewing is audited. Intake Specialist sees intake & referrals only; Reception is read-only
- [x] Visual page editor (replaces the text-only forms): every public page — main pages, each service page, the two form pages and the four legal pages — opens in the portal as the real page. Click any text to type, click any photo (or the logo) to replace it from a media library or upload, change link addresses, add/move/copy/delete repeated items (cards, steps, values, FAQs, legal sections), and move or hide whole sections. Header, footer and shared sections are editable too. Page titles and Google descriptions in "Page settings". Edits save as a draft; Preview, then Publish; every published version kept (History → Restore); "Use the original page" to start again. Phone/tablet/desktop preview
- [x] Media library: uploads re-encoded to WebP in two sizes (location data stripped); images in use can't be deleted
- [x] Business details forms: contact details, office hours (drives the "Open now" badge), contact form email addresses. Every change audited with old and new values
- Program Director limited to the careers page and office hours **(CONFIRM)**
- Tests: 47 new (248 total); axe clean on all Phase 4 screens, desktop and phone

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
| 2026-10-06 | Added dedicated referral form (old site had one; doc §6.2 only required a section) | Developer request |
| 2026-10-06 | Transportation and nursing intentionally not listed as services | Requirements §2 (out of scope) — HLO to confirm they want them omitted entirely |
| 2026-10-06 | Jobs gain `pay_range` and `benefits` fields | Maryland Wage Range Transparency Act (Oct 2024) requires both in public postings |
| 2026-10-06 | Added "Home" to the main menu (now 5 links + Start intake; doc §3 said 4) | Visitors may not know the logo links home |
| 2026-10-06 | Phase 2 complete; staff invited by email link instead of admin-set passwords | Admins never handle staff passwords |
| 2026-10-06 | Roles and permissions became editable data (roles, role_permissions tables); MFA requirement moved from .env to each role | Client request: CEO/COO manages roles |
| 2026-10-06 | Added IT Administrator role (accounts incl. "manage everyone except Admins", roles view, audit view; two-step required; no client data) | Client request |
| 2026-10-07 | Phase 3 complete | — |
