'use strict';

/*
 * The visual page editor's content store.
 *
 * Every public page is a "document": text, links, images, repeated items
 * (cards, steps, FAQs) and section order/visibility. Templates read it through
 * the `cms` helpers below, giving the built-in text as the default, so a page
 * looks exactly as designed until someone changes it.
 *
 *   {{ cms.text('home.hero.title', 'Support for living well') }}
 *   {% set img = cms.image('home.hero.image', 'hero-support', 'Alt text') %}
 *   {% for step in cms.list('home.steps', [...]) %}{{ step.text('title') }}{% endfor %}
 *
 * The first part of a key ("home") names the document. "site" holds the
 * header, footer and shared sections. Each document has a published version
 * (what visitors see) and a draft (what the editor shows) plus a history.
 *
 * In edit mode the helpers wrap editable values in data-cms attributes for
 * the in-page editor (public/js/cms-frame.js). Everything is HTML-escaped on
 * output, so stored content can never inject markup.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const nunjucks = require('nunjucks');
const db = require('../db/knex');
const { can } = require('../auth/permissions');
const { richText } = require('../lib/text');
const { paths: ICONS } = require('../lib/icons');
const services = require('../content/services');

const { SafeString } = nunjucks.runtime;
const esc = nunjucks.lib.escape;
const als = new AsyncLocalStorage();

// --- The pages ----------------------------------------------------------------------------

const FULL = 'site_content.edit';
const LIMITED = 'site_content.edit_limited';

const PAGES = [
  { key: 'home', label: 'Home', path: '/', group: 'Main pages' },
  { key: 'about', label: 'About', path: '/about', group: 'Main pages' },
  { key: 'services', label: 'Services', path: '/services', group: 'Main pages' },
  ...services.map((s) => ({ key: `service-${s.slug}`, label: s.name, path: `/services/${s.slug}`, group: 'Service pages' })),
  { key: 'service-areas', label: 'Service areas', path: '/service-areas', group: 'Main pages' },
  { key: 'getting-started', label: 'Getting started', path: '/getting-started', group: 'Main pages' },
  { key: 'resources', label: 'Resources', path: '/resources', group: 'Main pages' },
  { key: 'careers', label: 'Careers', path: '/careers', group: 'Main pages', limited: true },
  { key: 'contact', label: 'Contact', path: '/contact', group: 'Main pages' },
  { key: 'referrals', label: 'Send a referral', path: '/referrals', group: 'Forms' },
  { key: 'appointment-request', label: 'Request an appointment', path: '/appointments/request', group: 'Forms' },
  { key: 'privacy', label: 'Privacy Policy', path: '/privacy', group: 'Legal' },
  { key: 'terms', label: 'Terms of Use', path: '/terms', group: 'Legal' },
  { key: 'data-protection', label: 'Data Protection', path: '/data-protection', group: 'Legal' },
  { key: 'cookies', label: 'Cookie Policy', path: '/cookies', group: 'Legal' },
];
const SITE_DOC = 'site'; // header, footer and shared sections
const DOC_KEYS = new Set([...PAGES.map((p) => p.key), SITE_DOC]);

const findPage = (key) => PAGES.find((p) => p.key === key) || null;

/** Can this person change this document? Limited editors: careers page only. */
function canEditDoc(user, docKey) {
  if (!user || !DOC_KEYS.has(docKey)) return false;
  if (can(user, FULL)) return true;
  return can(user, LIMITED) && Boolean(findPage(docKey) && findPage(docKey).limited);
}

/** Pages this person can open in the editor (viewing needs site_content.view). */
function pagesFor(user) {
  return PAGES.map((p) => ({ ...p, editable: canEditDoc(user, p.key) })).filter((p) => p.editable || can(user, 'site_content.view'));
}

// --- Loading documents -----------------------------------------------------------------------

const EMPTY = () => ({ values: {}, lists: {}, sections: {} });
const parse = (v) => {
  if (!v) return null;
  try {
    const doc = typeof v === 'string' ? JSON.parse(v) : v;
    return { ...EMPTY(), ...doc };
  } catch {
    return null;
  }
};

let published = {};
let loadedAt = 0;
const TTL_MS = 30 * 1000;

/** The published documents (cached briefly; cleared on publish). */
async function loadPublished(force = false) {
  if (!force && loadedAt && Date.now() - loadedAt < TTL_MS) return published;
  try {
    const rows = await db('page_content').select('page_key', 'published');
    const next = {};
    for (const r of rows) {
      const doc = parse(r.published);
      if (doc) next[r.page_key] = doc;
    }
    published = next;
    loadedAt = Date.now();
  } catch (err) {
    // The site must still render (with built-in text) if the database is briefly unavailable.
    console.error('Could not load page content:', err.message);
  }
  return published;
}

