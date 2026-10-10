import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp, db, formAgent, nextWeekday, nextWeekend, todayInMaryland } from './helpers.js';

const app = createApp();

afterAll(() => db.destroy());

describe('public pages', () => {
  it.each([
    ['/', 'Supporting people with developmental disabilities'],
    ['/about', 'Mission statement'],
    ['/services', 'Personal Support'],
    ['/services/employment-services', 'Employment Services'],
    ['/request-services', 'Request services'],
    ['/services/respite-care', 'What support can include'],
    ['/service-areas', 'St. Mary’s County'],
    ['/getting-started', 'I am making a referral'],
    ['/resources', 'independent of HLO'],
    ['/careers', 'Open positions'],
    ['/contact', 'Send us a message'],
    ['/appointments/request', 'Request an appointment'],
  ])('%s renders', async (path, text) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain(text);
  });

  it('lists HLO’s six approved services, and no nursing or transportation', async () => {
    const res = await request(app).get('/services');
    const slugs = new Set([...res.text.matchAll(/<a href="\/services\/([a-z-]+)" class="group flex h-full/g)].map((m) => m[1]));
    expect([...slugs].sort()).toEqual(['community-development-services', 'community-residential-services', 'employment-services', 'personal-supports', 'respite-care', 'supported-living']);
    expect(res.text).not.toMatch(/nursing|transportation/i);
  });

  it('shows HLO’s confirmed address and hours', async () => {
    const res = await request(app).get('/contact');
    expect(res.text).toContain('4 E Rolling Crossroads, Suites 301–303');
    expect(res.text).toContain('MD 21228');
    expect(res.text).toContain('Sat – Sun closed');
  });

  it('shows the ten counties', async () => {
    const res = await request(app).get('/service-areas');
    expect(res.text.match(/County|Baltimore City/g).length).toBeGreaterThanOrEqual(10);
  });

  it('lists the contact recipients in the required order', async () => {
    const res = await request(app).get('/contact');
    const options = [...res.text.matchAll(/<option value="([a-z_]+)"/g)].map((m) => m[1]);
    expect(options).toEqual(['general', 'program_coordinator', 'program_director', 'executive', 'intake']);
  });

  it('preselects the intake recipient from ?to=intake', async () => {
    const res = await request(app).get('/contact?to=intake');
    expect(res.text).toMatch(/<option value="intake" selected>/);
  });

  it('serves robots.txt and a sitemap that hide the portal', async () => {
    const robots = await request(app).get('/robots.txt');
    expect(robots.text).toContain('Disallow: /portal');
    const sitemap = await request(app).get('/sitemap.xml');
    expect(sitemap.text).toContain('/services/personal-supports');
    expect(sitemap.text).not.toContain('/portal');
  });
});

describe('legacy WordPress URLs', () => {
  it.each([
    ['/about-hlo-inc/', '/about'],
    ['/contact-us/', '/contact'],
    ['/schedule-an-appointment/', '/appointments/request'],
    ['/send-your-referrals/', '/referrals'],
    ['/services/', '/services'],
  ])('%s redirects permanently to %s', async (from, to) => {
    const res = await request(app).get(from);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(to);
  });

  it.each(['/shop/cart/', '/blog/single-post/', '/about-hlo-inc/doctors-profile/', '/wp-login.php'])(
    '%s is gone (410)',
    async (path) => {
      expect((await request(app).get(path)).status).toBe(410);
    }
  );

  it('never redirects off-site', async () => {
    const res = await request(app).get('//evil.example/');
    expect(res.headers.location || '').not.toMatch(/^\/\//);
  });
});

describe('contact form', () => {
  beforeEach(() => db('contact_messages').del());

  const valid = {
    recipient: 'intake',
    name: 'Pat Example',
    email: 'pat@example.com',
    phone: '410-555-0123',
    message: 'I would like to learn about personal supports.',
  };

  it('saves a valid message and emails the recipient', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent.post('/contact').type('form').send({ ...valid, _csrf: csrf });
    expect(res.status).toBe(303);

    const rows = await db('contact_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient: 'intake', email: 'pat@example.com', status: 'new', email_status: 'sent' });

    const page = await agent.get('/contact');
    expect(page.text).toContain('Your message has been sent');
  });

  it('shows field errors and keeps what was typed', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent
      .post('/contact')
      .type('form')
      .send({ ...valid, email: 'not-an-email', message: 'short', _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Enter a valid email address');
    expect(res.text).toContain('at least 10 characters');
    expect(res.text).toContain('value="Pat Example"');
    expect(res.text).toMatch(/id="f-email"[^>]*aria-invalid="true"/);
    expect(await db('contact_messages')).toHaveLength(0);
  });

  it('rejects an unknown recipient', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent.post('/contact').type('form').send({ ...valid, recipient: 'ceo@evil', _csrf: csrf });
    expect(res.status).toBe(422);
  });

  it('silently drops honeypot submissions', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent.post('/contact').type('form').send({ ...valid, website: 'http://spam', _csrf: csrf });
    expect(res.status).toBe(303);
    expect(await db('contact_messages')).toHaveLength(0);
  });

  it('escapes HTML in what visitors type', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent
      .post('/contact')
      .type('form')
      .send({ ...valid, name: '<script>alert(1)</script>', email: 'bad', _csrf: csrf });
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('appointment requests', () => {
  let typeId;

  beforeEach(async () => {
    await db('appointments').del();
    typeId = (await db('appointment_types').where({ active: true }).first()).id;
  });

  const base = () => ({
    type_id: String(typeId),
    name: 'Sam Example',
    email: 'sam@example.com',
    phone: '',
    preferred_contact: 'email',
    requested_date: nextWeekday(1),
    requested_window: 'morning',
    notes: '',
    consent: 'yes',
  });

  it('saves a valid request as Requested from the website', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent.post('/appointments/request').type('form').send({ ...base(), _csrf: csrf });
    expect(res.status).toBe(303);

    const [row] = await db('appointments');
    expect(row).toMatchObject({ source: 'website', status: 'requested', requested_window: 'morning' });
  });

  it.each([
    ['today', () => todayInMaryland(), 'at least one day in advance'],
    ['a weekend', () => nextWeekend(), 'Choose a weekday'],
    ['too far ahead', () => nextWeekday(120), 'within the next 90 days'],
  ])('rejects a date that is %s', async (_, date, message) => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent
      .post('/appointments/request')
      .type('form')
      .send({ ...base(), requested_date: date(), _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain(message);
    expect(await db('appointments')).toHaveLength(0);
  });

  it('requires a phone number when phone contact is preferred', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent
      .post('/appointments/request')
      .type('form')
      .send({ ...base(), preferred_contact: 'phone', _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Enter a phone number so we can call you');
  });

  it('rejects inactive or unknown appointment types', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent
      .post('/appointments/request')
      .type('form')
      .send({ ...base(), type_id: '99999', _csrf: csrf });
    expect(res.status).toBe(422);
  });

  it('requires consent', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const { consent, ...rest } = base();
    const res = await agent.post('/appointments/request').type('form').send({ ...rest, _csrf: csrf });
    expect(res.status).toBe(422);
  });
});

describe('careers', () => {
  beforeEach(async () => {
    await db('jobs').del();
    await db('jobs').insert([
      {
        title: 'Direct Support Professional',
        slug: 'direct-support-professional',
        description: 'Support adults in the community.',
        apply_url: 'https://workforcenow.adp.com/example',
        status: 'published',
        published_at: new Date(),
      },
      {
        title: 'Secret Draft Role',
        slug: 'secret-draft-role',
        description: 'Not yet live.',
        apply_url: 'https://workforcenow.adp.com/draft',
        status: 'draft',
      },
    ]);
  });

  it('lists only published jobs', async () => {
    const res = await request(app).get('/careers');
    expect(res.text).toContain('Direct Support Professional');
    expect(res.text).not.toContain('Secret Draft Role');
  });

  it('shows a published job with its ADP apply link', async () => {
    const res = await request(app).get('/careers/direct-support-professional');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://workforcenow.adp.com/example"');
  });

  it('hides draft jobs', async () => {
    expect((await request(app).get('/careers/secret-draft-role')).status).toBe(404);
  });
});

describe('announcements', () => {
  beforeEach(() => db('announcements').del());

  it('shows only current public announcements on the home page', async () => {
    const day = 24 * 60 * 60 * 1000;
    await db('announcements').insert([
      { title: 'Office closed Monday', body: 'Holiday.', audience: 'public', starts_at: new Date(Date.now() - day) },
      { title: 'Staff meeting', body: 'Internal.', audience: 'internal', starts_at: new Date(Date.now() - day) },
      {
        title: 'Old news',
        body: 'Expired.',
        audience: 'both',
        starts_at: new Date(Date.now() - 3 * day),
        ends_at: new Date(Date.now() - day),
      },
      { title: 'Future news', body: 'Not yet.', audience: 'public', starts_at: new Date(Date.now() + day) },
    ]);
    const res = await request(app).get('/');
    expect(res.text).toContain('Office closed Monday');
    expect(res.text).not.toContain('Staff meeting');
    expect(res.text).not.toContain('Old news');
    expect(res.text).not.toContain('Future news');
  });
});

describe('legal pages', () => {
  it.each([
    ['/privacy', 'Privacy Policy', 'do not sell'],
    ['/terms', 'Terms and Conditions', 'call 911'],
    ['/data-protection', 'Data Protection', 'audit log'],
    ['/cookies', 'Cookie Policy', 'hlo.sid'],
  ])('%s renders', async (path, title, text) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain(title);
    expect(res.text).toContain(text);
  });

  it('the cookie policy lists the session cookie the app actually sets', async () => {
    // A form page is where a visitor first gets a cookie (for its CSRF token).
    const res = await request(app).get('/contact');
    const names = (res.headers['set-cookie'] || []).map((c) => c.split('=')[0]);
    expect(names).toEqual(['hlo.sid']);
  });

  it('footer links to every legal page and credits GiddyHost', async () => {
    const res = await request(app).get('/');
    for (const path of ['/terms', '/privacy', '/data-protection', '/cookies']) {
      expect(res.text).toContain(`href="${path}"`);
    }
    expect(res.text).toMatch(/Powered by <a href="https:\/\/giddyhost\.com"/);
  });

  it('includes legal pages in the sitemap', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('/privacy</loc>');
    expect(res.text).toContain('/cookies</loc>');
  });
});

describe('dates', () => {
  it('shows calendar dates without a time-zone shift', async () => {
    const res = await request(app).get('/privacy');
    expect(res.text).toContain('October 10, 2026');
  });
});

describe('services help', () => {
  it('guides visitors who are unsure which service fits', async () => {
    const res = await request(app).get('/services');
    expect(res.text).toContain('Not sure which service fits?');
    expect(res.text).toContain('href="/getting-started#compare"');
    expect(res.text).toContain('href="/contact?to=intake"');
    // Every quick-guide entry resolves to a real service.
    expect(res.text.match(/May suit: [A-Z]/g)).toHaveLength(6);
  });
});

describe('getting started comparison', () => {
  it('tags every service so the "where" filter can find it', async () => {
    const res = await request(app).get('/getting-started');
    const rows = [...res.text.matchAll(/<tr data-where="([a-z -]+)"/g)].map((m) => m[1]);
    expect(rows).toHaveLength(6);
    for (const key of ['home', 'shared-home', 'community']) {
      expect(res.text).toContain(`data-filter="${key}"`);
      expect(rows.some((w) => w.split(' ').includes(key))).toBe(true);
    }
  });

  it('keeps filter controls hidden until JavaScript enables them', async () => {
    const res = await request(app).get('/getting-started');
    expect(res.text).toMatch(/data-filter-controls hidden/);
  });
});

describe('referrals', () => {
  beforeEach(() => db('contact_messages').del());

  const valid = {
    referrer_name: 'Casey Coordinator',
    organization: 'Example Coordination Agency',
    referrer_role: 'ccs',
    referrer_phone: '410-555-0123',
    referrer_email: 'casey@agency.example',
    person_name: 'J.E.',
    county: 'Howard County',
    living_situation: 'family_home',
    dda_eligibility: 'eligible',
    priority_category: 'cp',
    pcp: 'in_progress',
    services: ['personal-supports', 'respite-care'],
    timeline: '30_days',
    notes: 'Best reached in the afternoon.',
    consent: 'yes',
  };

  it('renders the referral form with HLO’s questions', async () => {
    const res = await request(app).get('/referrals');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Send a referral');
    for (const q of ['DDA eligibility', 'DDA funding priority (CR / CP)', 'Person-Centered Plan (PCP)', 'How soon is support needed?', 'Current living situation']) {
      expect(res.text).toContain(q);
    }
    expect(res.text).toContain('Please do not include Social Security numbers');
  });

  it('saves a referral to the intake inbox with its details', async () => {
    const { agent, csrf } = await formAgent(app, '/referrals');
    const res = await agent.post('/referrals').type('form').send({ ...valid, _csrf: csrf });
    expect(res.status).toBe(303);

    const [row] = await db('contact_messages');
    expect(row).toMatchObject({ type: 'referral', recipient: 'intake', email: 'casey@agency.example', email_status: 'sent' });
    expect(JSON.parse(row.details)).toMatchObject({
      person_name: 'J.E.',
      county: 'Howard County',
      dda_eligibility: 'eligible',
      priority_category: 'cp',
      pcp: 'in_progress',
      timeline: '30_days',
      services: ['personal-supports', 'respite-care'],
    });
  });

  it('accepts a single ticked service', async () => {
    const { agent, csrf } = await formAgent(app, '/referrals');
    await agent.post('/referrals').type('form').send({ ...valid, services: 'supported-living', _csrf: csrf });
    const [row] = await db('contact_messages');
    expect(JSON.parse(row.details).services).toEqual(['supported-living']);
  });

  it('requires consent and the key details', async () => {
    const { agent, csrf } = await formAgent(app, '/referrals');
    const res = await agent
      .post('/referrals')
      .type('form')
      .send({ ...valid, consent: '', person_name: '', county: '', _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Please confirm you are authorized to share this information');
    expect(res.text).toContain('Enter the person’s first name or initials');
    expect(res.text).toContain('Choose the county where the person lives');
    // What was typed is kept, including ticked services.
    expect(res.text).toMatch(/value="respite-care" class="[^"]*" checked/);
    expect(await db('contact_messages')).toHaveLength(0);
  });

  it('rejects services HLO does not offer through the website', async () => {
    const { agent, csrf } = await formAgent(app, '/referrals');
    const res = await agent.post('/referrals').type('form').send({ ...valid, services: ['nursing'], _csrf: csrf });
    expect(res.status).toBe(422);
  });
});

describe('content from the current site', () => {
  it('lists every condition HLO supports on the Services page', async () => {
    const res = await request(app).get('/services');
    for (const c of ['Cerebral Palsy', 'Muscular Dystrophy', 'Multiple Sclerosis', 'Cystic Fibrosis', 'Spinal Cord Injury',
      'Orthopedic Impairment', 'Behavioral Problems', 'Other undetermined disabilities', 'Intellectual disabilities', 'Autism']) {
      expect(res.text).toContain(c);
    }
  });

  it('shows the pledge and approach on the Services page', async () => {
    const res = await request(app).get('/services');
    expect(res.text).toContain('We pledge to support adults with intellectual disabilities');
    expect(res.text).toContain('self-determination');
  });
});

describe('job detail page', () => {
  beforeEach(async () => {
    await db('jobs').del();
    await db('jobs').insert({
      title: 'Direct Support Professional (DSP)',
      slug: 'dsp-test',
      department: 'Residential & Community Services',
      location: 'Catonsville, MD',
      employment_type: 'Full-time',
      pay_range: '$17.00 – $19.00 per hour',
      description: 'Intro paragraph.\n\nWhat you will do:\n- Support daily living skills\n- <script>alert(1)</script>',
      requirements: '- High school diploma or GED',
      benefits: '- Paid training',
      apply_url: 'https://workforcenow.adp.com/example',
      status: 'published',
      published_at: new Date(),
    });
  });

  it('shows pay range and benefits (Maryland wage range transparency)', async () => {
    const res = await request(app).get('/careers/dsp-test');
    expect(res.text).toContain('$17.00 – $19.00 per hour');
    expect(res.text).toContain('Pay and benefits');
    expect(res.text).toContain('<li>Paid training</li>');
  });

  it('turns "- " lines into a list and escapes any HTML', async () => {
    const res = await request(app).get('/careers/dsp-test');
    expect(res.text).toContain('<ul><li>Support daily living skills</li>');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('publishes valid JobPosting structured data for Google', async () => {
    const res = await request(app).get('/careers/dsp-test');
    const json = res.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
    // "<" is escaped so job text can never close the script tag.
    expect(json).not.toMatch(/<\/script/i);
    const data = JSON.parse(json);
    expect(data).toMatchObject({
      '@type': 'JobPosting',
      title: 'Direct Support Professional (DSP)',
      employmentType: 'FULL_TIME',
      directApply: false,
      baseSalary: { currency: 'USD', value: { minValue: 17, maxValue: 19, unitText: 'HOUR' } },
    });
    expect(data.jobLocation.address.addressRegion).toBe('MD');
  });

  it('keeps the careers list compact (no full descriptions)', async () => {
    const res = await request(app).get('/careers');
    expect(res.text).toContain('Direct Support Professional (DSP)');
    expect(res.text).not.toContain('Support daily living skills');
  });
});

describe('careers search and pagination', () => {
  beforeEach(async () => {
    await db('jobs').del();
    const rows = [];
    for (let i = 1; i <= 23; i++) {
      rows.push({
        title: i % 2 ? `Direct Support Professional ${i}` : `House Manager ${i}`,
        slug: `job-${i}`,
        department: i % 2 ? 'Residential' : 'Programs',
        location: i % 3 ? 'Howard County, MD' : 'Charles County, MD',
        employment_type: i % 4 ? 'Full-time' : 'Part-time',
        description: i === 7 ? 'Includes 50% travel.' : 'Support adults in the community.',
        apply_url: 'https://workforcenow.adp.com/example',
        status: 'published',
        // Newest first: job-23 is the most recent.
        published_at: new Date(Date.UTC(2026, 8, i)),
      });
    }
    rows.push({ ...rows[0], slug: 'draft-job', title: 'Hidden Draft', status: 'draft' });
    await db('jobs').insert(rows);
  });

  const titles = (html) => [...html.matchAll(/<a href="\/careers\/(job-\d+)"/g)].map((m) => m[1]);

  it('shows 10 roles per page, newest first, with a count', async () => {
    const res = await request(app).get('/careers');
    expect(titles(res.text)).toHaveLength(10);
    expect(titles(res.text)[0]).toBe('job-23');
    expect(res.text).toMatch(/Showing <strong class="text-ink">1–10<\/strong> of <strong class="text-ink">23<\/strong>/);
    expect(res.text).not.toContain('Hidden Draft');
  });

  it('pages through the results', async () => {
    const page3 = await request(app).get('/careers?page=3');
    expect(titles(page3.text)).toEqual(['job-3', 'job-2', 'job-1']);
    expect(page3.text).toContain('aria-current="page" class="grid size-11');
    expect(page3.text).toContain('rel="prev"');
    expect(page3.text).not.toContain('rel="next"');
  });

  it('treats an out-of-range or bad page number safely', async () => {
    expect(titles((await request(app).get('/careers?page=99')).text)).toEqual(['job-3', 'job-2', 'job-1']);
    expect(titles((await request(app).get('/careers?page=abc')).text)[0]).toBe('job-23');
  });

  it('searches by keyword', async () => {
    const res = await request(app).get('/careers?q=house+manager');
    const found = titles(res.text);
    expect(found).toHaveLength(10); // 11 matches, first page
    expect(res.text).toContain('of <strong class="text-ink">11</strong>');
    expect(res.text).toContain('matching your search');
  });

  it('treats % and _ in a search as plain text', async () => {
    expect(titles((await request(app).get('/careers?q=50%25')).text)).toEqual(['job-7']);
    expect(titles((await request(app).get('/careers?q=_')).text)).toEqual([]);
  });

  it('filters by schedule, location and department together', async () => {
    const res = await request(app).get('/careers?type=Part-time&location=Charles+County%2C+MD&department=Programs');
    // Part-time = multiples of 4; Charles = multiples of 3; Programs = even -> 12
    expect(titles(res.text)).toEqual(['job-12']);
  });

  it('ignores filter values that do not exist', async () => {
    const res = await request(app).get('/careers?type=Astronaut');
    expect(res.text).toContain('of <strong class="text-ink">23</strong>');
  });

  it('keeps the search in pagination links', async () => {
    const res = await request(app).get('/careers?q=house');
    expect(res.text).toContain('href="/careers?q=house&amp;page=2#positions"');
  });

  it('offers to clear a search that finds nothing', async () => {
    const res = await request(app).get('/careers?q=astronaut');
    expect(res.text).toContain('No roles match your search');
    expect(res.text).toContain('Clear search');
  });

  it('builds filter dropdowns from published jobs only', async () => {
    const res = await request(app).get('/careers');
    expect(res.text).toContain('<option value="Charles County, MD"');
    expect(res.text).toContain('<option value="Part-time"');
  });
});

describe('careers live search', () => {
  beforeEach(async () => {
    await db('jobs').del();
    await db('jobs').insert([
      { title: 'Direct Support Professional (DSP)', slug: 'dsp-1', description: 'x', apply_url: 'https://workforcenow.adp.com/x', status: 'published', published_at: new Date() },
      { title: 'House Manager', slug: 'hm-1', description: 'x', apply_url: 'https://workforcenow.adp.com/x', status: 'published', published_at: new Date() },
    ]);
  });

  it('returns only the results block for ?partial=1', async () => {
    const res = await request(app).get('/careers?q=dsp&partial=1');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<html');
    expect(res.text).not.toContain('Why work at HLO');
    expect(res.text).toContain('data-results-count');
    expect(res.headers['x-robots-tag']).toBe('noindex');
  });

  it('highlights the search term in matching titles', async () => {
    const res = await request(app).get('/careers?q=dsp&partial=1');
    expect(res.text).toContain('(<mark class="rounded bg-accent-100 px-0.5 text-inherit">DSP</mark>)');
    expect(res.text).not.toContain('House Manager');
  });

  it('never lets a search term inject HTML through highlighting', async () => {
    const res = await request(app).get('/careers?q=%3Cimg%20src%3Dx%3E&partial=1');
    expect(res.text).not.toContain('<img src=x>');
  });

  it('keeps ?partial out of pagination links', async () => {
    const res = await request(app).get('/careers?partial=1');
    expect(res.text).not.toContain('partial=1');
  });
});

describe('careers search relevance', () => {
  it('lists title matches before description-only matches', async () => {
    await db('jobs').del();
    await db('jobs').insert([
      { title: 'House Manager', slug: 'newest', description: 'Show respite families respect.', apply_url: 'https://workforcenow.adp.com/x', status: 'published', published_at: new Date() },
      { title: 'Respite Care Worker', slug: 'older', description: 'x', apply_url: 'https://workforcenow.adp.com/x', status: 'published', published_at: new Date(Date.now() - 86400000) },
    ]);
    const res = await request(app).get('/careers?q=respite&partial=1');
    const order = [...res.text.matchAll(/<a href="\/careers\/(newest|older)"/g)].map((m) => m[1]);
    expect(order).toEqual(['older', 'newest']);
  });
});

describe('contact page', () => {
  it('does not load Google Maps until the visitor asks', async () => {
    const res = await request(app).get('/contact');
    expect(res.text).not.toMatch(/<iframe/);
    expect(res.text).toContain('data-map-src="https://www.google.com/maps?q=4%20E%20Rolling%20Crossroads%2C%20Catonsville%2C%20MD%2C%2021228&amp;output=embed"');
    expect(res.headers['content-security-policy']).toContain('frame-src \'self\' https://www.google.com');
  });

  it('shows an office open/closed status', async () => {
    const res = await request(app).get('/contact');
    expect(res.text).toMatch(/(Open now · until 5 p\.m\.|Closed · opens)/);
  });

  it('explains each recipient so visitors can choose', async () => {
    const res = await request(app).get('/contact');
    expect(res.text).toContain('Starting services with HLO and referrals.');
    expect(res.text).toContain('href="/contact?to=intake#contact-form" data-set-recipient="intake"');
  });

  it('mentions the optional map in the Cookie Policy', async () => {
    const res = await request(app).get('/cookies');
    expect(res.text).toContain('The map loads only if you select “Show map”');
  });
});

describe('main menu', () => {
  const current = (html) => [...html.matchAll(/<a href="([^"]+)"[^>]*\n?\s*aria-current="page">/g)].map((m) => m[1]);

  it('has a Home link', async () => {
    const res = await request(app).get('/about');
    expect(res.text).toMatch(/<a href="\/"[^>]*>Home<\/a>/);
  });

  it('marks only the current page, in both desktop and mobile menus', async () => {
    expect(current((await request(app).get('/')).text)).toEqual(['/', '/']);
    expect(current((await request(app).get('/services/respite-care')).text)).toEqual(['/services', '/services']);
  });
});

describe('request services', () => {
  beforeEach(() => db('contact_messages').del());

  const valid = {
    first_name: 'Robin',
    last_name: 'Example',
    phone: '410-555-0144',
    email: 'robin@example.com',
    preferred_contact: 'email',
    best_time: 'morning',
    relationship: 'family',
    individual_first_name: 'Sam',
    county: 'Baltimore County',
    dda_eligibility: 'in_progress',
    pcp: 'not_sure',
    priority_category: '',
    services: ['community-residential-services', 'employment-services'],
    message: 'Looking at options for next year.',
    consent: 'yes',
  };

  it('saves a request to the intake inbox and acknowledges it', async () => {
    const { agent, csrf } = await formAgent(app, '/request-services');
    const res = await agent.post('/request-services').type('form').send({ ...valid, _csrf: csrf });
    expect(res.status).toBe(303);
    const [row] = await db('contact_messages');
    expect(row).toMatchObject({ type: 'request', recipient: 'intake', name: 'Robin Example', email: 'robin@example.com', phone: '410-555-0144', email_status: 'sent' });
    expect(JSON.parse(row.details)).toMatchObject({ relationship: 'family', individual_first_name: 'Sam', county: 'Baltimore County', services: ['community-residential-services', 'employment-services'] });
    const page = await agent.get('/request-services');
    expect(page.text).toContain('Thank you, Robin');
  });

  it('requires the essentials and keeps what was typed', async () => {
    const { agent, csrf } = await formAgent(app, '/request-services');
    const res = await agent.post('/request-services').type('form').send({ ...valid, last_name: '', relationship: '', consent: '', _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Choose your relationship to the person');
    expect(res.text).toContain('Please confirm the information is correct');
    expect(res.text).toContain('value="Robin"');
    expect(await db('contact_messages')).toHaveLength(0);
  });

  it('is linked from the header and the home page', async () => {
    const home = await request(app).get('/');
    expect(home.text).toContain('href="/request-services"');
    expect(home.text).toContain('href="/referrals"');
  });
});
