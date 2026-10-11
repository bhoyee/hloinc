'use strict';

/**
 * Get help: staff report a problem or ask a question from anywhere in the portal.
 *
 * - The request records who sent it, the page they were on, their browser and
 *   window size, and any error reference, so nobody has to explain where they were.
 * - The people chosen for "New help request" (Roles & permissions → Alerts; IT
 *   Administrator and Admin by default) get a bell alert and an email.
 * - "Something isn't working" reports are also emailed to the developer/support
 *   address, if one is set (Help requests → Settings). The screenshot stays in the portal.
 * - Status: Open → In progress → Fixed. The sender is told about every reply and
 *   when it's fixed; if they reply to a fixed request, it opens again.
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/knex');
const config = require('../config');
const { can } = require('../auth/permissions');
const { insertWithReference, normalizeSearch } = require('../lib/reference');
const notifications = require('./notifications');
const { notify } = require('./notify');

const CATEGORIES = {
  broken: { label: 'Something isn’t working', icon: 'wrench', hint: 'An error, a page that won’t load, a button that does nothing.' },
  howto: { label: 'How do I…?', icon: 'question', hint: 'You’re not sure how to do something in the portal.' },
  access: { label: 'Access or password', icon: 'key', hint: 'Signing in, two-step codes, or a page you can’t open.' },
  suggestion: { label: 'Suggestion', icon: 'light-bulb', hint: 'An idea to make the portal better.' },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);
const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', fixed: 'Fixed' };
const FORWARD_SETTING = 'support.forward_email';
const PER_HOUR = 10;

const DIR = path.join(config.paths.storage, 'support');
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const FILE = /^[a-f0-9]{32}\.webp$/;

const problem = (message) => Object.assign(new Error(message), { status: 422 });
const portalUrl = (id) => `${config.appUrl}/portal/help/${id}`;
const firstName = (name) => String(name || '').split(' ')[0];

/** "Chrome 141 on Windows" from a user-agent string. */
function browserOf(ua) {
  const s = String(ua || '');
  const pick = (re, name) => {
    const m = s.match(re);
    return m ? `${name} ${m[1]}` : null;
  };
  const browser = pick(/Edg\/(\d+)/, 'Edge') || pick(/OPR\/(\d+)/, 'Opera') || pick(/Firefox\/(\d+)/, 'Firefox')
    || pick(/Chrome\/(\d+)/, 'Chrome') || pick(/Version\/(\d+)[\d.]* .*Safari/, 'Safari') || 'Unknown browser';
  const os = /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`.slice(0, 120);
}

// --- Screenshot ------------------------------------------------------------------------------

/**
 * Check and re-encode a screenshot as WebP (at most 1920 px wide). Re-encoding
 * throws away anything that isn't the picture itself. Returns the file name, or null.
 */
async function saveScreenshot(file) {
  if (!file || !file.size) return null;
  if (!ALLOWED.has(file.mimetype)) throw problem('The screenshot must be a PNG, JPG, WebP or GIF image.');
  if (file.size > MAX_BYTES) throw problem('That screenshot is over 5 MB. Please choose a smaller one.');
  const sharp = require('sharp');
  let meta;
  try {
    meta = await sharp(file.buffer).metadata();
  } catch {
    throw problem('That file isn’t an image we can read.');
  }
  if (!meta.width || !meta.height || meta.width * meta.height > 60e6) throw problem('That screenshot is too large to use.');
  const name = `${crypto.randomBytes(16).toString('hex')}.webp`;
  await fs.mkdir(DIR, { recursive: true });
  await sharp(file.buffer).rotate().resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(DIR, name));
  return name;
}

/** Full path of a stored screenshot, or null. */
const screenshotFile = (name) => (FILE.test(String(name)) ? path.join(DIR, name) : null);

// --- Who is told ------------------------------------------------------------------------------

async function forwardEmail() {
  const value = await require('./content').getSetting(FORWARD_SETTING, '');
  return typeof value === 'string' ? value : '';
}

async function setForwardEmail(email, user) {
  await db('site_settings').insert({ key: FORWARD_SETTING, value: JSON.stringify(email), updated_by: user.id, updated_at: new Date() }).onConflict('key').merge();
  require('./content').clearCache();
}

/** Plain-text details block used in emails. */
function detailLines(r, roleName) {
  return [
    `Reference: ${r.reference}`,
    `From: ${r.user_name}${roleName ? ` (${roleName})` : ''}`,
    `About: ${CATEGORIES[r.category].label}`,
    ...(r.page_url ? [`Page: ${config.appUrl}${r.page_url}`] : []),
    `Browser: ${r.browser || 'unknown'}${r.screen ? ` · window ${r.screen}` : ''}`,
    ...(r.error_ref ? [`Error reference: ${r.error_ref} (search the server's error log for it)`] : []),
  ];
}