function clearCache() {
  loadedAt = 0;
}

/** Drafts where they exist, otherwise the published version (what the editor shows). */
async function loadDrafts() {
  const rows = await db('page_content').select('page_key', 'published', 'draft');
  const docs = {};
  for (const r of rows) {
    const doc = parse(r.draft) || parse(r.published);
    if (doc) docs[r.page_key] = doc;
  }
  return docs;
}

// --- Request context -------------------------------------------------------------------------

/**
 * Run the rest of the request with the right content: published for visitors,
 * drafts for staff previewing or editing (`?cms=preview` / `?cms=edit`).
 */
function middleware() {
  return async (req, res, next) => {
    const wanted = req.method === 'GET' && (req.query.cms === 'edit' || req.query.cms === 'preview') ? req.query.cms : null;
    if (!wanted || req.path.startsWith('/portal')) {
      const docs = await loadPublished();
      return als.run({ mode: 'live', docs }, next);
    }

    // Staff only: load who's signed in the same way the portal does (including timeouts).
    await new Promise((resolve) => require('../middleware/auth').loadUser(req, res, resolve));
    const user = req.user;
    if (!user || !(can(user, FULL) || can(user, LIMITED) || can(user, 'site_content.view'))) {
      const params = new URLSearchParams({ next: `/portal/content/pages` });
      return res.redirect(`/portal/login?${params}`);
    }

    // The editor shows the page in a frame on our own site.
    const csp = res.getHeader('Content-Security-Policy');
    if (csp) res.setHeader('Content-Security-Policy', String(csp).replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    res.locals.cmsMode = wanted;
    const docs = await loadDrafts();
    als.run({ mode: wanted, docs, user, registry: wanted === 'edit' ? {} : null }, next);
  };
}

const store = () => als.getStore() || { mode: 'live', docs: published };
const isEditing = () => store().mode === 'edit';
const docOf = (key) => String(key).split('.')[0];

/** May the current editor change this key? (Read-only content isn't marked as editable.) */
function editable(key) {
  const s = store();
  return s.mode === 'edit' && canEditDoc(s.user, docOf(key));
}

function register(key, entry) {
  const s = store();
  if (s.registry) s.registry[key] = { ...entry, editable: editable(key) };
}

function valueOf(key, fallback) {
  const doc = store().docs[docOf(key)];
  return doc && doc.values && Object.hasOwn(doc.values, key) ? doc.values[key] : fallback;
}

const attrs = (pairs) => new SafeString(Object.entries(pairs).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join(''));
const NO_ATTRS = new SafeString('');

// --- Images -------------------------------------------------------------------------------

/** "hero-support" -> the built-in photo; or a stored image object. */
function imageValue(v, alt = '') {
  if (!v) return null;
  if (typeof v === 'string') return { src: `/img/photos/${v}.webp`, srcSm: `/img/photos/${v}-sm.webp`, w: 960, h: 640, alt };
  return { alt: '', ...v };
}

function imageOut(img, editAttrs) {
  if (!img) return null;
  const srcset = img.srcSm ? `${img.srcSm} 560w, ${img.src} ${img.w || 960}w` : '';
  return { src: img.src, srcSm: img.srcSm || img.src, srcset, alt: img.alt || '', w: img.w || 960, h: img.h || 640, attrs: editAttrs };
}

// --- Template helpers ------------------------------------------------------------------------

/** One line or paragraph of plain text, edited in place. */
function text(key, fallback = '') {
  const v = valueOf(key, fallback);
  register(key, { type: 'text', value: v });
  if (!editable(key)) return v;
  return new SafeString(`<span data-cms="${esc(key)}" data-cms-type="text">${esc(v)}</span>`);
}

/** Text used where markup isn't allowed (page title, description). Edited in "Page settings". */
function plain(key, fallback = '', label = '') {
  const v = valueOf(key, fallback);
  register(key, { type: 'plain', value: v, label });
  return v;
}

/** Longer text: blank lines make paragraphs, "- " lines make bullet points. */
function rich(key, fallback = '') {
  const v = valueOf(key, fallback);
  register(key, { type: 'rich', value: v });
  const html = richText(v);
  if (!editable(key)) return new SafeString(html);
  return new SafeString(`<div data-cms="${esc(key)}" data-cms-type="rich">${html}</div>`);
}

/** A link: { label, href, attrs }. The label is edited in place; the address in a small dialog. */
function link(key, label, href) {
  const h = valueOf(`${key}.href`, href);
  register(`${key}.href`, { type: 'href', value: h });
  return { label: text(`${key}.label`, label), href: h, attrs: editable(key) ? attrs({ 'data-cms-href': `${key}.href` }) : NO_ATTRS };
}

/** An image: { src, srcset, alt, w, h, attrs }. Click to replace in the editor. */
function image(key, fallback, alt = '') {
  const img = imageValue(valueOf(key, null)) || imageValue(fallback, alt);
  register(key, { type: 'image', value: img });
  return imageOut(img, editable(key) ? attrs({ 'data-cms': key, 'data-cms-type': 'image' }) : NO_ATTRS);
}

/**
 * Repeated items (cards, steps, FAQs). Each item can be edited, moved,
 * copied or removed in the editor. Item fields are read with
 * item.text('title'), item.rich('body'), item.image('photo'), item.link('cta').
 */
function list(key, fallback = []) {
  const doc = store().docs[docOf(key)];
  const items = doc && doc.lists && Array.isArray(doc.lists[key]) ? doc.lists[key] : fallback;
  register(key, { type: 'list', value: items });
  const canEdit = editable(key);
  return items.map((item, i) => {
    const field = (f, type) => ({ 'data-cms': key, 'data-cms-index': i, 'data-cms-field': f, 'data-cms-type': type });
    return {
      ...item,
      index: i,
      attrs: canEdit ? attrs({ 'data-cms-list': key, 'data-cms-index': i }) : NO_ATTRS,
      // For items with a plain "href" field (menus, link lists): the address is changed in a dialog.
      hrefAttrs: canEdit && typeof item.href === 'string' ? attrs({ 'data-cms-href': '1', 'data-cms-href-list': key, 'data-cms-index': i }) : NO_ATTRS,
      text(f) {
        const v = item[f] == null ? '' : String(item[f]);
        return canEdit ? new SafeString(`<span${attrs(field(f, 'text'))}>${esc(v)}</span>`) : v;
      },
      rich(f) {
        const html = richText(item[f] || '');
        return new SafeString(canEdit ? `<div${attrs(field(f, 'rich'))}>${html}</div>` : html);
      },
      image(f, alt = '') {
        return imageOut(imageValue(item[f], alt), canEdit ? attrs(field(f, 'image')) : NO_ATTRS);
      },
      link(f) {
        const v = item[f] || {};
        return { label: this.textOf(f, 'label', v.label), href: v.href || '#', attrs: canEdit ? attrs({ ...field(f, 'link'), 'data-cms-href': '1' }) : NO_ATTRS };
      },
      textOf(f, part, v = '') {
        return canEdit ? new SafeString(`<span${attrs({ ...field(f, 'text'), 'data-cms-part': part })}>${esc(v)}</span>`) : v;
      },
    };
  });
}

/**
 * The page's sections in their saved order, without hidden ones (the editor
 * shows hidden ones faded, with controls to move, hide and show them).
 * `labels` is { key: 'Label' } in the default order.
 */
function sections(docKey, labels) {
  const keys = Object.keys(labels);
  const doc = store().docs[docKey];
  const saved = (doc && doc.sections) || {};
  const order = [...(saved.order || []).filter((k) => keys.includes(k)), ...keys.filter((k) => !(saved.order || []).includes(k))];
  const hidden = new Set((saved.hidden || []).filter((k) => keys.includes(k)));
  register(`${docKey}.__sections`, { type: 'sections', value: { order, hidden: [...hidden] }, labels });
  const canEdit = editable(docKey);
  return order
    .filter((k) => canEdit || !hidden.has(k))
    .map((k) => ({
      key: k,
      hidden: hidden.has(k),
      attrs: canEdit ? attrs({ 'data-cms-section': k, 'data-cms-doc': docKey, 'data-cms-label': labels[k], ...(hidden.has(k) ? { 'data-cms-hidden': '1' } : {}) }) : NO_ATTRS,
    }));
}

/** Everything the edit-mode render used, for the editor (page settings, lists, sections). */
function registry() {
  const s = store();
  return s.registry || null;
}

/** ['a', 'b'] -> [{ label: 'a' }, { label: 'b' }], for list() defaults. */
const objects = (arr, field = 'label') => (arr || []).map((v) => ({ [field]: v }));

const helpers = { text, plain, rich, link, image, list, sections, registry, isEditing, objects };

// --- Validating changes ----------------------------------------------------------------------

const KEY = /^[a-z0-9-]+(\.[A-Za-z0-9_-]+){1,6}$/;
const IMAGE_SRC = /^\/(img\/photos|uploads)\/[a-z0-9-]+\.webp$/;
const LIMITS = { text: 2000, plain: 400, rich: 30000, href: 500 };

function validHref(v) {
  if (typeof v !== 'string' || v.length > LIMITS.href) return false;
  if (v === '' || /^#[A-Za-z0-9_-]*$/.test(v)) return true;
  if (/^\/(?!\/)[^\s<>"]*$/.test(v)) return true;
  if (/^(mailto:[^\s<>"]+|tel:\+?[\d\s().-]{7,})$/i.test(v)) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function validImage(v) {
  return (
    v &&
    typeof v === 'object' &&
    IMAGE_SRC.test(v.src) &&
    (v.srcSm === undefined || IMAGE_SRC.test(v.srcSm)) &&
    (v.alt === undefined || (typeof v.alt === 'string' && v.alt.length <= 300)) &&
    ['w', 'h'].every((d) => v[d] === undefined || (Number.isInteger(v[d]) && v[d] > 0 && v[d] < 10000))
  );
}

const cleanImage = (v) => ({ src: v.src, srcSm: v.srcSm || v.src, alt: (v.alt || '').trim(), w: v.w || 960, h: v.h || 640 });

/** Check a list item: plain strings, images, links; icons must exist. */
function cleanItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k) || ['index', 'attrs'].includes(k)) continue;
    if (typeof v === 'string') {
      if (v.length > LIMITS.rich) return null;
      if (k === 'icon' && !Object.hasOwn(ICONS, v)) return null;
      if (k === 'href' && !validHref(v)) return null;
      out[k] = v;
    } else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
      out[k] = v;
    } else if (v && typeof v === 'object' && 'src' in v) {
      if (!validImage(v)) return null;
      out[k] = cleanImage(v);
    } else if (v && typeof v === 'object' && ('href' in v || 'label' in v)) {
      if (!validHref(v.href || '') || String(v.label || '').length > LIMITS.text) return null;
      out[k] = { label: String(v.label || ''), href: String(v.href || '') };
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length <= LIMITS.text) && v.length <= 60) {
      out[k] = v;
    } else if (v === null) {
      out[k] = null;
    } else {
      return null;
    }
  }
  return out;
}

/**
 * Validate a batch of edits from the editor and return them grouped by
 * document, or { error }.
 *   { values: [{ key, type, value }], lists: [{ key, items }], sections: [{ doc, order, hidden }] }
 */
function validate(changes, user) {
  const byDoc = {};
  const docFor = (key) => {
    const d = docOf(key);
    if (!DOC_KEYS.has(d)) throw new Error(`Unknown page: ${d}`);
    if (!canEditDoc(user, d)) throw new Error('Your role can’t change this part of the site.');
    return (byDoc[d] ||= { values: {}, lists: {}, sections: null });
  };
  try {
    for (const c of [].concat(changes.values || [])) {
      if (!KEY.test(c.key || '')) throw new Error('Invalid field.');
      let v = c.value;
      if (c.type === 'image') {
        if (!validImage(v)) throw new Error('That image can’t be used.');
        v = cleanImage(v);
      } else if (c.type === 'href') {
        if (!validHref(v)) throw new Error('Links must be a page on this site (like /contact), https://, mailto: or tel:.');
      } else if (Object.hasOwn(LIMITS, c.type)) {
        if (typeof v !== 'string') throw new Error('Invalid text.');
        v = v.replace(/\r\n/g, '\n').replace(/ /g, ' ');
        v = c.type === 'rich' ? v.trim() : v.replace(/\s*\n\s*/g, ' ').trim();
        if (v.length > LIMITS[c.type]) throw new Error(`That text is too long (${v.length} characters; the limit is ${LIMITS[c.type]}).`);
      } else {
        throw new Error('Invalid field type.');
      }
      docFor(c.key).values[c.key] = v;
    }
    for (const l of [].concat(changes.lists || [])) {
      if (!KEY.test(l.key || '') || !Array.isArray(l.items)) throw new Error('Invalid list.');
      if (l.items.length < 1 || l.items.length > 60) throw new Error('A list needs between 1 and 60 items.');
      const items = l.items.map(cleanItem);
      if (items.some((x) => !x)) throw new Error('One of the items has invalid content.');
      docFor(l.key).lists[l.key] = items;
    }
    for (const s of [].concat(changes.sections || [])) {
      const valid = (a) => Array.isArray(a) && a.length <= 40 && a.every((k) => typeof k === 'string' && /^[a-z0-9-]{1,40}$/.test(k));
      if (!valid(s.order) || !valid(s.hidden)) throw new Error('Invalid sections.');
      docFor(`${s.doc}.x`).sections = { order: s.order, hidden: s.hidden };
    }
  } catch (err) {
    return { error: err.message };
  }
  return { byDoc };
}

// --- Saving, publishing, history -------------------------------------------------------------

async function rows(keys) {
  const list = await db('page_content').whereIn('page_key', keys);
  return Object.fromEntries(list.map((r) => [r.page_key, r]));
}

/** Apply validated edits to the drafts (creating them from the published version if needed). */
async function saveDraft(byDoc, user) {
  const existing = await rows(Object.keys(byDoc));
  for (const [key, change] of Object.entries(byDoc)) {
    const row = existing[key];
    const base = (row && (parse(row.draft) || parse(row.published))) || EMPTY();
    const draft = {
      values: { ...base.values, ...change.values },
      lists: { ...base.lists, ...change.lists },
      sections: change.sections ? { ...base.sections, ...change.sections } : base.sections,
    };
    const data = { draft: JSON.stringify(draft), draft_updated_at: new Date(), draft_updated_by: user.id };
    if (row) await db('page_content').where({ page_key: key }).update(data);
    else await db('page_content').insert({ page_key: key, ...data });
  }
}

/** Which of these documents have unpublished changes. */
async function pending(keys) {
  const r = await rows(keys);
  return keys.filter((k) => r[k] && r[k].draft);
}

/** Publish the drafts of these documents (that the user may edit); keep each version in the history. */
async function publish(keys, user) {
  const allowed = keys.filter((k) => canEditDoc(user, k));
  const r = await rows(allowed);
  const done = [];
  for (const key of allowed) {
    const row = r[key];
    if (!row || !row.draft) continue;
    await db('page_content').where({ page_key: key }).update({ published: row.draft, draft: null, published_at: new Date(), published_by: user.id });
    await db('page_revisions').insert({ page_key: key, content: row.draft, published_by: user.id, published_by_name: user.name });
    done.push(key);
  }
  clearCache();
  return done;
}

/** Throw away unpublished changes. */
async function discard(keys, user) {
  const allowed = keys.filter((k) => canEditDoc(user, k));
  if (allowed.length) await db('page_content').whereIn('page_key', allowed).update({ draft: null, draft_updated_at: null, draft_updated_by: null });
  return allowed;
}

function history(key, limit = 30) {
  return db('page_revisions').select('id', 'page_key', 'published_by_name', 'created_at').where({ page_key: key }).orderBy('id', 'desc').limit(limit);
}

/** Copy an earlier published version into the draft, to review and publish again. */
async function restore(key, revisionId, user) {
  const rev = await db('page_revisions').where({ id: revisionId, page_key: key }).first();
  if (!rev || !canEditDoc(user, key)) return false;
  const exists = await db('page_content').where({ page_key: key }).first();
  const data = { draft: typeof rev.content === 'string' ? rev.content : JSON.stringify(rev.content), draft_updated_at: new Date(), draft_updated_by: user.id };
  if (exists) await db('page_content').where({ page_key: key }).update(data);
  else await db('page_content').insert({ page_key: key, ...data });
  return true;
}

/** Put a page back to the built-in design and text (as a draft, to publish). */
async function resetToDefault(key, user) {
  if (!canEditDoc(user, key)) return false;
  const exists = await db('page_content').where({ page_key: key }).first();
  const data = { draft: JSON.stringify(EMPTY()), draft_updated_at: new Date(), draft_updated_by: user.id };
  if (exists) await db('page_content').where({ page_key: key }).update(data);
  else await db('page_content').insert({ page_key: key, ...data });
  return true;
}

/** When each page was last published, and whether it has a draft. */
async function status() {
  const list = await db('page_content as p')
    .leftJoin('users as u', 'u.id', 'p.published_by')
    .select('p.page_key', 'p.published_at', 'p.draft_updated_at', db.raw('p.draft IS NOT NULL as has_draft'), 'u.name as published_by_name');
  return Object.fromEntries(list.map((r) => [r.page_key, { ...r, has_draft: Boolean(Number(r.has_draft)) }]));
}

/** Is this uploaded file used on any page (published, draft or history)? */
async function mediaInUse(file) {
  const like = `%/uploads/${file}%`;
  const inPages = await db('page_content').where('published', 'like', like).orWhere('draft', 'like', like).first();
  return Boolean(inPages);
}

module.exports = {
  PAGES,
  SITE_DOC,
  findPage,
  canEditDoc,
  pagesFor,
  middleware,
  helpers,
  loadPublished,
  clearCache,
  validate,
  saveDraft,
  pending,
  publish,
  discard,
  history,
  restore,
  resetToDefault,
  status,
  mediaInUse,
  validHref,
};
