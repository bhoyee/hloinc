'use strict';

/**
 * Database backup, run on the server before every migration (see
 * scripts/deploy/remote.sh). Writes a compressed mysqldump to ./backups and
 * keeps the newest KEEP files.
 *
 *   node scripts/db-backup.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const config = require('../src/config');

const KEEP = 14;
const dir = path.join(config.paths.root, 'backups');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const file = path.join(dir, `db-${stamp}.sql.gz`);
const { host, port, user, password, database } = config.db;

// The password goes in the environment, never on the command line (where other users could see it).
const dump = spawn('mysqldump', ['--single-transaction', '--quick', '--no-tablespaces', '--routines', `--host=${host}`, `--port=${port}`, `--user=${user}`, database], {
  env: { ...process.env, MYSQL_PWD: password },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const out = fs.createWriteStream(file, { mode: 0o600 });
dump.stdout.pipe(zlib.createGzip()).pipe(out);

dump.on('error', (err) => {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
});
dump.on('close', (code) => {
  out.on('finish', () => {
    if (code !== 0) {
      fs.rmSync(file, { force: true });
      console.error(`Backup failed (mysqldump exit ${code}).`);
      process.exit(1);
    }
    const backups = fs.readdirSync(dir).filter((f) => /^db-.*\.sql\.gz$/.test(f)).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) fs.rmSync(path.join(dir, old));
    console.log(`Backup saved: backups/${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  });
});
