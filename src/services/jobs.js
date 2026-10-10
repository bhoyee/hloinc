'use strict';

const db = require('../db/knex');
const config = require('../config');
const { richText } = require('../lib/text');

const PUBLIC_FIELDS = [
  'id',
  'title',
  'slug',
  'department',
  'location',
  'employment_type',
  'pay_range',
  'description',
  'requirements',
  'benefits',
  'apply_url',
  'published_at',
];

function listPublished() {
  return db('jobs').select(PUBLIC_FIELDS).where({ status: 'published' }).orderBy('published_at', 'desc');
}

const PER_PAGE = 10;
const FILTERS = { type: 'employment_type', location: 'location', department: 'department' };

/** Distinct values of each filter among published jobs, for the dropdowns. */
async function filterOptions() {
  const options = {};
  for (const [key, column] of Object.entries(FILTERS)) {
    const rows = await db('jobs').distinct(column).where({ status: 'published' }).whereNotNull(column).orderBy(column);
    options[key] = rows.map((r) => r[column]).filter(Boolean);
  }
  return options;
}

/** Escape LIKE wildcards so a search for "50%" means the text "50%". */
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Published jobs matching a keyword and filters, one page at a time.
 * Unknown filter values are ignored rather than returning nothing.
 */
async function searchPublished({ q = '', type = '', location = '', department = '', page = 1 } = {}, options) {
  const filters = { type, location, department };
  const query = db('jobs').where({ status: 'published' });

  const keyword = String(q).trim().slice(0, 100);
  if (keyword) {
    const like = `%${likeEscape(keyword)}%`;
    query.where((w) =>
      w.where('title', 'like', like).orWhere('department', 'like', like).orWhere('location', 'like', like).orWhere('description', 'like', like)
    );
  }
  for (const [key, column] of Object.entries(FILTERS)) {
    if (filters[key] && options[key].includes(filters[key])) query.where(column, filters[key]);
  }

  const { total } = await query.clone().count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);

  const ranked = query.clone().select(PUBLIC_FIELDS);
  if (keyword) {
    // Title matches first, then department/location, then description-only matches.
    const like = `%${likeEscape(keyword)}%`;
    ranked.orderByRaw('CASE WHEN title LIKE ? THEN 0 WHEN department LIKE ? OR location LIKE ? THEN 1 ELSE 2 END', [like, like, like]);
  }
  const jobs = await ranked
    .orderBy('published_at', 'desc')
    .orderBy('id', 'desc')
    .limit(PER_PAGE)
    .offset((current - 1) * PER_PAGE);

  return { jobs, total: Number(total), page: current, pages, perPage: PER_PAGE };
}

function findPublishedBySlug(slug) {
  return db('jobs').select(PUBLIC_FIELDS).where({ status: 'published', slug }).first();
}

const EMPLOYMENT_TYPES = { 'full-time': 'FULL_TIME', 'part-time': 'PART_TIME', contract: 'CONTRACTOR', temporary: 'TEMPORARY' };

/** "$17.00 – $19.00 per hour" -> schema.org MonetaryAmount, or undefined. */
function parsePay(payRange) {
  const m = String(payRange || '').match(/\$([\d,.]+)\s*[–—-]\s*\$([\d,.]+)\s*(?:per|\/|an?)\s*(hour|year|week|month)/i);
  if (!m) return undefined;
  const num = (v) => Number(v.replace(/,/g, ''));
  return {
    '@type': 'MonetaryAmount',
    currency: 'USD',
    value: { '@type': 'QuantitativeValue', minValue: num(m[1]), maxValue: num(m[2]), unitText: m[3].toUpperCase() },
  };
}

/** schema.org JobPosting, so the role can appear in Google's job search. */
function toJobPosting(job, site) {
  const sections = [job.description, job.requirements && `Requirements:\n${job.requirements}`, job.benefits && `Benefits:\n${job.benefits}`];
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: richText(sections.filter(Boolean).join('\n\n')),
    datePosted: job.published_at ? new Date(job.published_at).toISOString().slice(0, 10) : undefined,
    employmentType: EMPLOYMENT_TYPES[String(job.employment_type || '').toLowerCase()],
    hiringOrganization: {
      '@type': 'Organization',
      name: site.legalName,
      sameAs: config.appUrl,
      logo: `${config.appUrl}/img/logo.jpg`,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: site.address.street,
        addressLocality: site.address.city,
        addressRegion: site.address.state,
        postalCode: site.address.zip || undefined,
        addressCountry: 'US',
      },
    },
    baseSalary: parsePay(job.pay_range),
    directApply: false,
  };
}

// --- Portal: the jobs manager (requirements §5.3) ------------------------------------

const STATUS_LABELS = { draft: 'Draft', published: 'Published', archived: 'Archived' };
const EMPLOYMENT_TYPE_OPTIONS = ['Full-time', 'Part-time', 'Contract', 'Temporary'];
const TABS = {
  published: { label: 'Published', where: (q) => q.where('j.status', 'published') },
  draft: { label: 'Drafts', where: (q) => q.where('j.status', 'draft') },
  archived: { label: 'Archived', where: (q) => q.where('j.status', 'archived') },
  all: { label: 'All', where: (q) => q },
};
const PORTAL_PER_PAGE = 20;

