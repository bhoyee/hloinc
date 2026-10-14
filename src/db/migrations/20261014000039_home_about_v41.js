'use strict';

/**
 * Home, About, Services, Resources, Contact and Careers follow HLO's design, version 41 (October 14, 2026): new sections, and new
 * keys for the text that changed. A section order or hidden sections saved for the previous
 * design would put the new sections at the end, so start those pages from the design's order.
 * The page's current version is kept in its history first (Site content → History).
 *
 * @param {import('knex').Knex} knex
 */
const PAGES = ['home', 'about', 'services', 'resources', 'contact', 'careers'];

const parse = (json) => {
  if (!json) return null;
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
};

exports.up = async function up(knex) {
  for (const key of PAGES) {
    const row = await knex('page_content').where({ page_key: key }).first();
    if (!row) continue;
    const published = parse(row.published);
    const draft = parse(row.draft);
    const changes = {};
    if (published && published.sections && Object.keys(published.sections).length) {
      await knex('page_revisions').insert({ page_key: key, content: JSON.stringify(published), published_by_name: 'Website update (design version 41)' });
      changes.published = JSON.stringify({ ...published, sections: {} });
    }
    if (draft && draft.sections && Object.keys(draft.sections).length) changes.draft = JSON.stringify({ ...draft, sections: {} });
    if (Object.keys(changes).length) await knex('page_content').where({ page_key: key }).update(changes);
  }
};

/** The previous order is in the page's history if it's wanted back. */
exports.down = async function down() {};
