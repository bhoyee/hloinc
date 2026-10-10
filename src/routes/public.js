'use strict';

const express = require('express');
const db = require('../db/knex');
const config = require('../config');
const content = require('../services/content');
const jobs = require('../services/jobs');
const announcements = require('../services/announcements');
const inquiries = require('../services/inquiries');
const services = require('../content/services');
const areas = require('../content/areas');
const resources = require('../content/resources');
const legal = require('../content/legal');
const { recipients } = require('../lib/site');
const {
  contactSchema,
  appointmentSchema,
  referralSchema,
  requestSchema,
  OPTIONS,
  REFERRER_ROLES,
  COUNTIES,
  todayInMaryland,
  addDays,
} = require('../validation/public');
const { fieldErrors, setFlash } = require('../lib/forms');
const spam = require('../lib/spam');
const { verifyTurnstile } = require('../lib/turnstile');
const { officeStatus } = require('../lib/hours');
const { limiters } = require('../middleware/security');
const cms = require('../services/cms');

/** Page title and description: editable in the page editor's "Page settings". */
function meta(doc, title, description) {
  return {
    title: cms.helpers.plain(`${doc}.meta.title`, title, 'Page title (browser tab and search results)'),
    description: cms.helpers.plain(`${doc}.meta.description`, description, 'Page description (shown in search results)'),
  };
}

const router = express.Router();

router.get('/', async (req, res) => {
  const [page, news] = await Promise.all([content.getPage('home'), announcements.activePublic()]);
  res.render('pages/public/home.njk', {
    ...meta('home', 'Supporting People with Developmental Disabilities in Maryland', 'Maryland DDA provider offering residential, supported living, personal support, community development, respite and employment services for adults with developmental disabilities. Request services or make a referral.'),
    page,
    services,
    conditions: services.CONDITIONS,
    areas,
    announcements: news,
  });
});

router.get('/about', async (req, res) => {
  const page = await content.getPage('about');
  res.render('pages/public/about.njk', { ...meta('about', 'About us', 'Healthy Living Option Inc. is a Maryland DDA provider supporting adults with developmental disabilities to live independent lives, with community inclusion as a choice.'), page, areas });
});

router.get('/services', async (req, res) => {
  const about = await content.getPage('about');
  res.render('pages/public/services.njk', {
    page: await content.getPage('services'),
    supportNeeds: about.supportNeeds,
    eligibilityNote: about.eligibilityNote,
    ...meta('services', 'Services', 'Community-based supports for adults with intellectual and developmental disabilities in Maryland.'),
    services,
    conditions: services.CONDITIONS,
    serviceBySlug: Object.fromEntries(services.map((s) => [s.slug, s])),
  });
});

router.get('/services/:slug', (req, res, next) => {
  const service = services.find((s) => s.slug === req.params.slug);
  if (!service) return next();
  res.render('pages/public/service.njk', {
    ...meta(`service-${service.slug}`, service.name, service.summary),
    service,
    others: services.filter((s) => s !== service),
  });
});

router.get('/service-areas', (req, res) => {
  res.render('pages/public/service-areas.njk', {
    ...meta('service-areas', 'Service areas', 'HLO serves ten counties across Central and Southern Maryland.'),
    areas,
  });
});

router.get('/getting-started', async (req, res) => {
  const page = await content.getPage('gettingStarted');
  res.render('pages/public/getting-started.njk', {
    ...meta('getting-started', page.title, page.intro),
    page,
    services,
    whereLabels: services.WHERE_LABELS,
  });
});

router.get('/resources', (req, res) => {
  res.render('pages/public/resources.njk', {
    ...meta('resources', 'Resources', 'Independent organizations and Maryland planning resources for people with disabilities and their families.'),
    // Built-in groups; staff can change, add and remove them in the page editor.
    resourceGroups: resources.map((g, i) => ({ id: `group${i + 1}`, title: g.group })),
    resourceItems: Object.fromEntries(resources.map((g, i) => [`group${i + 1}`, g.items.map((r) => ({ name: r.name, href: r.url, description: r.description }))])),
  });
});

/** Page numbers to show: always first, last and the current neighbourhood, with gaps. */
function pageList(current, pages) {
  const wanted = new Set([1, pages, current - 1, current, current + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push(null); // gap
    out.push(p);
  });
  return out;
}