/** "Direct Support Professional (DSP)" -> "direct-support-professional-dsp". */
function slugify(text) {
  return (
    String(text)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160) || 'job'
  );
}

/** A slug no other job uses: "title", then "title-2", "title-3"… */
async function uniqueSlug(title, excludeId = null) {
  const base = slugify(title);
  const taken = new Set(
    await db('jobs')
      .where((w) => w.where('slug', base).orWhere('slug', 'like', `${base}-%`))
      .modify((q) => excludeId && q.whereNot({ id: excludeId }))
      .pluck('slug')
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function tabCounts() {
  const rows = await db('jobs').select('status').count({ n: '*' }).groupBy('status');
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { published: by.published || 0, draft: by.draft || 0, archived: by.archived || 0, all: Object.values(by).reduce((a, b) => a + b, 0) };
}

async function portalList({ tab = 'published', q = '', page = 1, perPage = PORTAL_PER_PAGE } = {}) {
  const query = TABS[tab].where(db('jobs as j'));
  const keyword = String(q).trim().slice(0, 100);
  if (keyword) {
    const like = `%${likeEscape(keyword)}%`;
    query.where((w) => w.where('j.title', 'like', like).orWhere('j.department', 'like', like).orWhere('j.location', 'like', like));
  }
  const { total } = await query.clone().count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / perPage));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = await query
    .leftJoin('users as u', 'u.id', 'j.updated_by')
    .select('j.id', 'j.title', 'j.slug', 'j.department', 'j.location', 'j.employment_type', 'j.pay_range', 'j.status', 'j.published_at', 'j.updated_at', 'u.name as updated_by_name')
    .orderByRaw("FIELD(j.status, 'published', 'draft', 'archived')")
    .orderBy('j.updated_at', 'desc')
    .orderBy('j.id', 'desc')
    .limit(perPage)
    .offset((current - 1) * perPage);
  return { items, total: Number(total), page: current, pages };
}

function get(id) {
  return db('jobs as j')
    .leftJoin('users as c', 'c.id', 'j.created_by')
    .leftJoin('users as u', 'u.id', 'j.updated_by')
    .select('j.*', 'c.name as created_by_name', 'u.name as updated_by_name')
    .where('j.id', id)
    .first();
}

/** What's still needed before a job can go live (Maryland pay transparency law). */
function publishProblems(job) {
  const errors = {};
  if (!job.pay_range) errors.pay_range = 'Add the pay range before publishing. Maryland law requires it on public job postings.';
  if (!job.benefits) errors.benefits = 'Add a short description of benefits before publishing. Maryland law requires it.';
  return errors;
}

const blankToNull = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === '' ? null : v]));

async function create(data, user, { publish = false } = {}) {
  const [id] = await db('jobs').insert({
    ...blankToNull(data),
    slug: await uniqueSlug(data.title),
    status: publish ? 'published' : 'draft',
    published_at: publish ? new Date() : null,
    created_by: user.id,
    updated_by: user.id,
  });
  return get(id);
}

/** Save edits. The web address (slug) stays fixed once a job has been published, so shared links keep working. */
async function update(job, data, user) {
  const changes = { ...blankToNull(data), updated_by: user.id, updated_at: new Date() };
  if (!job.published_at && data.title !== job.title) changes.slug = await uniqueSlug(data.title, job.id);
  await db('jobs').where({ id: job.id }).update(changes);
  return get(job.id);
}

const MOVES = {
  publish: { from: ['draft', 'archived'], to: 'published' },
  unpublish: { from: ['published'], to: 'draft' },
  archive: { from: ['draft', 'published'], to: 'archived' },
  restore: { from: ['archived'], to: 'draft' },
};

/** Change status; returns the updated job, or null if the move isn't allowed from its current status. */
async function move(job, action, user) {
  const m = MOVES[action];
  if (!m || !m.from.includes(job.status)) return null;
  const changes = { status: m.to, updated_by: user.id, updated_at: new Date() };
  // Re-publishing counts as a fresh posting date on the careers page.
  if (m.to === 'published') changes.published_at = new Date();
  await db('jobs').where({ id: job.id }).update(changes);
  return get(job.id);
}

async function copy(job, user) {
  const fields = ['department', 'location', 'employment_type', 'pay_range', 'description', 'requirements', 'benefits', 'apply_url'];
  const title = `${job.title} (copy)`.slice(0, 160);
  return create({ title, ...Object.fromEntries(fields.map((f) => [f, job[f] ?? ''])) }, user);
}

function remove(id) {
  return db('jobs').where({ id }).del();
}

module.exports = {
  listPublished,
  searchPublished,
  filterOptions,
  findPublishedBySlug,
  toJobPosting,
  parsePay,
  PER_PAGE,
  STATUS_LABELS,
  EMPLOYMENT_TYPE_OPTIONS,
  TABS,
  MOVES,
  slugify,
  uniqueSlug,
  tabCounts,
  portalList,
  get,
  publishProblems,
  create,
  update,
  move,
  copy,
  remove,
};
