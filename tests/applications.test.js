import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { createApp, db, formAgent } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const { _outbox: outbox } = require('../src/services/notify');
const spam = require('../src/lib/spam');
const applications = require('../src/services/applications');
const config = require('../src/config');

const app = createApp();
const DIR = path.join(config.paths.storage, 'applications');

// A minimal real PDF, and a minimal .docx (ZIP) with the parts Word files have.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const zipOf = (...names) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join('\n'))]);
const DOCX = zipOf('[Content_Types].xml', 'word/document.xml');
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
// The harmless antivirus test file hidden inside an otherwise normal PDF.
const INFECTED_PDF = Buffer.concat([PDF, EICAR]);

let job;

beforeEach(async () => {
  outbox.length = 0;
  spam._reset();
  await db('job_applications').del();
  await db('notifications').del();
  await db('audit_log').del();
  await db('users').del();
  await db('jobs').where('slug', 'like', 'test-dsp%').del();
  await resetRoles();
  const [id] = await db('jobs').insert({
    title: 'Test DSP', slug: 'test-dsp', status: 'published', published_at: new Date(), description: 'Support people in their daily lives.', pay_range: '$18 per hour', benefits: 'Paid training',
  });
  job = await db('jobs').where({ id }).first();
});

afterAll(() => db.destroy());

async function apply({ file = PDF, filename = 'My Resume.pdf', fields = {} } = {}) {
  const { agent, csrf } = await formAgent(app, '/careers/test-dsp/apply');
  const req = agent.post('/careers/test-dsp/apply').field('_csrf', csrf);
  const values = { first_name: 'Jordan', last_name: 'Applicant', email: 'jordan@example.com', phone: '410-555-0142', cover_note: 'I can start next month.', consent: 'yes', ...fields };
  for (const [k, v] of Object.entries(values)) req.field(k, v);
  if (file) req.attach('resume', file, filename);
  return req;
}

describe('applying for a job', () => {
  it('links each job to its own application form (no ADP)', async () => {
    const page = request.agent(app);
    const res = await page.get('/careers/test-dsp');
    expect(res.text).toContain('href="/careers/test-dsp/apply"');
    expect(res.text).not.toMatch(/ADP/);
    const form = await page.get('/careers/test-dsp/apply');
    expect(form.text).toContain('enctype="multipart/form-data"');
  });

  it('saves the application with an encrypted, scanned resume, and tells everyone', async () => {
    const admin = await makeUser('admin');
    const res = await apply();
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/careers/test-dsp/applied');

    const [a] = await db('job_applications');
    expect(a).toMatchObject({ job_id: job.id, job_title: 'Test DSP', first_name: 'Jordan', phone: '(410) 555-0142', resume_type: 'pdf', resume_name: 'My Resume.pdf', scan_status: 'clean', status: 'new' });
    expect(a.reference).toMatch(/^HLO-APP-/);
    // Stored encrypted, outside the public folders.
    const stored = fs.readFileSync(path.join(DIR, `${a.resume_file}.bin`));
    expect(stored.includes(Buffer.from('%PDF'))).toBe(false);

    expect(outbox.map((m) => m.to)).toContain('jordan@example.com');
    const team = outbox.find((m) => m.subject.startsWith('New application'));
    expect(team.text).not.toContain('%PDF');
    expect(team.attachments).toBeUndefined();
    expect(await db('notifications').where({ user_id: admin.id, type: 'application' })).toHaveLength(1);
  });

  it('accepts a Word .docx', async () => {
    expect((await apply({ file: DOCX, filename: 'cv.docx' })).status).toBe(303);
    expect((await db('job_applications').first()).resume_type).toBe('docx');
  });

  it.each([
    ['a PDF carrying the EICAR test virus', INFECTED_PDF, 'resume.pdf', /virus scan flagged/],
    ['a program renamed to .pdf', Buffer.from('MZ\x90\x00 this is not a document'), 'resume.pdf', /PDF or a Word \.docx/],
    ['a PDF with JavaScript', Buffer.from('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF'), 'cv.pdf', /scripts or attached files/],
    ['a macro-enabled Word file', zipOf('[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'), 'cv.docx', /macros/],
    ['an old .doc file', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'cv.doc', /\.doc\) can’t be accepted/],
    ['a file over 5 MB', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'big.pdf', /over 5 MB/],
  ])('refuses %s and stores nothing', async (_, file, filename, message) => {
    const before = fs.existsSync(DIR) ? fs.readdirSync(DIR).length : 0;
    const res = await apply({ file, filename });
    expect(res.status).toBe(422);
    expect(res.text).toMatch(message);
    expect(await db('job_applications')).toHaveLength(0);
    expect(fs.existsSync(DIR) ? fs.readdirSync(DIR).length : 0).toBe(before);
  });

  it('logs a blocked virus in the audit log', async () => {
    await apply({ file: INFECTED_PDF });
    expect(await db('audit_log').where({ action: 'application.virus_blocked' }).first()).toBeTruthy();
  });

  it('needs a resume, and the usual details', async () => {
    const res = await apply({ file: null, fields: { email: 'not-an-email', consent: '' } });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Attach your resume');
    expect(res.text).toContain('Enter a valid email address');
    expect(await db('job_applications')).toHaveLength(0);
  });

  it('rejects a form without its token', async () => {
    const res = await (await formAgent(app, '/careers/test-dsp/apply')).agent
      .post('/careers/test-dsp/apply').field('first_name', 'X').attach('resume', PDF, 'cv.pdf');
    expect(res.status).toBe(303); // sent back with "nothing was sent"
    expect(await db('job_applications')).toHaveLength(0);
  });

  it('only accepts applications for live jobs', async () => {
    await db('jobs').where({ id: job.id }).update({ status: 'draft' });
    expect((await request(app).get('/careers/test-dsp/apply')).status).toBe(404);
  });
});

