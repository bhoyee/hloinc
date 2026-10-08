'use strict';

const express = require('express');
const siteContent = require('../../services/siteContent');
const { audit } = require('../../services/audit');
const { setFlash } = require('../../lib/forms');
const { formatHour } = require('../../lib/hours');
const site = require('../../lib/site');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const contentCrumbs = [...crumbs, { label: 'Site content', href: '/portal/content' }];

const forbidden = () => Object.assign(new Error('Your role doesn’t include access to this page.'), { status: 403 });

router.get('/', async (req, res) => {
  const sections = siteContent.sectionsFor(req.user).map((s) => ({ ...s, editable: siteContent.canEdit(req.user, s) }));
  res.render('pages/portal/content/index.njk', {
    title: 'Site content',
    subheading: 'Change the website’s text and contact details. Changes go live straight away.',
    crumbs,
    sections,
    lastChanged: await siteContent.lastChanged(),
  });
});

router.param('section', (req, res, next, key) => {
  const section = siteContent.find(key);
  if (!section || !siteContent.sectionsFor(req.user).includes(section)) {
    const err = new Error('That page doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  req.section = section;
  next();
});

function hourOptions() {
  return Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: h === 24 ? 'Midnight' : h === 0 ? 'Midnight' : h === 12 ? 'Noon' : formatHour(h) }));
}

async function renderEdit(req, res, { values, errors = {}, status = 200 } = {}) {
  const s = req.section;
  res.status(status).render('pages/portal/content/edit.njk', {
    title: s.label,
    subheading: s.description,
    crumbs: contentCrumbs,
    section: s,
    editable: siteContent.canEdit(req.user, s),
    fields: siteContent.PAGE_FIELDS[s.key] || [],
    values: values || (await siteContent.current(s)),
    errors,
    customised: s.page ? Object.keys(await siteContent.savedPage(s.key)).length > 0 : false,
    dayNames: siteContent.DAY_NAMES,
    hours: hourOptions(),
    recipients: site.recipients,
    mainEmail: (await require('../../services/content').getBusiness()).email,
  });
}

router.get('/:section', (req, res) => renderEdit(req, res));

router.post('/:section', async (req, res) => {
  const s = req.section;
  if (!siteContent.canEdit(req.user, s)) throw forbidden();
  const { data, errors } = siteContent.read(s, req.body);
  if (Object.keys(errors).length) {
    // Re-show what they typed (lists and groups need their original shape).
    const values = s.page ? { ...(await siteContent.current(s)), ...data } : { ...data, days: (data.days || []).map(String), open: String(req.body.open || ''), close: String(req.body.close || '') };
    return renderEdit(req, res, { values, errors, status: 422 });
  }
  const { changed, before, after } = await siteContent.save(s, data, req.user);
  if (changed.length) {
    await audit(req, {
      action: 'content.update',
      entityType: 'site_content',
      entityId: s.key,
      summary: `${req.user.name} updated ${s.label.toLowerCase()} (${changed.length} ${changed.length === 1 ? 'change' : 'changes'})`,
      metadata: { changed, before, after },
    });
    setFlash(req, 'success', `${s.label} saved. The website shows the changes now.`);
  } else {
    setFlash(req, 'info', 'Nothing changed.');
  }
  res.redirect(303, `/portal/content/${s.key}`);
});

router.post('/:section/reset', async (req, res) => {
  const s = req.section;
  if (!s.page || !siteContent.canEdit(req.user, s)) throw forbidden();
  await siteContent.reset(s);
  await audit(req, { action: 'content.reset', entityType: 'site_content', entityId: s.key, summary: `${req.user.name} put the ${s.label.toLowerCase()} back to its original text` });
  setFlash(req, 'success', `${s.label} is back to its original text.`);
  res.redirect(303, `/portal/content/${s.key}`);
});

module.exports = router;
