'use strict';

/**
 * System health: is everything that runs behind the scenes working?
 *
 *   Version     what's installed and when (tmp/deployed-commit, written by the
 *               deploy script), and whether a newer version was refused.
 *   Backups     the newest database backup in ./backups. Taken before every
 *               deploy, and daily by the background check below.
 *   Email       every send is logged (recipient masked); failures show here.
 *   Scanner     which virus scanner is in use, its last result, resumes still
 *               waiting, and Cloudmersive scans this month against the plan.
 *   Storage     space used by resumes, photos, screenshots, uploads, backups.
 *   Database    size.
 *
 * check() runs every 15 minutes: it takes the daily backup if one is due and
 * tells the people chosen for "System problem" (IT and Admin by default) about
 * each new problem, at most once a day per problem.
 */
const fs = require('fs/promises');
const path = require('path');
const { execFile, spawn } = require('child_process');
const db = require('../db/knex');
const config = require('../config');
const { marylandParts } = require('../lib/hours');

const ROOT = config.paths.root;
const BACKUPS = path.join(ROOT, 'backups');
const FOLDERS = [
  ['applications', 'Resumes (encrypted)'],
  ['avatars', 'Profile photos'],
  ['support', 'Help request screenshots'],
  ['uploads', 'Website photos and files'],
];
const ALERT_SETTING = 'health.alerted';
const BACKUP_DUE_HOURS = 24;
const HOUR = 3600 * 1000;

const month = (now = new Date()) => marylandParts(now).date.slice(0, 7);
const quiet = (fn) => fn().catch((err) => console.error('Health record failed:', err.message));

// --- Recording ---------------------------------------------------------------------------------

/** "j***@gmail.com": enough to recognise, not a full address. */
function mask(to) {
  return String(to || '').split(',').map((a) => a.trim()).filter(Boolean).map((a) => {
    const email = (a.match(/<([^>]+)>/) || [])[1] || a;
    const [user, domain] = email.split('@');
    return domain ? `${user.slice(0, 1)}***@${domain}` : '***';
  }).join(', ').slice(0, 191) || '(none)';
}

/** Log one email attempt. Never throws. */
function recordEmail(message, err) {
  return quiet(() => db('email_log').insert({
    recipient: mask(message.to),
    subject: String(message.subject || '(no subject)').slice(0, 200),
    ok: !err,
    error: err ? String(err.message || err).slice(0, 255) : null,
  }));
}

/** Add one to a monthly counter (and remember the latest detail). Never throws. */
function count(key, detail = null) {
  return quiet(() => db('usage_counters')
    .insert({ key, period: month(), count: 1, last_at: db.fn.now(), last_detail: detail ? String(detail).slice(0, 255) : null })
    .onConflict(['key', 'period'])
    .merge({ count: db.raw('?? + 1', ['usage_counters.count']), last_at: db.fn.now(), last_detail: detail ? String(detail).slice(0, 255) : null }));
}

const counter = (key, period = month()) => db('usage_counters').where({ key, period }).first();

// --- Reading -----------------------------------------------------------------------------------

function git(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, timeout: 4000, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

async function fileInfo(file) {
  try {
    const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return { text: text.trim(), at: stat.mtime };
  } catch {
    return null;
  }
}

async function folderSize(dir) {
  let bytes = 0;
  let files = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0, missing: true };
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await folderSize(full);
      bytes += sub.bytes;
      files += sub.files;
    } else if (e.isFile() && e.name !== '.gitkeep') {
      bytes += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
      files += 1;
    }
  }
  return { bytes, files };
}

async function version() {
  const [log, deployed, skipped] = await Promise.all([
    git(['log', '-1', '--format=%h%x09%cI%x09%s']),
    fileInfo(path.join(ROOT, 'tmp', 'deployed-commit')),
    fileInfo(path.join(ROOT, 'tmp', 'skipped-commit')),
  ]);
  const [commit, committedAt, subject] = log ? log.split('\t') : [];
  const head = log ? await git(['rev-parse', 'HEAD']) : null;
  return {
    commit: commit || null,
    subject: subject || null,
    committedAt: committedAt ? new Date(committedAt) : null,
    deployedAt: deployed ? deployed.at : null,
    // A newer version that failed its tests or its install, and wasn't put live.
    refused: skipped && skipped.text && skipped.text !== head && skipped.text !== (deployed && deployed.text) ? { commit: skipped.text.slice(0, 7), at: skipped.at } : null,
    node: process.version,
    env: config.env,
    startedAt: new Date(Date.now() - process.uptime() * 1000),
  };
}

