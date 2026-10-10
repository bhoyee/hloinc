'use strict';

/**
 * Demo data rules, shared by the demo seeds and `npm run demo:remove`.
 *
 * Demo data always runs in development. On a server it runs only when the
 * server's .env says DEMO_DATA=true (for the preview site, so charts and lists
 * can be tried with realistic numbers), and the demo staff password comes from
 * DEMO_PASSWORD there — never from this repository, which is public.
 *
 * Everything made up is easy to find and remove, and can never match a real
 * person: visitor emails end in @example.com, demo staff in @hloinc.test, and
 * phone numbers are in the 555-0100…0199 range reserved for fiction.
 */

const STAFF_DOMAIN = '@hloinc.test';
const VISITOR_DOMAIN = '@example.com';
const DEV_PASSWORD = 'Portal-Demo-2026!';
// Marks on demo rows (appointments' staff notes, sign-in records).
const MARK = 'Demo data';
const AUDIT_IP = 'demo-seed';

const env = () => process.env.NODE_ENV || 'development';

/** May demo data be added here? */
function allowed() {
  if (env() === 'test') return false;
  if (env() === 'production') return process.env.DEMO_DATA === 'true';
  return true;
}

/** Password for the demo staff accounts, or null if none is set (production needs DEMO_PASSWORD). */
function staffPassword() {
  if (env() !== 'production') return DEV_PASSWORD;
  const p = process.env.DEMO_PASSWORD || '';
  return p.length >= 12 ? p : null;
}

/** Repeatable "random" numbers, so everyone sees the same demo charts. */
function random(seed = 7) {
  let n = seed;
  return () => (n = (n * 9301 + 49297) % 233280) / 233280;
}

/** A made-up phone number in the fictional 555-01xx range. */
const phone = (i) => `410-555-01${String(i % 100).padStart(2, '0')}`;

module.exports = { allowed, staffPassword, random, phone, STAFF_DOMAIN, VISITOR_DOMAIN, MARK, AUDIT_IP };
