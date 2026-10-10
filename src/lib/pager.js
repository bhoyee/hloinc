'use strict';

const db = require('../db/knex');

/** Rows-per-page choices for portal lists, and the default. */
const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PER_PAGE = 25;

/** Page links for a numbered pager: first, last, and two either side of the current page, with gaps. */
function pageLinks(page, pages, urlFor) {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
  const out = [];
  let last = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last > 1) out.push({ gap: true });
    out.push({ n, url: urlFor(n), current: n === page });
    last = n;
  }
  return out;
}

/**
 * Rows per page for this request: ?per=… if it's one of the choices (and then
 * saved on the person's account), otherwise their saved choice, otherwise 25.
 */
async function perPageFor(req) {
  const asked = Number(req.query.per);
  if (PER_PAGE_OPTIONS.includes(asked)) {
    if (req.user && req.user.page_size !== asked) {
      await db('users').where({ id: req.user.id }).update({ page_size: asked });
      req.user.page_size = asked;
    }
    return asked;
  }
  const saved = req.user && Number(req.user.page_size);
  return PER_PAGE_OPTIONS.includes(saved) ? saved : DEFAULT_PER_PAGE;
}

/**
 * Everything the shared pager needs. `query` is the list's current filters
 * (without page or per), so links keep them.
 */
function pagerFor(path, query, { page, pages, total }, perPage) {
  const clean = Object.fromEntries(Object.entries(query).filter(([k, v]) => v !== '' && v != null && k !== 'page' && k !== 'per'));
  const urlFor = (p) => `${path}?${new URLSearchParams({ ...clean, ...(p > 1 ? { page: p } : {}) })}`;
  return {
    page, pages, total, perPage,
    perPageOptions: PER_PAGE_OPTIONS,
    links: pageLinks(page, pages, urlFor),
    prevUrl: page > 1 ? urlFor(page - 1) : null,
    nextUrl: page < pages ? urlFor(page + 1) : null,
    path,
    query: clean,
  };
}

module.exports = { pageLinks, perPageFor, pagerFor, PER_PAGE_OPTIONS, DEFAULT_PER_PAGE };
