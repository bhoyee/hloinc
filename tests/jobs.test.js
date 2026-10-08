import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp, db } from './helpers.js';
import { resetRoles, makeRole, makeUser, signIn, post } from './portal-helpers.js';

const app = createApp();

const JOB = {
  title: 'Direct Support Professional',
  department: 'Residential',
  location: 'Catonsville, MD',
  employment_type: 'Full-time',
  pay_range: '$17.00 – $19.00 per hour',
  description: 'Support adults with disabilities to live full lives at home and in the community.',
  requirements: '- High school diploma',
  benefits: '- Paid training',
  apply_url: 'https://workforcenow.adp.com/jobs/123',
};

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('jobs').del();
  await db('users').del();
  await resetRoles();
});

afterAll(() => db.destroy());

describe('jobs manager: access', () => {
  it('is only for roles with jobs access', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    expect((await coordinator.get('/portal/jobs')).status).toBe(403);
    expect((await coordinator.get('/portal')).text).not.toContain('href="/portal/jobs"');

    const director = await signIn(app, await makeUser('program_director'));
    const list = await director.get('/portal/jobs');
    expect(list.status).toBe(200);
    expect(list.text).toContain('href="/portal/jobs/new"');
  });

  it('lets a view-only role look but not change anything', async () => {
    await makeRole('viewer', ['jobs.view']);
    const [id] = await db('jobs').insert({ ...JOB, slug: 'dsp', status: 'draft' });
    const viewer = await signIn(app, await makeUser('viewer'));
    const page = await viewer.get(`/portal/jobs/${id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('disabled');
    expect(page.text).not.toContain('Save &amp; publish');
    expect((await post(viewer, '/portal/jobs', `/portal/jobs/${id}`, JOB)).status).toBe(403);
    expect((await post(viewer, '/portal/jobs', `/portal/jobs/${id}/status`, { action: 'publish' })).status).toBe(403);
    expect((await db('jobs').where({ id }).first()).status).toBe('draft');
  });
});

describe('jobs manager: create and publish', () => {
  it('saves a draft that the public site does not show', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    const res = await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, intent: 'draft' });
    expect(res.status).toBe(303);
    const job = await db('jobs').first();
    expect(job.status).toBe('draft');
    expect(job.slug).toBe('direct-support-professional');
    expect((await request(app).get(`/careers/${job.slug}`)).status).toBe(404);
    // Staff can preview it.
    const preview = await director.get(`/portal/jobs/${job.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain('Preview');
    expect(await db('audit_log').where({ action: 'job.create' }).first()).toBeTruthy();
  });

  it('will not publish without pay range and benefits (Maryland law)', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    const res = await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, pay_range: '', benefits: '', intent: 'publish' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Maryland law requires it');
    expect(Number((await db('jobs').count({ n: '*' }).first()).n)).toBe(0);
  });

  it('publishes, shows on the careers page, then unpublishes', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, intent: 'publish' });
    const job = await db('jobs').first();
    expect(job.status).toBe('published');
    expect(job.published_at).toBeTruthy();
    expect((await request(app).get(`/careers/${job.slug}`)).status).toBe(200);

    await post(director, `/portal/jobs/${job.id}`, `/portal/jobs/${job.id}/status`, { action: 'unpublish' });
    expect((await db('jobs').first()).status).toBe('draft');
    expect((await request(app).get(`/careers/${job.slug}`)).status).toBe(404);
  });

  it('requires a secure https apply link', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    for (const apply_url of ['http://adp.com/x', 'javascript:alert(1)', 'workforcenow.adp.com', '']) {
      const res = await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, apply_url, intent: 'draft' });
      expect(res.status).toBe(422);
    }
    expect(Number((await db('jobs').count({ n: '*' }).first()).n)).toBe(0);
  });

  it('escapes anything that looks like code on the public page', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, description: 'Great role <script>alert(1)</script> with real impact', intent: 'publish' });
    const job = await db('jobs').first();
    const page = await request(app).get(`/careers/${job.slug}`);
    expect(page.text).not.toContain('<script>alert(1)</script>');
    expect(page.text).toContain('&lt;script&gt;');
  });
});

