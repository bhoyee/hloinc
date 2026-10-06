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

module.exports = { listPublished, searchPublished, filterOptions, findPublishedBySlug, toJobPosting, parsePay, PER_PAGE };
