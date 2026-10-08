'use strict';

/*
 * The website content editor (requirements §5.8): page text, office hours,
 * address and contact details, saved to `site_settings` so they change
 * without a developer. Defaults live in lib/site.js and content/pages.js.
 *
 * "Edit all content" covers every section. "Limited" editing (Program
 * Director, §4) covers the careers text and office hours only.
 */
const db = require('../db/knex');
const { can } = require('../auth/permissions');
const site = require('../lib/site');
const pages = require('../content/pages');
const content = require('./content');

const LIMITED = 'site_content.edit_limited';
const FULL = 'site_content.edit';

/* Field types: text (one line), area (paragraph), lines (one item per line), group (repeated set of fields). */
const PAGE_FIELDS = {
  home: [
    { key: 'eyebrow', label: 'Small heading above the title', type: 'text', max: 80 },
    { key: 'title', label: 'Main headline', type: 'text', max: 120 },
    { key: 'intro', label: 'Introduction', type: 'area', max: 400 },
    { key: 'approachTitle', label: '“Our approach” heading', type: 'text', max: 120 },
    { key: 'approach', label: '“Our approach” text', type: 'area', max: 800 },
  ],
  about: [
    { key: 'title', label: 'Page title', type: 'text', max: 80 },
    { key: 'intro', label: 'Introduction', type: 'area', max: 400 },
    { key: 'mission', label: 'Our mission', type: 'area', max: 800 },
    { key: 'vision', label: 'Our vision', type: 'area', max: 800 },
    { key: 'values', label: 'Our values', type: 'group', fields: [{ key: 'name', label: 'Value', type: 'text', max: 40 }, { key: 'text', label: 'Description', type: 'area', max: 300 }] },
    { key: 'supportNeeds', label: 'Who we support', type: 'lines', max: 80, maxItems: 40, hint: 'One per line. Shown as a list on the About page.' },
    { key: 'eligibilityNote', label: 'Eligibility note', type: 'area', max: 500 },
  ],
  services: [
    { key: 'pledge', label: 'Our pledge', type: 'area', max: 500 },
    { key: 'approach', label: 'Our approach', type: 'area', max: 800 },
  ],
  gettingStarted: [
    { key: 'title', label: 'Page title', type: 'text', max: 80 },
    { key: 'intro', label: 'Introduction', type: 'area', max: 400 },
    { key: 'steps', label: 'How it works (steps)', type: 'group', fields: [{ key: 'who', label: 'Who', type: 'text', max: 40 }, { key: 'title', label: 'Step', type: 'text', max: 80 }, { key: 'text', label: 'Description', type: 'area', max: 400 }] },
    { key: 'referralTitle', label: 'Referral section heading', type: 'text', max: 120 },
    { key: 'referralText', label: 'Referral section text', type: 'area', max: 600 },
  ],
  careers: [
    { key: 'title', label: 'Headline', type: 'text', max: 120 },
    { key: 'intro', label: 'Introduction', type: 'area', max: 400 },
    { key: 'whyTitle', label: '“Why work at HLO” heading', type: 'text', max: 120 },
    { key: 'why', label: 'Reasons to work at HLO', type: 'group', fields: [{ key: 'title', label: 'Reason', type: 'text', max: 60 }, { key: 'text', label: 'Description', type: 'area', max: 200 }] },
    { key: 'steps', label: 'How to apply (steps)', type: 'group', fields: [{ key: 'title', label: 'Step', type: 'text', max: 60 }, { key: 'text', label: 'Description', type: 'area', max: 250 }] },
    { key: 'applyNote', label: 'Note about applying', type: 'area', max: 300 },
  ],
};

const SECTIONS = [
  { key: 'contact', label: 'Contact details', icon: 'phone', description: 'Phone, email and address shown across the site.', permissions: [FULL] },
  { key: 'hours', label: 'Office hours', icon: 'clock', description: 'Opening hours, the “Open now” badge and the walk-in note.', permissions: [FULL, LIMITED] },
  { key: 'recipients', label: 'Contact form email addresses', icon: 'mail', description: 'Where each contact form choice is emailed.', permissions: [FULL] },
  { key: 'home', label: 'Home page', icon: 'home', description: 'Headline, introduction and “Our approach”.', permissions: [FULL], page: true, href: '/' },
  { key: 'about', label: 'About page', icon: 'heart', description: 'Mission, vision, values and who we support.', permissions: [FULL], page: true, href: '/about' },
  { key: 'services', label: 'Services page', icon: 'hand-heart', description: 'Our pledge and approach.', permissions: [FULL], page: true, href: '/services' },
  { key: 'gettingStarted', label: 'Getting started page', icon: 'chat', description: 'Introduction, steps and the referral section.', permissions: [FULL], page: true, href: '/getting-started' },
  { key: 'careers', label: 'Careers page', icon: 'briefcase', description: 'Headline, reasons to join and how to apply.', permissions: [FULL, LIMITED], page: true, href: '/careers' },
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
    for (const r of site.recipients) values[r.key] = await content.getRecipientEmail(r.key, { fallback: false });
    return values;
  }
  return content.getPage(section.key);
}