describe('jobs manager: editing', () => {
  it('keeps the web address once published, and gives new jobs unique addresses', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, intent: 'publish' });
    await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, intent: 'draft' });
    const [first, second] = await db('jobs').orderBy('id');
    expect(second.slug).toBe('direct-support-professional-2');

    await post(director, `/portal/jobs/${first.id}`, `/portal/jobs/${first.id}`, { ...JOB, title: 'Senior DSP' });
    const after = await db('jobs').where({ id: first.id }).first();
    expect(after.title).toBe('Senior DSP');
    expect(after.slug).toBe('direct-support-professional');

    // A draft that was never published follows its title.
    await post(director, `/portal/jobs/${second.id}`, `/portal/jobs/${second.id}`, { ...JOB, title: 'Night Support Staff' });
    expect((await db('jobs').where({ id: second.id }).first()).slug).toBe('night-support-staff');
  });

  it('won’t let a live job lose its pay range', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, intent: 'publish' });
    const job = await db('jobs').first();
    const res = await post(director, `/portal/jobs/${job.id}`, `/portal/jobs/${job.id}`, { ...JOB, pay_range: '' });
    expect(res.status).toBe(422);
    expect((await db('jobs').first()).pay_range).toBe(JOB.pay_range);
  });

  it('copies a job into a new draft', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    await post(director, '/portal/jobs/new', '/portal/jobs', { ...JOB, intent: 'publish' });
    const job = await db('jobs').first();
    await post(director, `/portal/jobs/${job.id}`, `/portal/jobs/${job.id}/copy`);
    const copy = await db('jobs').orderBy('id', 'desc').first();
    expect(copy.title).toBe(`${JOB.title} (copy)`);
    expect(copy.status).toBe('draft');
    expect(copy.pay_range).toBe(JOB.pay_range);
  });
});

describe('jobs manager: archive and delete', () => {
  it('deletes only archived jobs', async () => {
    const [id] = await db('jobs').insert({ ...JOB, slug: 'dsp', status: 'published', published_at: new Date() });
    const director = await signIn(app, await makeUser('program_director'));

    await post(director, `/portal/jobs/${id}`, `/portal/jobs/${id}/delete`);
    expect(await db('jobs').where({ id }).first()).toBeTruthy(); // not archived yet

    await post(director, `/portal/jobs/${id}`, `/portal/jobs/${id}/status`, { action: 'archive' });
    expect((await db('jobs').where({ id }).first()).status).toBe('archived');
    expect((await request(app).get('/careers/dsp')).status).toBe(404);

    await post(director, `/portal/jobs/${id}`, `/portal/jobs/${id}/status`, { action: 'restore' });
    expect((await db('jobs').where({ id }).first()).status).toBe('draft');

    await post(director, `/portal/jobs/${id}`, `/portal/jobs/${id}/status`, { action: 'archive' });
    await post(director, `/portal/jobs/${id}`, `/portal/jobs/${id}/delete`);
    expect(await db('jobs').where({ id }).first()).toBeUndefined();
    expect(await db('audit_log').where({ action: 'job.delete' }).first()).toBeTruthy();
  });

  it('needs the permanent-delete permission to delete', async () => {
    await makeRole('editor', ['jobs.edit', 'jobs.archive']);
    const [id] = await db('jobs').insert({ ...JOB, slug: 'dsp', status: 'archived' });
    const editor = await signIn(app, await makeUser('editor'));
    expect((await post(editor, `/portal/jobs/${id}`, `/portal/jobs/${id}/delete`)).status).toBe(403);
    expect(await db('jobs').where({ id }).first()).toBeTruthy();
  });
});