async function backups() {
  let names = [];
  try {
    names = (await fs.readdir(BACKUPS)).filter((f) => /^db-.*\.sql\.gz$/.test(f)).sort();
  } catch {
    return { count: 0, latest: null, missingDir: true, failed: await backupFailure(null) };
  }
  const latest = names.length ? names[names.length - 1] : null;
  const stat = latest ? await fs.stat(path.join(BACKUPS, latest)) : null;
  const found = latest ? { name: latest, at: stat.mtime, bytes: stat.size } : null;
  return { count: names.length, latest: found, failed: await backupFailure(found) };
}

/** The last backup attempt that failed, if it came after the newest backup. */
async function backupFailure(latest) {
  const e = await db('usage_counters').where({ key: 'backup_error' }).orderBy('last_at', 'desc').first();
  if (!e || (latest && new Date(latest.at) >= new Date(e.last_at))) return null;
  return { at: e.last_at, detail: e.last_detail };
}

async function email() {
  const since = (h) => db.raw(`NOW() - INTERVAL ${Number(h)} HOUR`);
  const [day, week, lastOk, lastAttempt, failures] = await Promise.all([
    db('email_log').where('created_at', '>', since(24)).select(db.raw('SUM(ok) as sent'), db.raw('SUM(1 - ok) as failed')).first(),
    db('email_log').where('created_at', '>', since(24 * 7)).select(db.raw('SUM(ok) as sent'), db.raw('SUM(1 - ok) as failed')).first(),
    db('email_log').where({ ok: true }).orderBy('id', 'desc').first('created_at'),
    db('email_log').orderBy('id', 'desc').first('ok', 'created_at', 'error'),
    db('email_log').where({ ok: false }).orderBy('id', 'desc').limit(8),
  ]);
  const n = (v) => Number(v || 0);
  return {
    transport: config.mail.transport === 'sendmail' ? 'Server mail (sendmail)' : config.mail.host ? `SMTP (${config.mail.host})` : 'Not set up (emails are printed to the console)',
    configured: config.mail.transport === 'sendmail' || Boolean(config.mail.host),
    day: { sent: n(day && day.sent), failed: n(day && day.failed) },
    week: { sent: n(week && week.sent), failed: n(week && week.failed) },
    lastOkAt: lastOk ? lastOk.created_at : null,
    lastAttempt: lastAttempt || null,
    failures,
  };
}

async function scanner() {
  const virusScan = require('./virusScan');
  const [engine, ok, err, used, waiting] = await Promise.all([
    virusScan.describe(),
    counter('scan_ok'),
    counter('scan_error'),
    counter('cloudmersive'),
    db('job_applications').where({ scan_status: 'pending' }).whereNotNull('resume_file').select(db.raw('COUNT(*) as n'), db.raw('MIN(created_at) as oldest')).first(),
  ]);
  const cloud = Boolean(config.virusScan.cloudmersiveKey) && ['auto', 'cloudmersive'].includes(config.virusScan.mode);
  const usedCount = used ? used.count : 0;
  return {
    engine,
    lastOkAt: ok ? ok.last_at : null,
    lastError: err ? { at: err.last_at, detail: err.last_detail, count: err.count } : null,
    waiting: { count: Number(waiting.n || 0), oldest: waiting.oldest || null },
    cloudmersive: cloud ? { used: usedCount, limit: config.virusScan.cloudmersiveLimit, pct: Math.min(100, Math.round((usedCount / config.virusScan.cloudmersiveLimit) * 100)) } : null,
  };
}

async function storage() {
  const folders = [];
  for (const [dir, label] of FOLDERS) folders.push({ label, ...(await folderSize(path.join(config.paths.storage, dir))) });
  folders.push({ label: 'Database backups', ...(await folderSize(BACKUPS)) });
  let disk = null;
  try {
    const s = await fs.statfs(ROOT);
    disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    disk = null;
  }
  return { folders, total: folders.reduce((sum, f) => sum + f.bytes, 0), disk };
}

