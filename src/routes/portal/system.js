'use strict';

const express = require('express');
const health = require('../../services/health');
const { audit } = require('../../services/audit');
const { can } = require('../../auth/permissions');
const { setFlash } = require('../../lib/forms');

const router = express.Router();

router.get('/', async (req, res) => {
  res.render('pages/portal/system/index.njk', {
    title: 'System health',
    subheading: 'Whether email, the virus scanner, backups and storage are working. Checked every 15 minutes; IT is told when something breaks.',
    crumbs: [{ label: 'Dashboard', href: '/portal' }],
    s: await health.snapshot(),
    mayMaintain: can(req.user, 'system.maintain'),
  });
});

/** Actions need "Run a backup, send a test email and test the virus scanner". */
function maintain(req, res, next) {
  if (can(req.user, 'system.maintain')) return next();
  setFlash(req, 'error', 'You can see system health, but not run these checks.');
  res.redirect(303, '/portal/system');
}

router.post('/backup', maintain, async (req, res) => {
  const result = await health.runBackup();
  await audit(req, { action: 'system.backup', entityType: 'system', entityId: 'backup', summary: `${req.user.name} ran a database backup (${result.ok ? 'saved' : 'failed'})` });
  setFlash(req, result.ok ? 'success' : 'error', result.ok ? result.message : `The backup didn’t work: ${result.message}`);
  res.redirect(303, '/portal/system#backups');
});

router.post('/test-email', maintain, async (req, res) => {
  const result = await health.testEmail(req.user);
  await audit(req, { action: 'system.test_email', entityType: 'system', entityId: 'email', summary: `${req.user.name} sent a test email (${result.ok ? 'sent' : 'failed'})` });
  setFlash(req, result.ok ? 'success' : 'error', result.ok ? `Test email sent to ${req.user.email}. Check your inbox (and spam folder).` : `The test email couldn’t be sent: ${result.error}`);
  res.redirect(303, '/portal/system#email');
});

router.post('/test-scanner', maintain, async (req, res) => {
  const result = await health.testScanner();
  await audit(req, { action: 'system.test_scanner', entityType: 'system', entityId: 'scanner', summary: `${req.user.name} tested the virus scanner (${result.status})` });
  setFlash(req, result.status === 'clean' ? 'success' : 'error', result.status === 'clean' ? `The virus scanner is working (${result.engine}).` : `The virus scanner didn’t work: ${result.detail || result.status}`);
  res.redirect(303, '/portal/system#scanner');
});

module.exports = router;
