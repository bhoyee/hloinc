'use strict';

const express = require('express');
const multer = require('multer');
const siteContent = require('../../services/siteContent');
const cms = require('../../services/cms');
const media = require('../../services/media');
const { audit } = require('../../services/audit');
const { setFlash } = require('../../lib/forms');
const { formatHour } = require('../../lib/hours');
const { can } = require('../../auth/permissions');
const site = require('../../lib/site');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const contentCrumbs = [...crumbs, { label: 'Site content', href: '/portal/content' }];

const forbidden = () => Object.assign(new Error('Your role doesn’t include access to this page.'), { status: 403 });
const canEditAny = (user) => can(user, 'site_content.edit') || can(user, 'site_content.edit_limited');

// --- Overview ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const pages = cms.pagesFor(req.user);
  const groups = [];
  for (const p of pages) {
    let g = groups.find((x) => x.label === p.group);
    if (!g) groups.push((g = { label: p.group, pages: [] }));
    g.pages.push(p);
  }
  const settings = siteContent.sectionsFor(req.user).map((s) => ({ ...s, editable: siteContent.canEdit(req.user, s) }));
  res.render('pages/portal/content/index.njk', {
    title: 'Site content',
    subheading: 'Edit the website’s pages visually, plus contact details and office hours.',
    crumbs,
    groups,
    settings,
    status: await cms.status(),
    lastChanged: await siteContent.lastChanged(),
  });
});

// --- Visual page editor -------------------------------------------------------------------

router.param('page', (req, res, next, key) => {
  const page = cms.findPage(key);
  if (!page || !cms.pagesFor(req.user).some((p) => p.key === key)) {
    const err = new Error('That page doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  req.page = page;
  next();
});

router.get('/pages/:page', async (req, res) => {
  const p = req.page;
  res.render('pages/portal/content/editor.njk', {
    title: `Edit: ${p.label}`,
    page: p,
    pages: cms.pagesFor(req.user),
    editable: cms.canEditDoc(req.user, p.key),
    frameUrl: `${p.path}?cms=edit&cms_page=${encodeURIComponent(p.key)}`,
    previewUrl: `${p.path}?cms=preview`,
  });
});

/** Which of these documents (from the page shown in the editor) have unpublished changes. */
router.get('/pages/:page/status', async (req, res) => {
  const docs = String(req.query.docs || '')
    .split(',')
    .filter((d) => cms.findPage(d) || d === cms.SITE_DOC);
  res.json({ pending: await cms.pending(docs.length ? docs : [req.page.key]) });
});

/** Save edits to the draft (JSON from the in-page editor). */
router.post('/pages/:page/draft', async (req, res) => {
  if (!canEditAny(req.user)) throw forbidden();
  const { byDoc, error } = cms.validate(req.body || {}, req.user);
  if (error) return res.status(422).json({ error });
  await cms.saveDraft(byDoc, req.user);
  res.json({ ok: true, docs: Object.keys(byDoc) });
});

const docsFrom = (req) => [].concat(req.body.docs || req.page.key).filter((d) => typeof d === 'string' && (cms.findPage(d) || d === cms.SITE_DOC));

router.post('/pages/:page/publish', async (req, res) => {
  if (!canEditAny(req.user)) throw forbidden();
  const done = await cms.publish([...new Set([req.page.key, ...docsFrom(req)])], req.user);
  if (done.length) {
    const labels = done.map((d) => (d === cms.SITE_DOC ? 'header, footer and shared sections' : cms.findPage(d).label));
    await audit(req, { action: 'content.publish', entityType: 'page', entityId: req.page.key, summary: `${req.user.name} published changes to ${labels.join(', ')}`, metadata: { docs: done } });
  }
  res.json({ ok: true, published: done });
});

router.post('/pages/:page/discard', async (req, res) => {
  if (!canEditAny(req.user)) throw forbidden();
  const done = await cms.discard([...new Set([req.page.key, ...docsFrom(req)])], req.user);
  await audit(req, { action: 'content.discard', entityType: 'page', entityId: req.page.key, summary: `${req.user.name} discarded unpublished changes to the ${req.page.label} page` });
  res.json({ ok: true, discarded: done });
});

router.get('/pages/:page/history', async (req, res) => {
  res.json({ versions: await cms.history(req.page.key) });
});

router.post('/pages/:page/restore', async (req, res) => {
  const id = Number(req.body.revision);
  if (!Number.isInteger(id) || !(await cms.restore(req.page.key, id, req.user))) return res.status(404).json({ error: 'That version doesn’t exist.' });
  await audit(req, { action: 'content.restore', entityType: 'page', entityId: req.page.key, summary: `${req.user.name} restored an earlier version of the ${req.page.label} page (as a draft)` });
  res.json({ ok: true });
});

router.post('/pages/:page/reset', async (req, res) => {
  if (!(await cms.resetToDefault(req.page.key, req.user))) throw forbidden();
  await audit(req, { action: 'content.reset', entityType: 'page', entityId: req.page.key, summary: `${req.user.name} put the ${req.page.label} page back to its original design (as a draft)` });
  res.json({ ok: true });
});

// --- Media library --------------------------------------------------------------------------

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: media.MAX_BYTES, files: 1, fields: 5 } });

router.get('/media', async (req, res) => {
  if (!canEditAny(req.user)) throw forbidden();
  res.json({ items: await media.library() });
});

router.post('/media', (req, res, next) => {
  if (!canEditAny(req.user)) return next(forbidden());
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(422).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That photo is over 10 MB. Please use a smaller one.' : 'The upload didn’t work. Please try again.' });
      const m = await media.save(req.file, { alt: req.body && req.body.alt, user: req.user });
      await audit(req, { action: 'media.upload', entityType: 'media', entityId: m.id, summary: `${req.user.name} uploaded the image “${m.original_name || m.file}”` });
      res.json({ ok: true, item: { id: m.id, kind: 'upload', name: m.original_name || m.file, image: media.toImage(m) } });
    } catch (e) {
      if (e.status === 422) return res.status(422).json({ error: e.message });
      next(e);
    }
  });
});

router.post('/media/:id/delete', async (req, res) => {
  if (!can(req.user, 'site_content.edit')) throw forbidden();
  const m = /^\d+$/.test(req.params.id) ? await require('../../db/knex')('media').where({ id: req.params.id }).first() : null;
  if (!m) return res.status(404).json({ error: 'That image doesn’t exist.' });
  if (await cms.mediaInUse(m.file)) return res.status(409).json({ error: 'This image is used on a page (or a draft). Replace it there first.' });
  await media.remove(m.id);
  await audit(req, { action: 'media.delete', entityType: 'media', entityId: m.id, summary: `${req.user.name} deleted the image “${m.original_name || m.file}”` });
  res.json({ ok: true });
});

// --- Settings forms: contact details, office hours, contact form addresses ----------------------

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
  return Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: h === 24 || h === 0 ? 'Midnight' : h === 12 ? 'Noon' : formatHour(h) }));
}

async function renderEdit(req, res, { values, errors = {}, status = 200 } = {}) {
  const s = req.section;
  res.status(status).render('pages/portal/content/edit.njk', {
    title: s.label,
    subheading: s.description,
    crumbs: contentCrumbs,
    section: s,
    editable: siteContent.canEdit(req.user, s),
    values: values || (await siteContent.current(s)),
    errors,
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
    const values = { ...data, days: (data.days || []).map(String), open: String(req.body.open || ''), close: String(req.body.close || '') };
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

module.exports = router;
