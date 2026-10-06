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
const { recipients } = require('../lib/site');
const { contactSchema, appointmentSchema, todayInMaryland, addDays } = require('../validation/public');
const { fieldErrors, issueForm, looksLikeSpam, setFlash } = require('../lib/forms');
const { limiters } = require('../middleware/security');

const router = express.Router();

router.get('/', async (req, res) => {
  const [page, news] = await Promise.all([content.getPage('home'), announcements.activePublic()]);
  res.render('pages/public/home.njk', {
    title: 'Community supports in Maryland',
    description: page.intro,
    page,
    services,
    areas,
    announcements: news,
  });
});

router.get('/about', async (req, res) => {
  const page = await content.getPage('about');
  res.render('pages/public/about.njk', { title: page.title, description: page.intro, page });
});

router.get('/services', (req, res) => {
  res.render('pages/public/services.njk', {
    title: 'Services',
    description: 'Community-based supports for adults with intellectual and developmental disabilities in Maryland.',
    services,
  });
});

router.get('/services/:slug', (req, res, next) => {
  const service = services.find((s) => s.slug === req.params.slug);
  if (!service) return next();
  res.render('pages/public/service.njk', {
    title: service.name,
    description: service.summary,
    service,
    others: services.filter((s) => s !== service),
  });
});

router.get('/service-areas', (req, res) => {
  res.render('pages/public/service-areas.njk', {
    title: 'Service areas',
    description: 'HLO serves ten counties across Central and Southern Maryland.',
    areas,
  });
});

router.get('/getting-started', async (req, res) => {
  const page = await content.getPage('gettingStarted');
  res.render('pages/public/getting-started.njk', {
    title: page.title,
    description: page.intro,
    page,
    services,
  });
});

router.get('/resources', (req, res) => {
  res.render('pages/public/resources.njk', {
    title: 'Resources',
    description: 'Independent organizations and Maryland planning resources for people with disabilities and their families.',
    resources,
  });
});

router.get('/careers', async (req, res) => {
  res.render('pages/public/careers.njk', {
    title: 'Careers',
    description: 'Join the HLO team and help adults in Maryland live independent, connected lives.',
    jobs: await jobs.listPublished(),
  });
});

router.get('/careers/:slug', async (req, res, next) => {
  const job = await jobs.findPublishedBySlug(req.params.slug);
  if (!job) return next();
  res.render('pages/public/job.njk', { title: job.title, description: `${job.title} at HLO Inc.`, job });
});

// --- Contact ---------------------------------------------------------------

function renderContact(req, res, { values = {}, errors = {} } = {}) {
  issueForm(req, 'contact');
  res.status(Object.keys(errors).length ? 422 : 200).render('pages/public/contact.njk', {
    title: 'Contact us',
    description: 'Call, email, visit or send a message to Healthy Living Option Inc. in Catonsville, Maryland.',
    recipients,
    values: { recipient: req.query.to || 'general', ...values },
    errors,
  });
}

router.get('/contact', (req, res) => renderContact(req, res));

router.post('/contact', limiters.forms, async (req, res) => {
  if (looksLikeSpam(req, 'contact')) {
    // Answer like a success so bots learn nothing.
    setFlash(req, 'success', 'Thank you. Your message has been sent.');
    return res.redirect(303, '/contact');
  }

  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return renderContact(req, res, { values: req.body, errors: fieldErrors(parsed.error) });

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

// --- Appointment requests ------------------------------------------------------

async function activeTypes() {
  return db('appointment_types').where({ active: true }).orderBy('sort_order').select('id', 'name', 'description');
}

async function renderAppointment(req, res, { values = {}, errors = {} } = {}) {
  issueForm(req, 'appointment');
  const today = todayInMaryland();
  res.status(Object.keys(errors).length ? 422 : 200).render('pages/public/appointment.njk', {
    title: 'Request an appointment',
    description: 'Request an appointment with Healthy Living Option Inc. in advance.',
    types: await activeTypes(),
    minDate: addDays(today, 1),
    maxDate: addDays(today, 90),
    values: { preferred_contact: 'email', ...values },
    errors,
  });
}

router.get('/appointments/request', (req, res) => renderAppointment(req, res));

router.post('/appointments/request', limiters.forms, async (req, res) => {
  if (looksLikeSpam(req, 'appointment')) {
    setFlash(req, 'success', 'Thank you. We received your request.');
    return res.redirect(303, '/appointments/request');
  }

  const types = await activeTypes();
  const parsed = appointmentSchema(types.map((t) => t.id)).safeParse(req.body);
  if (!parsed.success) return renderAppointment(req, res, { values: req.body, errors: fieldErrors(parsed.error) });

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

// --- SEO -----------------------------------------------------------------

router.get('/robots.txt', (req, res) => {
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
    '/careers',
    ...(await jobs.listPublished()).map((j) => `/careers/${j.slug}`),
    '/contact',
    '/appointments/request',
  ];
  const urls = paths.map((p) => `  <url><loc>${config.appUrl}${p}</loc></url>`).join('\n');
  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// Liveness check for the host / uptime monitor. Database health is checked
// separately so a DB outage doesn't hide that the app itself is up.
router.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok' });
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
