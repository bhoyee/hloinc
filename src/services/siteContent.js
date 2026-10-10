'use strict';

/*
 * Business details for the website (requirements §5.8): contact details,
 * office hours and contact form email addresses, saved to `site_settings`.
 * Page text, images and layout are edited visually instead (services/cms.js).
 *
 * "Edit all content" covers every section. "Limited" editing (Program
 * Director, §4) covers office hours here, and the careers page in the editor.
 */
const db = require('../db/knex');
const { isUsPhone, normalizePhone, PHONE_MAX } = require('../validation/phone');
const { can } = require('../auth/permissions');
const site = require('../lib/site');
const content = require('./content');

const LIMITED = 'site_content.edit_limited';
const FULL = 'site_content.edit';

const SECTIONS = [
  { key: 'contact', label: 'Contact details', icon: 'phone', description: 'Phone, email and address shown across the site.', permissions: [FULL] },
  { key: 'hours', label: 'Office hours', icon: 'clock', description: 'Opening hours, the “Open now” badge and the walk-in note.', permissions: [FULL, LIMITED] },
  { key: 'recipients', label: 'Team email addresses', icon: 'mail', description: 'Where each contact form choice, referrals, service requests and appointment requests are emailed.', permissions: [FULL] },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Sections this person can open: everything for "View" or "Edit all", otherwise the limited ones. */
function sectionsFor(user) {
  if (can(user, 'site_content.view')) return SECTIONS;
  return SECTIONS.filter((s) => s.permissions.some((p) => can(user, p)));
}

function find(key) {
  return SECTIONS.find((s) => s.key === key) || null;
}

const canEdit = (user, section) => section.permissions.some((p) => can(user, p));

// --- Current values ----------------------------------------------------------------------

async function current(section) {
  const business = await content.getBusiness();
  if (section.key === 'contact') {
    return { phone: business.phone, email: business.email, ...business.address };
  }
  if (section.key === 'hours') {
    return { hours: business.hours, walkIn: business.walkIn, days: business.schedule.days.map(String), open: String(business.schedule.open), close: String(business.schedule.close) };
  }
  if (section.key === 'recipients') {
    const values = {};
    for (const r of site.mailboxes) values[r.key] = await content.getRecipientEmail(r.key, { fallback: false });
    return values;
  }
  return {};
}

// --- Reading the form ----------------------------------------------------------------------

const str = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readContact(body) {
  const data = { phone: str(body.phone), email: str(body.email).toLowerCase(), street: str(body.street), city: str(body.city), state: str(body.state).toUpperCase(), zip: str(body.zip) };
  const errors = {};
  if (data.phone.length > PHONE_MAX || !isUsPhone(data.phone)) errors.phone = 'Enter a valid US phone number, like (410) 555-0123.';
  else data.phone = normalizePhone(data.phone);
  if (!EMAIL.test(data.email) || data.email.length > 191) errors.email = 'Enter a valid email address.';
  if (!data.street || data.street.length > 160) errors.street = 'Enter the street address.';
  if (!data.city || data.city.length > 80) errors.city = 'Enter the city.';
  if (!/^[A-Z]{2}$/.test(data.state)) errors.state = 'Use the two-letter state code, e.g. MD.';
  if (data.zip && !/^\d{5}(-\d{4})?$/.test(data.zip)) errors.zip = 'Enter a 5-digit ZIP code.';
  return { data, errors };
}

function readHours(body) {
  const days = [].concat(body.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const open = Number(body.open);
  const close = Number(body.close);
  const data = { hours: str(body.hours), walkIn: str(body.walkIn), days: [...new Set(days)].sort(), open, close };
  const errors = {};
  if (!data.days.length) errors.days = 'Choose at least one day the office is open.';
  if (!Number.isInteger(open) || open < 0 || open > 23) errors.open = 'Choose an opening time.';
  if (!Number.isInteger(close) || close < 1 || close > 24) errors.close = 'Choose a closing time.';
  else if (!errors.open && close <= open) errors.close = 'Closing time must be after opening time.';
  if (!data.hours || data.hours.length > 120) errors.hours = 'Describe the hours in under 120 characters.';
  if (!data.walkIn || data.walkIn.length > 400) errors.walkIn = 'Write the walk-in note in under 400 characters.';
  return { data, errors };
}

function readRecipients(body) {
  const data = {};
  const errors = {};
  for (const r of site.mailboxes) {
    const v = str(body[r.key]).toLowerCase();
    if (v && (!EMAIL.test(v) || v.length > 191)) errors[r.key] = 'Enter a valid email address, or leave blank to use the main email.';
    data[r.key] = v;
  }
  return { data, errors };
}

function read(section, body) {
  if (section.key === 'contact') return readContact(body);
  if (section.key === 'hours') return readHours(body);
  return readRecipients(body);
}

// --- Saving ----------------------------------------------------------------------------------

async function put(rows, user) {
  for (const [key, value] of Object.entries(rows)) {
    await db('site_settings')
      .insert({ key, value: JSON.stringify(value), updated_by: user.id, updated_at: new Date() })
      .onConflict('key')
      .merge();
  }
  content.clearCache();
}

/** Save a section. Returns the names of the fields that changed, with before/after values for the audit log. */
async function save(section, data, user) {
  const before = await current(section);
  if (section.key === 'contact') {
    await put({ 'business.phone': data.phone, 'business.email': data.email, 'business.address': { street: data.street, city: data.city, state: data.state, zip: data.zip } }, user);
  } else if (section.key === 'hours') {
    await put({ 'business.hours': data.hours, 'business.walk_in': data.walkIn, 'business.schedule': { days: data.days, open: data.open, close: data.close } }, user);
  } else if (section.key === 'recipients') {
    await put({ 'contact.recipient_emails': Object.fromEntries(Object.entries(data).filter(([, v]) => v)) }, user);
  }
  const after = await current(section);
  const norm = (v) => JSON.stringify(Array.isArray(v) ? v.map(String) : v);
  const changed = Object.keys(after).filter((k) => norm(before[k]) !== norm(after[k]));
  return {
    changed,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: Object.fromEntries(changed.map((k) => [k, after[k]])),
  };
}

/** When each section was last changed, and by whom. */
async function lastChanged() {
  const rows = await db('site_settings as s').leftJoin('users as u', 'u.id', 's.updated_by').select('s.key', 's.updated_at', 'u.name');
  const keysFor = {
    contact: ['business.phone', 'business.email', 'business.address'],
    hours: ['business.hours', 'business.walk_in', 'business.schedule'],
    recipients: ['contact.recipient_emails'],
  };
  const out = {};
  for (const s of SECTIONS) {
    const keys = keysFor[s.key];
    const latest = rows.filter((r) => keys.includes(r.key) && r.name).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    if (latest) out[s.key] = { at: latest.updated_at, by: latest.name };
  }
  return out;
}

module.exports = { SECTIONS, DAY_NAMES, sectionsFor, find, canEdit, current, read, save, lastChanged };
