'use strict';

/**
 * Job applications from the careers page. Each one has the applicant's details
 * and a resume. Resumes are:
 *   1. checked to be what they claim (a real PDF or Word .docx, by their contents,
 *      not their name), with no macros, scripts or embedded files;
 *   2. virus-scanned with ClamAV (services/virusScan) — an infected file is refused
 *      and never stored;
 *   3. encrypted (AES-256-GCM) and kept in storage/applications, outside the public
 *      folders, under a random name.
 * If the scanner can't run, the application is still saved but its resume stays
 * locked until a later scan passes (rescanPending runs every 15 minutes).
 * Staff download resumes only through the portal, and each download is logged.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/knex');
const config = require('../config');
const { encryptBuffer, decryptBuffer } = require('../lib/crypto');
const { insertWithReference, normalizeSearch } = require('../lib/reference');
const virusScan = require('./virusScan');

const DIR = path.join(config.paths.storage, 'applications');
const MAX_BYTES = config.virusScan.resumeMaxBytes;
const MAX_LABEL = `${+(MAX_BYTES / 1048576).toFixed(1)} MB`;

const STATUS_LABELS = { new: 'New', reviewing: 'Reviewing', shortlisted: 'Shortlisted', hired: 'Hired', not_selected: 'Not selected' };
const TABS = {
  new: { label: 'New', apply: (q) => q.where('a.status', 'new') },
  open: { label: 'In progress', apply: (q) => q.whereIn('a.status', ['reviewing', 'shortlisted']) },
  closed: { label: 'Closed', apply: (q) => q.whereIn('a.status', ['hired', 'not_selected']) },
  all: { label: 'All', apply: (q) => q },
};
const TYPES = { pdf: { label: 'PDF', mime: 'application/pdf' }, docx: { label: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } };

// --- Checking the file -----------------------------------------------------------------------

const problem = (message) => Object.assign(new Error(message), { status: 422, field: 'resume' });

/**
 * What kind of file this really is, or a friendly error. Looks at the bytes:
 * PDFs start "%PDF-"; .docx files are ZIP packages containing word/document.xml.
 */
function checkFile(file) {
  if (!file || !file.buffer || !file.size) throw problem('Attach your resume (PDF or Word .docx).');
  if (file.size > MAX_BYTES) throw problem(`Your resume is over ${MAX_LABEL}. Please attach a smaller file.`);
  const buf = file.buffer;
  const head = buf.subarray(0, 1024).toString('latin1');
  const ext = path.extname(String(file.originalname || '')).toLowerCase();

  if (head.includes('%PDF-')) {
    if (ext && ext !== '.pdf') throw problem('That file’s name doesn’t match its contents. Please attach a PDF or Word .docx file.');
    // Scripts, launch actions and attached files have no place in a resume.
    const body = buf.toString('latin1');
    // (Long names only: short ones like /JS can appear by chance inside compressed data. ClamAV checks PDFs too.)
    if (/\/(JavaScript|Launch|EmbeddedFiles?|RichMedia)\b/.test(body)) {
      throw problem('That PDF contains scripts or attached files, so we can’t accept it. Please save it again as a plain PDF (File → Print → Save as PDF) and attach that.');
    }
    return 'pdf';
  }
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const names = buf.toString('latin1');
    if (!names.includes('word/document.xml') || !names.includes('[Content_Types].xml')) {
      throw problem('Please attach a PDF or a Word .docx file.');
    }
    if (ext && ext !== '.docx') throw problem('Macro-enabled or unusual Word files can’t be accepted. Please save your resume as a PDF or .docx.');
    if (/vbaProject\.bin|macroEnabled|word\/embeddings\/|activeX/i.test(names)) {
      throw problem('That Word file contains macros or embedded objects, so we can’t accept it. Please save it as a PDF or a plain .docx.');
    }
    return 'docx';
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw problem('Older Word files (.doc) can’t be accepted. Please save your resume as a PDF or .docx and attach that.');
  }
  throw problem('Please attach your resume as a PDF or a Word .docx file.');
}