router.get('/careers', async (req, res) => {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const criteria = {
    q: str(req.query.q),
    type: str(req.query.type),
    location: str(req.query.location),
    department: str(req.query.department),
  };
  const options = await jobs.filterOptions();
  const result = await jobs.searchPublished({ ...criteria, page: req.query.page }, options);

  // Links keep the current search; empty values are left out of the URL.
  const pageUrl = (page) => {
    const params = new URLSearchParams(Object.entries({ ...criteria, page: page > 1 ? page : '' }).filter(([, v]) => v));
    const qs = params.toString();
    return `/careers${qs ? `?${qs}` : ''}#positions`;
  };

  // Live search asks for just the results block.
  const view = req.query.partial === '1' ? 'partials/careers-results.njk' : 'pages/public/careers.njk';
  if (req.query.partial === '1') res.set('X-Robots-Tag', 'noindex');
  res.render(view, {
    ...meta('careers', 'Careers', 'Join the HLO team and help adults in Maryland live independent, connected lives.'),
    ...(result.page > 1 ? { title: `Careers – page ${result.page}` } : {}),
    copy: await content.getPage('careers'),
    ...result,
    criteria,
    options,
    filtered: Object.values(criteria).some(Boolean),
    pageLinks: pageList(result.page, result.pages).map((p) => (p ? { page: p, url: pageUrl(p) } : null)),
    prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
    nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
    from: result.total ? (result.page - 1) * result.perPage + 1 : 0,
    to: Math.min(result.page * result.perPage, result.total),
  });
});

router.get('/careers/:slug', async (req, res, next) => {
  const job = await jobs.findPublishedBySlug(req.params.slug);
  if (!job) return next();
  res.render('pages/public/job.njk', {
    title: job.title,
    description: `${job.title} at Healthy Living Option Inc.${job.location ? ` in ${job.location}` : ''}.`,
    job,
    structuredData: jobs.toJobPosting(job, res.locals.site),
  });
});

// --- Spam handling shared by the public forms ---------------------------------
// Order in each handler: bot signals -> validation -> human checks -> save.

const CAPTCHA_ERROR = 'Please complete the security check, then send the form again.';
const LIMIT_ERROR =
  'We have already received several submissions from this email address today. To reach us sooner, please call us.';

/** Pretend it worked, so bots learn nothing. */
function dropQuietly(req, res, path, message) {
  setFlash(req, 'success', message);
  res.redirect(303, path);
}

/** Turnstile (if enabled) and repeat checks. Returns null, 'duplicate', or field errors to show. */
async function humanCheck(req, form, email, data) {
  if (!(await verifyTurnstile(req))) return { captcha: CAPTCHA_ERROR };
  const repeat = spam.repeatCheck(form, email, data);
  if (repeat === 'duplicate') return 'duplicate';
  if (repeat === 'limit') return { limit: LIMIT_ERROR };
  return null;
}

// --- Contact ---------------------------------------------------------------

/** Google Maps embed/directions by street address (no coordinates; requirements §3). */
function mapLinks(site) {
  const street = site.address.street.split(',')[0];
  const query = [street, site.address.city, site.address.state, site.address.zip].filter(Boolean).join(', ');
  return {
    mapEmbedUrl: `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`,
  };
}

function renderContact(req, res, { values = {}, errors = {} } = {}) {
  spam.issueForm(req, 'contact');
  res.status(Object.keys(errors).length ? 422 : 200).render('pages/public/contact.njk', {
    ...meta('contact', 'Contact us', 'Call, email, visit or send a message to Healthy Living Option Inc. in Catonsville, Maryland.'),
    recipients,
    office: officeStatus(res.locals.site.schedule),
    ...mapLinks(res.locals.site),
    values: { recipient: req.query.to || 'general', ...values },
    errors,
  });
}

router.get('/contact', (req, res) => renderContact(req, res));

router.post('/contact', limiters.forms, async (req, res) => {
  const sent = 'Thank you. Your message has been sent.';
  if (spam.botCheck(req, 'contact', ['name', 'message'])) return dropQuietly(req, res, '/contact', sent);

  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return renderContact(req, res, { values: req.body, errors: fieldErrors(parsed.error) });

  const blocked = await humanCheck(req, 'contact', parsed.data.email, parsed.data);
  if (blocked === 'duplicate') return dropQuietly(req, res, '/contact', sent);
  if (blocked) return renderContact(req, res, { values: req.body, errors: blocked });

  const result = await inquiries.submitContact(parsed.data, { ip: req.ip });
  setFlash(
    req,
    'success',
    result.emailed
      ? 'Thank you. Your message has been sent and our team will reply as soon as possible.'
      : 'Thank you. Your message was saved and our team will see it, but our email notification did not go through. If your message is urgent, please call us.'
  );
  res.redirect(303, '/contact');
});