describe('applications in the portal', () => {
  it('is Admin-only by default, and resumes download only after a clean scan', async () => {
    await apply();
    const a = await db('job_applications').first();
    const director = await signIn(app, await makeUser('program_director'));
    expect((await director.get('/portal/applications')).status).toBe(403);
    expect((await director.get(`/portal/applications/${a.id}/resume`)).status).toBe(403);

    const admin = await signIn(app, await makeUser('admin'));
    const list = await admin.get('/portal/applications');
    expect(list.text).toContain('Jordan Applicant');
    const file = await admin.get(`/portal/applications/${a.id}/resume`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toBe('attachment; filename="My Resume.pdf"');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(file.body, PDF)).toBe(0);
    expect(await db('audit_log').where({ action: 'application.resume_download' }).first()).toBeTruthy();

    // A resume still waiting for its scan stays locked.
    await db('job_applications').where({ id: a.id }).update({ scan_status: 'pending' });
    expect((await admin.get(`/portal/applications/${a.id}/resume`)).status).toBe(303);
  });

  it('rescans waiting resumes: clean ones unlock, infected ones are deleted', async () => {
    await apply();
    const a = await db('job_applications').first();
    await db('job_applications').where({ id: a.id }).update({ scan_status: 'pending' });
    expect(await applications.rescanPending()).toBe(1);
    expect((await db('job_applications').first()).scan_status).toBe('clean');

    // Swap in an infected file to check the other path.
    const { encryptBuffer } = require('../src/lib/crypto');
    fs.writeFileSync(path.join(DIR, `${a.resume_file}.bin`), encryptBuffer(INFECTED_PDF));
    await db('job_applications').where({ id: a.id }).update({ scan_status: 'pending' });
    await applications.rescanPending();
    const after = await db('job_applications').first();
    expect(after).toMatchObject({ scan_status: 'infected', resume_file: null });
    expect(fs.existsSync(path.join(DIR, `${a.resume_file}.bin`))).toBe(false);
  });

  it('lets Admin give access to another role, change status and delete', async () => {
    await apply();
    const a = await db('job_applications').first();
    const role = await db('roles').where({ key: 'program_director' }).first();
    await db('role_permissions').insert({ role_id: role.id, permission: 'jobs.applications' });
    require('../src/services/roles').clearCache();
    const director = await signIn(app, await makeUser('program_director'));
    const show = await director.get(`/portal/applications/${a.id}`);
    expect(show.status).toBe(200);
    expect((await db('job_applications').first()).status).toBe('reviewing'); // opened
    await post(director, `/portal/applications/${a.id}`, `/portal/applications/${a.id}/status`, { status: 'shortlisted' });
    expect((await db('job_applications').first()).status).toBe('shortlisted');

    await post(director, `/portal/applications/${a.id}`, `/portal/applications/${a.id}/delete`);
    expect(await db('job_applications')).toHaveLength(0);
    expect(fs.existsSync(path.join(DIR, `${a.resume_file}.bin`))).toBe(false);
  });
});

describe('cloud virus scanning (Cloudmersive)', () => {
  const virusScan = require('../src/services/virusScan');
  const realFetch = globalThis.fetch;
  const reply = (status, body) => async (url, init) => {
    reply.last = { url, init };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };

  beforeEach(() => {
    config.virusScan.cloudmersiveKey = 'test-key';
  });
  afterAll(() => {
    config.virusScan.cloudmersiveKey = '';
    globalThis.fetch = realFetch;
  });

  it('is used when a key is set, and sends the file with every unsafe option refused', async () => {
    globalThis.fetch = reply(200, { CleanResult: true, FoundViruses: null });
    expect(await virusScan.scan(PDF)).toEqual({ status: 'clean', engine: 'Cloudmersive (cloud)', detail: null });
    expect(reply.last.url).toBe('https://api.cloudmersive.com/virus/scan/file/advanced');
    expect(reply.last.init.headers).toMatchObject({ Apikey: 'test-key', allowMacros: 'false', allowScripts: 'false', restrictFileTypes: '.pdf,.docx' });
    expect((await virusScan.describe()).label).toBe('Cloudmersive (cloud)');
  });

  it('reports viruses by name, and unsafe content by kind', async () => {
    globalThis.fetch = reply(200, { CleanResult: false, FoundViruses: [{ FileName: 'resume', VirusName: 'Win.Trojan.Test' }] });
    expect(await virusScan.scan(PDF)).toMatchObject({ status: 'infected', detail: 'Win.Trojan.Test' });
    globalThis.fetch = reply(200, { CleanResult: false, ContainsMacros: true, FoundViruses: [] });
    expect(await virusScan.scan(PDF)).toMatchObject({ status: 'infected', detail: 'Unsafe content: macros' });
  });

  it('keeps the resume locked when the service is unavailable or the allowance is used up', async () => {
    globalThis.fetch = reply(429, {});
    expect(await virusScan.scan(PDF)).toMatchObject({ status: 'error' });
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await virusScan.scan(PDF)).toMatchObject({ status: 'error', detail: 'Could not reach the virus scanner' });
    await apply();
    expect(await db('job_applications').first()).toMatchObject({ scan_status: 'pending' });
  });

  it('tells the applicant when their file has macros or scripts', async () => {
    globalThis.fetch = reply(200, { CleanResult: false, ContainsScript: true, FoundViruses: [] });
    const res = await apply();
    expect(res.status).toBe(422);
    expect(res.text).toContain('content a resume shouldn’t have');
    expect(await db('job_applications')).toHaveLength(0);
  });
});
