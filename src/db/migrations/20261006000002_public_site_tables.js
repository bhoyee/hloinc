'use strict';

/**
 * Tables the public site reads/writes in Phase 1. Their portal management
 * screens arrive in Phases 3–4.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('jobs', (t) => {
    t.increments('id').primary();
    t.string('title', 160).notNullable();
    t.string('slug', 180).notNullable().unique();
    t.string('department', 120).nullable();
    t.string('location', 160).nullable();
    t.string('employment_type', 60).nullable();
    t.text('description').notNullable();
    t.text('requirements').nullable();
    t.string('apply_url', 500).notNullable();
    t.enum('status', ['draft', 'published', 'archived']).notNullable().defaultTo('draft').index();
    t.dateTime('published_at').nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('announcements', (t) => {
    t.increments('id').primary();
    t.string('title', 160).notNullable();
    t.text('body').notNullable();
    t.enum('audience', ['public', 'internal', 'both']).notNullable().defaultTo('public');
    t.dateTime('starts_at').notNullable();
    t.dateTime('ends_at').nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['audience', 'starts_at', 'ends_at']);
  });

  await knex.schema.createTable('contact_messages', (t) => {
    t.increments('id').primary();
    t.string('recipient', 40).notNullable().index();
    t.string('name', 120).notNullable();
    t.string('email', 191).notNullable();
    t.string('phone', 40).nullable();
    t.text('message').notNullable();
    t.enum('status', ['new', 'in_progress', 'resolved']).notNullable().defaultTo('new').index();
    t.enum('email_status', ['pending', 'sent', 'failed']).notNullable().defaultTo('pending');
    t.string('ip', 64).nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('appointment_types', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('description', 500).nullable();
    t.integer('duration_minutes').unsigned().notNullable().defaultTo(30);
    t.integer('capacity').unsigned().notNullable().defaultTo(1);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('appointments', (t) => {
    t.increments('id').primary();
    t.integer('type_id').unsigned().notNullable().references('id').inTable('appointment_types');
    t.enum('source', ['website', 'walk_in', 'phone']).notNullable().index();
    t.enum('status', ['requested', 'confirmed', 'completed', 'cancelled', 'no_show'])
      .notNullable()
      .defaultTo('requested')
      .index();
    t.string('name', 120).notNullable();
    t.string('email', 191).nullable();
    t.string('phone', 40).nullable();
    t.enum('preferred_contact', ['email', 'phone']).notNullable().defaultTo('email');
    t.date('requested_date').nullable();
    t.enum('requested_window', ['morning', 'afternoon']).nullable();
    // Set by staff when confirming (Phase 3).
    t.dateTime('scheduled_at').nullable().index();
    // Visitors are told not to include diagnoses or medication details.
    t.text('notes').nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.integer('handled_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('ip', 64).nullable();
    t.timestamps(true, true);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('appointments');
  await knex.schema.dropTableIfExists('appointment_types');
  await knex.schema.dropTableIfExists('contact_messages');
  await knex.schema.dropTableIfExists('announcements');
  await knex.schema.dropTableIfExists('jobs');
};
