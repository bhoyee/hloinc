'use strict';

/**
 * Visual page editor (requirements §5.8, extended): every public page's text,
 * links, images and section order are stored as a content document with a
 * draft (staff only) and a published version, plus a history of published
 * versions and a media library for uploaded images.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('page_content', (t) => {
    t.string('page_key', 80).primary();
    t.json('published').nullable();
    t.json('draft').nullable();
    t.dateTime('published_at').nullable();
    t.integer('published_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.dateTime('draft_updated_at').nullable();
    t.integer('draft_updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  await knex.schema.createTable('page_revisions', (t) => {
    t.increments('id').primary();
    t.string('page_key', 80).notNullable();
    t.json('content').notNullable();
    t.integer('published_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('published_by_name', 120).nullable();
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['page_key', 'id']);
  });

  await knex.schema.createTable('media', (t) => {
    t.increments('id').primary();
    t.string('file', 80).notNullable().unique(); // e.g. "a1b2c3d4e5f6.webp" in storage/uploads
    t.string('original_name', 200).nullable();
    t.integer('width').unsigned().notNullable();
    t.integer('height').unsigned().notNullable();
    t.integer('bytes').unsigned().notNullable();
    t.string('alt', 300).nullable();
    t.integer('uploaded_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // The old text-only page forms are replaced by the visual editor.
  await knex('site_settings').where('key', 'like', 'page.%').del();
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('media');
  await knex.schema.dropTableIfExists('page_revisions');
  await knex.schema.dropTableIfExists('page_content');
};