async function database() {
  const row = await db.raw('SELECT SUM(data_length + index_length) AS bytes, COUNT(*) AS tables FROM information_schema.tables WHERE table_schema = DATABASE()');
  const r = row[0][0] || {};
  return { bytes: Number(r.bytes || 0), tables: Number(r.tables || 0) };
}

// --- Problems ----------------------------------------------------------------------------------

const hoursSince = (d, now) => (d ? (now - new Date(d).getTime()) / HOUR : Infinity);

/** What needs attention, most serious first. severity: "bad" (broken) or "warn" (needs a look). */
function problemsOf(s, now = Date.now()) {
  const list = [];
  const add = (key, severity, title, detail) => list.push({ key, severity, title, detail });

  const e = s.email;
  if (!e.configured && config.isProd) add('email_setup', 'bad', 'Email isn’t set up', 'No SMTP server or sendmail is configured, so no emails are going out.');
  else if (e.lastAttempt && !e.lastAttempt.ok) add('email_failing', 'bad', 'Emails are failing', `The last email couldn’t be sent: ${e.lastAttempt.error || 'unknown error'}`);
  else if (e.day.failed >= 3) add('email_some_failing', 'warn', 'Some emails failed today', `${e.day.failed} failed in the last 24 hours.`);

  const v = s.scanner;
  if (!v.engine.ok) add('scanner_missing', 'bad', 'No virus scanner', 'Resumes can’t be checked, so applicants’ files stay locked.');
  else if (v.lastError && (!v.lastOkAt || new Date(v.lastError.at) > new Date(v.lastOkAt))) add('scanner_failing', 'bad', 'The virus scanner is failing', v.lastError.detail || 'The last scan didn’t work.');
  if (v.waiting.count && hoursSince(v.waiting.oldest, now) > 2) add('scanner_waiting', 'warn', 'Resumes waiting for a virus scan', `${v.waiting.count} waiting, the oldest for over 2 hours.`);
  if (v.cloudmersive && v.cloudmersive.pct >= 100) add('cloudmersive_used', 'bad', 'Cloudmersive allowance used up', `${v.cloudmersive.used} of ${v.cloudmersive.limit} scans this month. New resumes wait until next month or a bigger plan.`);
  else if (v.cloudmersive && v.cloudmersive.pct >= 80) add('cloudmersive_high', 'warn', 'Cloudmersive allowance nearly used', `${v.cloudmersive.used} of ${v.cloudmersive.limit} scans this month.`);

  const b = s.backups;
  if (b.failed) add('backup_failing', 'bad', 'Backups are failing', b.failed.detail || 'The last backup didn’t work.');
  else if (config.isProd && !b.latest) add('backup_none', 'bad', 'No database backups', 'There is no backup in the backups folder.');
  else if (config.isProd && hoursSince(b.latest.at, now) > 48) add('backup_old', 'warn', 'The last backup is over 2 days old', `Newest: ${b.latest.name}`);

  if (s.version.refused) add('deploy_refused', 'warn', 'A newer version wasn’t installed', `Version ${s.version.refused.commit} failed its tests or its install, so the site stayed on ${s.version.commit}.`);

  const d = s.storage.disk;
  if (d && d.free < 1024 ** 3) add('disk_low', d.free < 200 * 1024 ** 2 ? 'bad' : 'warn', 'Disk space is low', `${(d.free / 1024 ** 3).toFixed(2)} GB free.`);

  return list.sort((a, c) => (a.severity === c.severity ? 0 : a.severity === 'bad' ? -1 : 1));
}

let cached = null; // { problems, at } from the last snapshot, for the menu counter

/** Everything on the page, and the problems. */
async function snapshot() {
  const [v, b, e, sc, st, dbi] = await Promise.all([version(), backups(), email(), scanner(), storage(), database()]);
  const s = { version: v, backups: b, email: e, scanner: sc, storage: st, database: dbi };
  s.problems = problemsOf(s);
  s.checkedAt = new Date();
  cached = { problems: s.problems, at: Date.now() };
  return s;
}

