'use strict';

/**
 * Job applications are taken on the website (no more ADP). Each one keeps the
 * applicant's details and their resume, which is virus-scanned and stored
 * encrypted outside the public folders (storage/applications).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.string('apply_url', 500).nullable().alter();
  });
  await knex.schema.createTable('job_applications', (t) => {
    t.increments('id').primary();
    t.string('reference', 20).notNullable().unique();
    t.integer('job_id').unsigned().nullable().references('id').inTable('jobs').onDelete('SET NULL');
    t.string('job_title', 160).notNullable(); // kept if the job is later deleted
    t.string('first_name', 80).notNullable();
    t.string('last_name', 80).notNullable();
    t.string('email', 191).notNullable();
    t.string('phone', 30).notNullable();
    t.text('cover_note').nullable();
    t.enu('status', ['new', 'reviewing', 'shortlisted', 'hired', 'not_selected']).notNullable().defaultTo('new');
    // The resume: original name (tidied), type, size, and the encrypted file's name on disk.
    t.string('resume_name', 120).nullable();
    t.string('resume_type', 10).nullable();
    t.integer('resume_size').unsigned().nullable();
    t.string('resume_file', 64).nullable();
    t.string('resume_sha256', 64).nullable();
    t.enu('scan_status', ['pending', 'clean', 'infected']).notNullable().defaultTo('pending');
    t.string('scan_engine', 60).nullable();
    t.string('scan_detail', 191).nullable();
    t.timestamp('scanned_at').nullable();
    t.string('ip', 45).nullable();
    t.string('email_status', 10).nullable();
    t.timestamps(true, true);
    t.index(['job_id', 'created_at']);
    t.index(['status', 'created_at']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('job_applications');
};