/** A safe display name: letters, numbers, spaces, dots, dashes; the right extension. */
function tidyName(original, type) {
  const base = path.basename(String(original || 'resume')).replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${base || 'resume'}.${type}`;
}

// --- Storing -----------------------------------------------------------------------------------

async function store(buffer) {
  const name = crypto.randomBytes(16).toString('hex');
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(DIR, `${name}.bin`), encryptBuffer(buffer), { mode: 0o600 });
  return name;
}

async function readStored(name) {
  if (!/^[a-f0-9]{32}$/.test(String(name))) return null;
  try {
    return decryptBuffer(await fs.readFile(path.join(DIR, `${name}.bin`)));
  } catch {
    return null;
  }
}

const removeStored = (name) => (/^[a-f0-9]{32}$/.test(String(name)) ? fs.rm(path.join(DIR, `${name}.bin`), { force: true }) : null);

// --- Submitting --------------------------------------------------------------------------------

/**
 * Check, scan and save an application. Throws a 422 error (with `field`) for a
 * file we won't accept, including one the virus scan flags. Returns the new row.
 */
async function submit(job, data, file, { ip }) {
  const type = checkFile(file);
  const result = await virusScan.scan(file.buffer);
  if (result.status === 'infected') {
    console.warn(`[applications] refused an infected upload for job ${job.id} (${result.detail})`);
    throw Object.assign(problem(String(result.detail).startsWith('Unsafe content')
      ? 'Our security scan found content a resume shouldn’t have (such as macros, scripts or password protection), so it was not accepted. Please save it again as a plain PDF or .docx and attach that.'
      : 'Our virus scan flagged that file, so it was not accepted. Please check your device, then attach a clean copy of your resume.'), { infected: result });
  }

  const resumeFile = await store(file.buffer);
  const { id, reference } = await insertWithReference(db, 'job_applications', {
    job_id: job.id,
    job_title: job.title,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    cover_note: data.cover_note || null,
    resume_name: tidyName(file.originalname, type),
    resume_type: type,
    resume_size: file.size,
    resume_file: resumeFile,
    resume_sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    scan_status: result.status === 'clean' ? 'clean' : 'pending',
    scan_engine: result.engine,
    scan_detail: result.status === 'clean' ? null : result.detail,
    scanned_at: result.status === 'clean' ? db.fn.now() : null,
    ip,
  }, 'application');

  const application = await db('job_applications').where({ id }).first();
  const emailed = await tellPeople(application, job);
  await db('job_applications').where({ id }).update({ email_status: emailed.team ? 'sent' : 'failed' });
  return { ...application, reference, acknowledged: emailed.applicant };
}

async function tellPeople(a, job) {
  const content = require('./content');
  const { notify } = require('./notify');
  const business = await content.getBusiness();
  const name = `${a.first_name} ${a.last_name}`;
  const [team, applicant] = await Promise.all([
    notify({
      to: await content.getRecipientEmail('careers'),
      replyTo: a.email,
      subject: `New application ${a.reference}: ${a.job_title}`,
      text: [
        `${name} applied for ${a.job_title} on the HLO website (reference ${a.reference}).`,
        '',
        'Their details and resume are in the staff portal. For privacy, the resume is never sent by email.',
      ].join('\n'),
      cta: { label: 'Open in the staff portal', href: `${config.appUrl}/portal/applications/${a.id}` },
      footnote: 'Sent automatically by the HLO website. Reply to this email to reach the applicant directly.',
    }),
    notify({
      to: a.email,
      replyTo: await content.getRecipientEmail('careers'),
      subject: `We received your application for ${a.job_title}`,
      text: [
        `Hello ${a.first_name},`,
        '',
        `Thank you for applying to ${business.legalName}. We have received your application and resume.`,
        '',
        'YOUR APPLICATION',
        `Position: ${a.job_title}`,
        `Reference: ${a.reference}`,
        '',
        'WHAT HAPPENS NEXT',
        '',
        '- Our team reviews every application.',
        '- If your experience is a good match, we will contact you to arrange a conversation.',
        '',
        'HLO will never ask you to pay anything as part of applying or being hired.',
        '',
        'Warm regards,',
        `The ${business.legalName} team`,
      ].join('\n'),
      cta: { label: 'See other open positions', href: `${config.appUrl}/careers` },
      footnote: 'This is an automatic confirmation. To add anything, reply to this email.',
    }),
  ]);
  await require('./alerts').send('application', {
    type: 'application',
    title: `New application: ${a.job_title}`,
    body: `From ${name}${a.scan_status === 'pending' ? ' · resume waiting for virus scan' : ''}`,
    link: `/portal/applications/${a.id}`,
  });
  return { team: team.ok, applicant: applicant.ok };
}

// --- Scanning again ------------------------------------------------------------------------------

/** Scan resumes still waiting (the scanner was unavailable). Infected files are deleted at once. */
async function rescanPending() {
  const waiting = await db('job_applications').where({ scan_status: 'pending' }).whereNotNull('resume_file').limit(25);
  let done = 0;
  for (const a of waiting) {
    const buffer = await readStored(a.resume_file);
    if (!buffer) continue;
    const result = await virusScan.scan(buffer);
    if (result.status === 'error') continue;
    if (result.status === 'infected') {
      await removeStored(a.resume_file);
      await db('job_applications').where({ id: a.id }).update({ scan_status: 'infected', scan_engine: result.engine, scan_detail: result.detail, scanned_at: db.fn.now(), resume_file: null, updated_at: db.fn.now() });
      await require('./alerts').send('application', {
        type: 'security',
        title: `Virus found in a resume (${a.reference})`,
        body: `The file was deleted. ${a.first_name} ${a.last_name}, ${a.job_title}.`,
        link: `/portal/applications/${a.id}`,
      });
    } else {
      await db('job_applications').where({ id: a.id }).update({ scan_status: 'clean', scan_engine: result.engine, scan_detail: null, scanned_at: db.fn.now(), updated_at: db.fn.now() });
    }
    done += 1;
  }
  return done;
}

function startRescans() {
  if (config.env === 'test') return;
  const run = () => rescanPending().catch((err) => console.error('Resume rescan failed:', err.message));
  setTimeout(run, 90 * 1000).unref();
  setInterval(run, 15 * 60 * 1000).unref();
}

// --- Staff side ----------------------------------------------------------------------------------

const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function filtered({ q = '', job = '' } = {}) {
  const query = db('job_applications as a');
  if (/^\d+$/.test(String(job))) query.where('a.job_id', Number(job));
  if (q) {
    const code = normalizeSearch(q);
    query.where((w) => {
      w.whereRaw("CONCAT(a.first_name, ' ', a.last_name) like ?", [likeOf(q)]).orWhere('a.email', 'like', likeOf(q)).orWhere('a.job_title', 'like', likeOf(q));
      if (code) w.orWhere('a.reference', 'like', `%-${code}`);
    });
  }
  return query;
}

async function tabCounts(filters) {
  const out = {};
  for (const [key, t] of Object.entries(TABS)) out[key] = Number((await t.apply(filtered(filters)).count({ n: '*' }).first()).n);
  return out;
}

async function list({ tab = 'new', q = '', job = '', page = 1, perPage = 25 } = {}) {
  const query = TABS[tab].apply(filtered({ q, job }));
  const total = Number((await query.clone().count({ n: '*' }).first()).n);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const items = await query.select('a.*').orderBy('a.created_at', 'desc').limit(perPage).offset((current - 1) * perPage);
  return { items, total, page: current, pages };
}

/** Jobs that have applications, for the filter. */
function jobsWithApplications() {
  return db('job_applications').whereNotNull('job_id').groupBy('job_id', 'job_title').select('job_id as id', 'job_title as title').count({ n: '*' }).orderBy('job_title');
}

const get = (id) => db('job_applications').where({ id }).first();

/** New applications count (menu badge), or null without access. */
async function newCount(user) {
  const { can } = require('../auth/permissions');
  if (!can(user, 'jobs.applications')) return null;
  return Number((await db('job_applications').where({ status: 'new' }).count({ n: '*' }).first()).n);
}

/** Applications per job, for the Jobs list. */
async function countsByJob(ids) {
  if (!ids.length) return {};
  const rows = await db('job_applications').whereIn('job_id', ids).groupBy('job_id').select('job_id').count({ n: '*' }).sum({ fresh: db.raw("CASE WHEN status = 'new' THEN 1 ELSE 0 END") });
  return Object.fromEntries(rows.map((r) => [r.job_id, { total: Number(r.n), fresh: Number(r.fresh) }]));
}

const setStatus = (a, status) => db('job_applications').where({ id: a.id }).update({ status, updated_at: db.fn.now() });

/** The resume's bytes, only if its scan passed. */
async function resume(a) {
  if (a.scan_status !== 'clean' || !a.resume_file) return null;
  return readStored(a.resume_file);
}

async function remove(a) {
  if (a.resume_file) await removeStored(a.resume_file);
  await db('job_applications').where({ id: a.id }).del();
}

module.exports = {
  STATUS_LABELS, TABS, TYPES, MAX_BYTES, MAX_LABEL,
  checkFile, tidyName, submit, rescanPending, startRescans,
  tabCounts, list, jobsWithApplications, get, newCount, countsByJob, setStatus, resume, remove,
};
