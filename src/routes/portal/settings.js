'use strict';

const express = require('express');
const db = require('../../db/knex');
const security = require('../../services/security');
const users = require('../../services/users');
const roles = require('../../services/roles');
const notifications = require('../../services/notifications');
const { audit } = require('../../services/audit');
const { setFlash } = require('../../lib/forms');
const { limiters } = require('../../middleware/security');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];

async function render(req, res, { errors = {}, values = {}, status = 200 } = {}) {
  const on = await security.twoStepOn();
  const [linked, active] = await Promise.all([
    db('users').where({ status: 'active', mfa_enabled: true }).count({ n: '*' }).first(),
    db('users').where({ status: 'active' }).count({ n: '*' }).first(),
  ]);
  res.status(status).render('pages/portal/settings/security.njk', {
    title: 'Security settings',
    subheading: 'Portal-wide sign-in rules for every staff account.',
    crumbs,
    on,
    linked: Number(linked.n),
    active: Number(active.n),
    requiredRoles: (await roles.list()).filter((r) => r.require_mfa).map((r) => r.name),
    lastChange: await security.lastChange(),
    errors,
    values,
  });
}

router.get('/security', (req, res) => render(req, res));

router.post('/security', limiters.login, async (req, res) => {
  const want = req.body.two_step === 'on' ? true : req.body.two_step === 'off' ? false : null;
  if (want === null) return render(req, res, { errors: { two_step: 'Choose on or off.' }, status: 422 });
  if (want === (await security.twoStepOn())) {
    setFlash(req, 'info', 'Nothing changed.');
    return res.redirect(303, '/portal/settings/security');
  }
  // A change this important needs the person's password.
  if (!(await users.checkPassword(req.user.id, req.body.password))) {
    return render(req, res, { errors: { password: 'That isn’t your current password.' }, values: { two_step: req.body.two_step }, status: 422 });
  }

  await security.setTwoStep(want, req.user);
  await audit(req, {
    action: want ? 'security.two_step_on' : 'security.two_step_off',
    entityType: 'setting',
    entityId: 'two_step',
    summary: `${req.user.name} switched two-step sign-in ${want ? 'ON' : 'OFF'} for everyone`,
  });
  // Tell everyone else who can change this, so a change is never silent.
  await notifications.notifyPermission('security.edit', {
    type: 'security',
    title: `Two-step sign-in switched ${want ? 'on' : 'off'} for everyone`,
    body: `By ${req.user.name}`,
    link: '/portal/settings/security',
  }, { exceptId: req.user.id });

  setFlash(
    req,
    'success',
    want
      ? 'Two-step sign-in is on. Staff whose role requires it will be asked to set it up when they next use the portal.'
      : 'Two-step sign-in is off. Everyone now signs in with email and password only.'
  );
  res.redirect(303, '/portal/settings/security');
});

module.exports = router;