// --- Referrals (requirements §6.2) ---------------------------------------------

function renderReferral(req, res, { values = {}, errors = {} } = {}) {
  spam.issueForm(req, 'referral');
  const selected = [].concat(values.services || []);
  res.status(Object.keys(errors).length ? 422 : 200).render('pages/public/referral.njk', {
    ...meta('referrals', 'Send a referral', 'Refer someone to Healthy Living Option Inc. for community-based supports in Maryland.'),
    roles: REFERRER_ROLES,
    options: OPTIONS,
    counties: COUNTIES,
    services,
    values: { ...values, services: selected },
    errors,
  });
}

router.get('/referrals', (req, res) => renderReferral(req, res));

router.post('/referrals', limiters.forms, async (req, res) => {
  const sent = 'Thank you. Your referral has been sent.';
  if (spam.botCheck(req, 'referral', ['referrer_name', 'organization', 'person_name', 'notes'])) {
    return dropQuietly(req, res, '/referrals', sent);
  }

  const parsed = referralSchema.safeParse(req.body);
  if (!parsed.success) return renderReferral(req, res, { values: req.body, errors: fieldErrors(parsed.error) });

  const blocked = await humanCheck(req, 'referral', parsed.data.referrer_email, parsed.data);
  if (blocked === 'duplicate') return dropQuietly(req, res, '/referrals', sent);
  if (blocked) return renderReferral(req, res, { values: req.body, errors: blocked });

  const result = await inquiries.submitReferral(parsed.data, { ip: req.ip });
  setFlash(
    req,
    'success',
    result.emailed
      ? 'Thank you. Your referral has been sent to our intake team, who will be in touch.'
      : 'Thank you. Your referral was saved and our intake team will see it, but our email notification did not go through. If it is urgent, please call us.'
  );
  res.redirect(303, '/referrals');
});

// --- Request services (individuals and families; HLO's form) ------------------

function renderRequest(req, res, { values = {}, errors = {} } = {}) {
  spam.issueForm(req, 'request');
  res.status(Object.keys(errors).length ? 422 : 200).render('pages/public/request-services.njk', {
    ...meta('request-services', 'Request services', 'Request services from Healthy Living Option Inc. for yourself or a loved one. Our team will reach out to talk through the options.'),
    options: OPTIONS,
    counties: COUNTIES,
    services,
    values: { preferred_contact: 'phone', ...values, services: [].concat(values.services || []) },
    errors,
  });
}

router.get('/request-services', (req, res) => renderRequest(req, res));

