#!/usr/bin/env node
'use strict';

/**
 * Copy the website content from the preview site into this (live) site. Run on the server,
 * from the live app's folder:
 *
 *   node scripts/deploy/copy-content.js /home/<user>/hloinc-preview
 *
 * Copies: Site content (published page text, lists, sections), business details and other
 * site settings, the photo library (records and files), and job postings.
 * Never copies: staff accounts, messages, referrals, applications, appointments, the audit
 * log, the demo positions, security settings (two-step, Turnstile) or health records.
 * Safe to run again: copied rows are updated in place. Drafts aren't copied.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const knex = require('knex');
const config = require('../../src/config');
const live = require('../../src/db/knex');
const { SLUGS: DEMO_POSITIONS } = require('../../src/db/seeds/12_demo_positions');

// Settings that belong to one site only.
const SKIP_SETTINGS = [/^security\./, /^health\./];

async function main() {
  const from = process.argv[2];
  if (!from || !fs.existsSync(path.join(from, '.env'))) {
    console.error('Usage: node scripts/deploy/copy-content.js /path/to/preview-app (the folder with its .env)');
    process.exit(1);
  }
  if (path.resolve(from) === path.resolve(__dirname, '../..')) throw new Error('That is this site. Give the preview site’s folder.');
  const env = dotenv.parse(fs.readFileSync(path.join(from, '.env')));
  if (env.DB_NAME === config.db.database) throw new Error('Both sites use the same database; nothing to copy.');
  const preview = knex({
    client: 'mysql2',
    connection: {
      host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
      charset: 'utf8mb4', timezone: 'Z',
      typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
    },
    pool: { min: 0, max: 2 },
  });
  const text = (v) => (v == null ? v : typeof v === 'string' ? v : JSON.stringify(v));
  const counts = {};

  try {
    // Site content: the published version of each page (and the shared header/footer).
    const pages = await preview('page_content').whereNotNull('published').select('page_key', 'published', 'published_at');
    for (const p of pages) {
      await live('page_content')
        .insert({ page_key: p.page_key, published: text(p.published), published_at: p.published_at || new Date(), published_by: null, draft: null })
        .onConflict('page_key').merge(['published', 'published_at', 'published_by']);
    }
    counts.pages = pages.length;

    // Business details, team email addresses, alerts and other settings.
    const settings = (await preview('site_settings').select('key', 'value')).filter((s) => !SKIP_SETTINGS.some((re) => re.test(s.key)));
    for (const s of settings) {
      await live('site_settings').insert({ key: s.key, value: text(s.value), updated_at: new Date(), updated_by: null }).onConflict('key').merge(['value', 'updated_at', 'updated_by']);
    }
    counts.settings = settings.length;

    // The photo library: records, and the files themselves.
    const media = await preview('media').select('file', 'original_name', 'width', 'height', 'bytes', 'alt', 'created_at');
    for (const m of media) await live('media').insert({ ...m, uploaded_by: null }).onConflict('file').merge(['original_name', 'width', 'height', 'bytes', 'alt']);
    counts.photos = media.length;
    const fromUploads = path.join(from, 'storage', 'uploads');
    const toUploads = path.join(config.paths.storage, 'uploads');
    fs.mkdirSync(toUploads, { recursive: true });
    let files = 0;
    if (fs.existsSync(fromUploads)) {
      for (const name of fs.readdirSync(fromUploads)) {
        const src = path.join(fromUploads, name);
        if (fs.statSync(src).isFile() && !name.startsWith('.')) {
          fs.copyFileSync(src, path.join(toUploads, name));
          files += 1;
        }
      }
    }
    counts.photoFiles = files;

    // Job postings, but not the demo positions.
    const jobs = await preview('jobs').whereNotIn('slug', DEMO_POSITIONS).select();
    for (const j of jobs) {
      const { id, created_by, updated_by, ...row } = j; // eslint-disable-line no-unused-vars
      await live('jobs').insert({ ...row, created_by: null, updated_by: null }).onConflict('slug').merge();
    }
    counts.jobs = jobs.length;
  } finally {
    await preview.destroy();
    await live.destroy();
  }

  console.log('Copied from the preview site:');
  for (const [what, n] of Object.entries(counts)) console.log(`  ${what}: ${n}`);
  console.log('Not copied: staff, messages, referrals, applications, appointments, demo positions, security settings.');
}

main().catch((err) => {
  console.error('Copy failed:', err.message);
  process.exit(1);
});