async function tellSupport(r, sender) {
  const alerts = require('./alerts');
  const people = (await alerts.peopleFor('support')).filter((p) => p.id !== sender.id);
  const title = `Help request from ${sender.name}`;
  const body = `${CATEGORIES[r.category].label} · ${r.message.slice(0, 140)}`;
  await Promise.all(people.map((p) => notifications.notifyUser(p.id, { type: 'support', title, body, link: `/portal/help/${r.id}` })));
  await Promise.all(people.filter((p) => p.email).map((p) => notify({
    to: p.email,
    replyTo: sender.email,
    subject: `${title}: ${CATEGORIES[r.category].label} (${r.reference})`,
    text: [
      `Hello ${firstName(p.name)},`,
      '',
      `${sender.name} asked for help in the staff portal.`,
      '',
      ...detailLines(r, sender.roleLabel),
      '',
      'WHAT THEY SAID',
      r.message,
      ...(r.screenshot ? ['', 'They attached a screenshot; it’s in the portal.'] : []),
    ].join('\n'),
    cta: { label: 'Open the request', href: portalUrl(r.id) },
    footnote: 'Sent by the HLO staff portal because your role is told about new help requests (Roles & permissions → Alerts).',
  })));
  return people.length;
}

/** Problem reports also go to the developer/support address (no screenshot: it may show client details). */
async function forwardToDeveloper(r, sender) {
  const to = await forwardEmail();
  if (!to || r.category !== 'broken') return false;
  const sent = await notify({
    to,
    replyTo: sender.email,
    subject: `HLO portal problem report ${r.reference}`,
    text: [
      'A staff member reported a problem in the HLO staff portal.',
      '',
      ...detailLines(r, sender.roleLabel),
      `Sent: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} (Maryland time)`,
      '',
      'WHAT HAPPENED',
      r.message,
      ...(r.screenshot ? ['', 'A screenshot was attached; it can be seen in the portal by Admin and IT.'] : []),
      '',
      'Reply to this email to answer the staff member directly. Please also update the request in the portal (Help requests) so everyone can see where it stands.',
    ].join('\n'),
    footnote: 'Sent by the HLO staff portal because this address receives problem reports (Help requests → Settings).',
  });
  if (sent && sent.ok === false) return false;
  await db('support_requests').where({ id: r.id }).update({ forwarded_at: db.fn.now() });
  return true;
}

// --- Reading ---------------------------------------------------------------------------------

function base() {
  return db('support_requests as r')
    .leftJoin('users as h', 'h.id', 'r.handled_by')
    .leftJoin('users as u', 'u.id', 'r.user_id')
    .select('r.*', 'h.name as handled_by_name', 'u.email as user_email', 'u.avatar as user_avatar');
}

const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const TABS = {
  open: { label: 'Open', support: true },
  fixed: { label: 'Fixed', support: true },
  all: { label: 'All', support: true },
  mine: { label: 'My requests', support: false },
};

function scoped(query, user, tab) {
  if (tab === 'mine' || !can(user, 'support.view')) return query.where('r.user_id', user.id);
  if (tab === 'open') query.whereIn('r.status', ['open', 'in_progress']);
  if (tab === 'fixed') query.where('r.status', 'fixed');
  return query;
}

async function tabCounts(user) {
  const count = async (tab) => Number((await scoped(db('support_requests as r'), user, tab).count({ n: '*' }).first()).n);
  const support = can(user, 'support.view');
  return { open: support ? await count('open') : null, fixed: support ? await count('fixed') : null, all: support ? await count('all') : null, mine: await count('mine') };
}

async function list(user, { tab = 'mine', q = '', page = 1, perPage = 25 } = {}) {
  const query = scoped(base(), user, tab);
  if (q) {
    const code = normalizeSearch(q);
    query.where((w) => {
      w.where('r.message', 'like', likeOf(q)).orWhere('r.user_name', 'like', likeOf(q)).orWhere('r.error_ref', q.toUpperCase());
      if (code) w.orWhere('r.reference', 'like', `%${code}`);
    });
  }
  const total = Number((await query.clone().clearSelect().count({ n: '*' }).first()).n);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const items = await query
    .orderByRaw("FIELD(r.status, 'open', 'in_progress', 'fixed')")
    .orderBy('r.id', 'desc')
    .limit(perPage)
    .offset((current - 1) * perPage);
  return { items, total, page: current, pages };
}

/** One request, if this person may see it (their own, or anyone's with "See everyone's"). */
async function getFor(user, id) {
  const r = await base().where('r.id', id).first();
  if (!r) return null;
  if (r.user_id !== user.id && !can(user, 'support.view')) return null;
  return r;
}

function updates(requestId) {
  return db('support_updates as s').leftJoin('users as u', 'u.id', 's.user_id')
    .where('s.request_id', requestId).orderBy('s.id').select('s.*', 'u.avatar as user_avatar');
}

/** Requests nobody has picked up yet (the menu counter for people who deal with them). */
async function openCount(user) {
  if (!can(user, 'support.view')) return null;
  return Number((await db('support_requests').where({ status: 'open' }).count({ n: '*' }).first()).n);
}

