'use strict';

/**
 * Careers → Benefits we offer: add "Referral bonus". The page shows the saved
 * list once someone has edited it in Site content, so add it there too
 * (published and draft), unless it's already in.
 *
 * @param {import('knex').Knex} knex
 */
const KEY = 'careers.benefits.items';
const ITEM = { name: 'Referral bonus', icon: 'cash' };

function withBonus(json) {
  if (!json) return null;
  let doc;
  try {
    doc = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  const items = doc && doc.lists && doc.lists[KEY];
  if (!Array.isArray(items) || items.some((i) => i && (i.icon === 'cash' || /referral bonus/i.test(i.name || '')))) return null;
  doc.lists[KEY] = [...items, ITEM];
  return JSON.stringify(doc);
}

exports.up = async function up(knex) {
  const row = await knex('page_content').where({ page_key: 'careers' }).first();
  if (!row) return;
  const changes = {};
  const published = withBonus(row.published);
  const draft = withBonus(row.draft);
  if (published) changes.published = published;
  if (draft) changes.draft = draft;
  if (Object.keys(changes).length) await knex('page_content').where({ page_key: 'careers' }).update(changes);
};

/** Leave the list as it is: staff may have edited it since. */
exports.down = async function down() {};