router.post('/request-services', limiters.forms, async (req, res) => {
  const sent = 'Thank you. Your request has been sent.';
  if (spam.botCheck(req, 'request', ['first_name', 'last_name', 'individual_first_name', 'message'])) {
    return dropQuietly(req, res, '/request-services', sent);
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return renderRequest(req, res, { values: req.body, errors: fieldErrors(parsed.error) });

  const blocked = await humanCheck(req, 'request', parsed.data.email, parsed.data);
  if (blocked === 'duplicate') return dropQuietly(req, res, '/request-services', sent);
  if (blocked) return renderRequest(req, res, { values: req.body, errors: blocked });

  const result = await inquiries.submitRequest(parsed.data, { ip: req.ip });
  setFlash(
    req,
    'success',
    result.emailed
      ? `Thank you, ${parsed.data.first_name}. We received your request and a member of our team will be in touch${result.acknowledged ? '. We have emailed you a copy' : ''}.`
      : 'Thank you. Your request was saved and our team will see it, but our email notification did not go through. If it is urgent, please call us.'
  );
  res.redirect(303, '/request-services');
});

// --- Appointment requests ------------------------------------------------------

async function activeTypes() {
  return db('appointment_types').where({ active: true }).orderBy('sort_order').select('id', 'name', 'description');
}

async function renderAppointment(req, res, { values = {}, errors = {} } = {}) {
  spam.issueForm(req, 'appointment');
  const today = todayInMaryland();
  res.status(Object.keys(errors).length ? 422 : 200).render('pages/public/appointment.njk', {
    ...meta('appointment-request', 'Request an appointment', 'Request an appointment with Healthy Living Option Inc. in advance.'),
    types: await activeTypes(),
    minDate: addDays(today, 1),
    maxDate: addDays(today, 90),
    values: { preferred_contact: 'email', ...values },
    errors,
  });
}

router.get('/appointments/request', (req, res) => renderAppointment(req, res));

router.post('/appointments/request', limiters.forms, async (req, res) => {
  const sent = 'Thank you. We received your request.';
  if (spam.botCheck(req, 'appointment', ['name', 'notes'])) return dropQuietly(req, res, '/appointments/request', sent);

  const types = await activeTypes();
  const parsed = appointmentSchema(types.map((t) => t.id)).safeParse(req.body);
  if (!parsed.success) return renderAppointment(req, res, { values: req.body, errors: fieldErrors(parsed.error) });

  const blocked = await humanCheck(req, 'appointment', parsed.data.email, parsed.data);
  if (blocked === 'duplicate') return dropQuietly(req, res, '/appointments/request', sent);
  if (blocked) return renderAppointment(req, res, { values: req.body, errors: blocked });

  const result = await inquiries.submitAppointmentRequest(parsed.data, { ip: req.ip });
  setFlash(
    req,
    'success',
    result.acknowledged
      ? 'Thank you. We received your request and sent a copy to your email. This is not yet confirmed: our team will contact you to confirm a time.'
      : 'Thank you. We received your request, but we could not send you a confirmation email. Our team will contact you to confirm a time.'
  );
  res.redirect(303, '/appointments/request');
});

// --- Legal pages ---------------------------------------------------------

const legalLinks = Object.values(legal).map(({ slug, title }) => ({ slug, title }));

router.get(['/privacy', '/terms', '/data-protection', '/cookies'], (req, res) => {
  const features = { turnstile: config.turnstile.enabled };
  const page = legal[req.path.slice(1)];
  // Built-in sections, as editable items: paragraphs and "- " bullet lines in one text.
  // Tables (the cookie list) stay in code; sections that depend on a feature carry `onlyIf`.
  const sections = page.sections.map((s) => ({
    id: s.id,
    heading: s.heading,
    body: [...(s.paragraphs || []), ...(s.list ? [s.list.map((l) => `- ${l}`).join('\n')] : [])].join('\n\n'),
    ...(s.onlyIf ? { onlyIf: s.onlyIf } : {}),
  }));
  const tables = Object.fromEntries(page.sections.filter((s) => s.table).map((s) => [s.id, s.table]));
  res.render('pages/public/legal.njk', { ...meta(page.slug, page.title, page.summary), doc: page, sections, tables, features, legalLinks });
});

// --- SEO -----------------------------------------------------------------

router.get('/robots.txt', (req, res) => {
  if (config.noindex) return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  res.type('text/plain').send(`User-agent: *\nDisallow: /portal\n\nSitemap: ${config.appUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', async (req, res) => {
  const paths = [
    '/',
    '/about',
    '/services',
    ...services.map((s) => `/services/${s.slug}`),
    '/service-areas',
    '/getting-started',
    '/resources',
    '/request-services',
    '/careers',
    ...(await jobs.listPublished()).map((j) => `/careers/${j.slug}`),
    '/contact',
    '/referrals',
    '/appointments/request',
    ...legalLinks.map((l) => `/${l.slug}`),
  ];
  const urls = paths.map((p) => `  <url><loc>${config.appUrl}${p}</loc></url>`).join('\n');
  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// Liveness check for the host / uptime monitor. Database health is checked
// separately so a DB outage doesn't hide that the app itself is up.
router.get('/healthz', (req, res) => {
  // Which version is running (written by the deploy scripts), to confirm automatic updates.
  let version = null;
  try {
    version = require('fs').readFileSync(require('path').join(config.paths.root, 'tmp/deployed-commit'), 'utf8').trim().slice(0, 7) || null;
  } catch {
    version = null;
  }
  res.set('Cache-Control', 'no-store').json({ status: 'ok', version });
});

router.get('/healthz/db', async (req, res) => {
  try {
    await db.raw('select 1');
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  } catch {
    res.status(503).set('Cache-Control', 'no-store').json({ status: 'unavailable' });
  }
});

module.exports = router;