/** The sender's most recent requests (shown beside the form). */
function recentFor(user, limit = 5) {
  return db('support_requests').where({ user_id: user.id }).orderBy('id', 'desc').limit(limit);
}

// --- Actions ---------------------------------------------------------------------------------

async function create(user, data, { file, userAgent } = {}) {
  // Timestamps are compared and written by the database, so they share its clock and time zone.
  const recent = Number((await db('support_requests').where({ user_id: user.id }).where('created_at', '>', db.raw('NOW() - INTERVAL 1 HOUR')).count({ n: '*' }).first()).n);
  if (recent >= PER_HOUR) throw problem('You’ve sent a lot of requests in the last hour. Please wait a little, or call the office if it’s urgent.');

  const screenshot = await saveScreenshot(file);
  const { id } = await insertWithReference(db, 'support_requests', {
    user_id: user.id,
    user_name: user.name,
    category: data.category,
    message: data.message,
    page_url: data.from || null,
    browser: browserOf(userAgent),
    screen: data.screen || null,
    error_ref: data.error_ref || null,
    screenshot,
  }, 'help');
  const r = await base().where('r.id', id).first();
  const told = await tellSupport(r, user);
  const forwarded = await forwardToDeveloper(r, user);
  return { request: r, told, forwarded };
}

/**
 * Add a reply and/or change the status. Only people with "Reply & update status"
 * can change the status; when the sender replies to a fixed request it opens again.
 * The other side is told (bell and email).
 */
async function reply(r, actor, { body = '', status = '' } = {}) {
  const support = can(actor, 'support.edit');
  const mine = r.user_id === actor.id;
  let next = r.status;
  if (support && STATUS_LABELS[status]) next = status;
  else if (mine && r.status === 'fixed' && body) next = 'open';
  if (!body && next === r.status) return { changed: false };

  await db('support_updates').insert({ request_id: r.id, user_id: actor.id, user_name: actor.name, body: body || null, status: next !== r.status ? next : null });
  await db('support_requests').where({ id: r.id }).update({
    status: next,
    handled_by: support && !mine && !r.handled_by ? actor.id : r.handled_by,
    fixed_at: next === 'fixed' ? (r.fixed_at || db.fn.now()) : null,
    updated_at: db.fn.now(),
  });

  const what = next !== r.status ? `${STATUS_LABELS[next]}${body ? ` · “${body.slice(0, 120)}”` : ''}` : `“${body.slice(0, 160)}”`;
  if (!mine && r.user_id) {
    const title = next === 'fixed' && next !== r.status ? `Your help request is fixed (${r.reference})` : `Update on your help request (${r.reference})`;
    await notifications.notifyUser(r.user_id, { type: 'support', title, body: what, link: `/portal/help/${r.id}` });
    if (r.user_email) {
      await notify({
        to: r.user_email,
        subject: title,
        text: [
          `Hello ${firstName(r.user_name)},`,
          '',
          next !== r.status ? `${actor.name} marked your help request as ${STATUS_LABELS[next].toLowerCase()}.` : `${actor.name} replied to your help request.`,
          ...(body ? ['', body] : []),
          '',
          'YOUR REQUEST',
          `${CATEGORIES[r.category].label}: ${r.message.slice(0, 300)}${r.message.length > 300 ? '…' : ''}`,
          ...(next === 'fixed' ? ['', 'Still not right? Reply in the portal and it opens again.'] : []),
        ].join('\n'),
        cta: { label: 'View the request', href: portalUrl(r.id) },
        footnote: 'Sent by the HLO staff portal because you asked for help.',
      });
    }
  } else if (mine) {
    // The sender added something: tell whoever is handling it, or everyone who deals with requests.
    const people = r.handled_by
      ? await db('users').where({ id: r.handled_by, status: 'active' }).select('id', 'name', 'email')
      : await require('./alerts').peopleFor('support');
    const others = people.filter((p) => p.id !== actor.id);
    const title = next === 'open' && r.status === 'fixed' ? `Help request opened again by ${actor.name}` : `${actor.name} replied to their help request`;
    await Promise.all(others.map((p) => notifications.notifyUser(p.id, { type: 'support', title, body: what, link: `/portal/help/${r.id}` })));
    await Promise.all(others.filter((p) => p.email).map((p) => notify({
      to: p.email,
      replyTo: actor.email,
      subject: `${title} (${r.reference})`,
      text: [`Hello ${firstName(p.name)},`, '', `${title}:`, '', body, '', `About: ${CATEGORIES[r.category].label}`].join('\n'),
      cta: { label: 'Open the request', href: portalUrl(r.id) },
      footnote: 'Sent by the HLO staff portal.',
    })));
  }
  return { changed: true, status: next };
}

module.exports = {
  CATEGORIES, CATEGORY_KEYS, STATUS_LABELS, TABS, MAX_BYTES,
  browserOf, screenshotFile, forwardEmail, setForwardEmail,
  list, tabCounts, getFor, updates, openCount, recentFor, create, reply,
};