/** Saved overrides for a page (empty object if it uses the defaults). */
async function savedPage(key) {
  const row = await db('site_settings').where({ key: `page.${key}` }).first();
  return row ? JSON.parse(row.value) : {};
}

// --- Reading the form ----------------------------------------------------------------------

const str = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readPage(key, body) {
  const data = {};
  const errors = {};
  const defaults = pages[key];
  for (const f of PAGE_FIELDS[key]) {
    if (f.type === 'text' || f.type === 'area') {
      const v = str(body[f.key]);
      if (!v) errors[f.key] = `${f.label} can’t be empty.`;
      else if (v.length > f.max) errors[f.key] = `Keep this under ${f.max} characters (it’s ${v.length}).`;
      data[f.key] = v;
    } else if (f.type === 'lines') {
      const items = str(body[f.key]).split('\n').map((l) => l.trim()).filter(Boolean);
      if (!items.length) errors[f.key] = 'Add at least one line.';
      else if (items.length > f.maxItems) errors[f.key] = `At most ${f.maxItems} lines.`;
      else if (items.some((l) => l.length > f.max)) errors[f.key] = `Keep each line under ${f.max} characters.`;
      data[f.key] = items;
    } else if (f.type === 'group') {
      // A fixed number of items, matching the page design. Hidden parts (like icons) keep their defaults.
      data[f.key] = defaults[f.key].map((item, i) => {
        const out = { ...item };
        for (const sub of f.fields) {
          const name = `${f.key}__${i}__${sub.key}`;
          const v = str(body[name]);
          if (!v) errors[name] = `${sub.label} ${i + 1} can’t be empty.`;
          else if (v.length > sub.max) errors[name] = `Keep this under ${sub.max} characters (it’s ${v.length}).`;
          out[sub.key] = v;
        }
        return out;
      });
    }
  }
  return { data, errors };
}

function readContact(body) {
  const data = { phone: str(body.phone), email: str(body.email).toLowerCase(), street: str(body.street), city: str(body.city), state: str(body.state).toUpperCase(), zip: str(body.zip) };
  const errors = {};
  if (!/^[+()\-.\s\d]{7,}$/.test(data.phone) || data.phone.replace(/\D/g, '').length < 10) errors.phone = 'Enter a valid phone number.';
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
  for (const r of site.recipients) {
    const v = str(body[r.key]).toLowerCase();
    if (v && (!EMAIL.test(v) || v.length > 191)) errors[r.key] = 'Enter a valid email address, or leave blank to use the main email.';
    data[r.key] = v;
  }
  return { data, errors };
}

function read(section, body) {
  if (section.key === 'contact') return readContact(body);
  if (section.key === 'hours') return readHours(body);
  if (section.key === 'recipients') return readRecipients(body);
  return readPage(section.key, body);
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
  } else {
    // Store only what differs from the built-in text, so improvements to the defaults still show.
    const defaults = pages[section.key];
    const overrides = Object.fromEntries(Object.entries(data).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(defaults[k])));
    if (Object.keys(overrides).length) await put({ [`page.${section.key}`]: overrides }, user);
    else await reset(section);
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

/** Put a page back to its built-in text. */
async function reset(section) {
  await db('site_settings').where({ key: `page.${section.key}` }).del();
  content.clearCache();
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
    const keys = keysFor[s.key] || [`page.${s.key}`];
    const latest = rows.filter((r) => keys.includes(r.key) && r.name).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    if (latest) out[s.key] = { at: latest.updated_at, by: latest.name };
  }
  return out;
}

module.exports = { SECTIONS, PAGE_FIELDS, DAY_NAMES, sectionsFor, find, canEdit, current, savedPage, read, save, reset, lastChanged };