/** For the menu counter: problems found by the last check (null if not checked yet in this process). */
const problemCount = () => (cached ? cached.problems.length : null);

// --- Actions -----------------------------------------------------------------------------------

/** Run scripts/db-backup.js. Resolves { ok, message }. */
function runBackup() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'db-backup.js')], { cwd: ROOT, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
    // A failure is remembered so System health shows (and alerts about) backups that keep failing.
    child.on('error', async (err) => {
      clearTimeout(timer);
      await count('backup_error', err.message);
      resolve({ ok: false, message: err.message });
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      const message = out.trim().split('\n').pop() || (code === 0 ? 'Backup saved.' : `Backup failed (exit ${code}).`);
      if (code !== 0) await count('backup_error', message);
      resolve({ ok: code === 0, message });
    });
  });
}

function testEmail(user) {
  return require('./notify').notify({
    to: user.email,
    subject: 'HLO portal: test email',
    text: [`Hello ${user.name.split(' ')[0]},`, '', 'This is a test from System health in the HLO staff portal. If you can read it, email is working.'].join('\n'),
    footnote: 'Sent because you clicked “Send a test email” on System health.',
  });
}

/** Scan a small harmless file. Uses one Cloudmersive scan when Cloudmersive is in use. */
async function testScanner() {
  return require('./virusScan').scan(Buffer.from('%PDF-1.4\n% HLO system health test file\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'));
}

// --- Background check and alerts ---------------------------------------------------------------

async function check({ now = Date.now(), autoBackup = config.isProd } = {}) {
  let s = await snapshot();
  if (autoBackup && (!s.backups.latest || hoursSince(s.backups.latest.at, now) > BACKUP_DUE_HOURS)) {
    const result = await runBackup();
    if (!result.ok) console.error('Scheduled backup failed:', result.message);
    s = await snapshot();
  }
  await db('email_log').where('created_at', '<', db.raw('NOW() - INTERVAL 90 DAY')).del();

  // Tell people about each new problem, at most once a day each.
  const content = require('./content');
  const alerted = { ...((await content.getSetting(ALERT_SETTING, {})) || {}) };
  const current = new Set(s.problems.map((p) => p.key));
  const fresh = s.problems.filter((p) => !alerted[p.key] || now - Date.parse(alerted[p.key]) > 24 * HOUR);
  for (const key of Object.keys(alerted)) if (!current.has(key)) delete alerted[key];
  if (fresh.length) {
    const alerts = require('./alerts');
    const title = fresh.length === 1 ? `System problem: ${fresh[0].title}` : `${fresh.length} system problems`;
    const body = fresh.map((p) => p.title).join(' · ');
    const people = await alerts.send('system', { type: 'system', title, body, link: '/portal/system' });
    const { notify } = require('./notify');
    await Promise.all(people.filter((p) => p.email).map((p) => notify({
      to: p.email,
      subject: `HLO portal: ${title}`,
      text: [`Hello ${p.name.split(' ')[0]},`, '', 'System health found something that needs a look:', '', ...fresh.map((x) => `- ${x.title}: ${x.detail}`)].join('\n'),
      cta: { label: 'Open System health', href: `${config.appUrl}/portal/system` },
      footnote: 'Sent by the HLO staff portal because your role is told about system problems (Roles & permissions → Alerts).',
    })));
    for (const p of fresh) alerted[p.key] = new Date(now).toISOString();
  }
  await db('site_settings').insert({ key: ALERT_SETTING, value: JSON.stringify(alerted), updated_at: new Date() }).onConflict('key').merge();
  content.clearCache();
  return { problems: s.problems, alerted: fresh.map((p) => p.key) };
}

/** Every 15 minutes while the app runs (not in tests). */
function startChecks() {
  if (config.isTest) return;
  const run = () => check().catch((err) => console.error('Health check failed:', err.message));
  setTimeout(run, 2 * 60 * 1000).unref();
  setInterval(run, 15 * 60 * 1000).unref();
}

module.exports = { mask, recordEmail, count, snapshot, problemsOf, problemCount, runBackup, testEmail, testScanner, check, startChecks };
