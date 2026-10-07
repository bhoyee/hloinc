'use strict';

const express = require('express');
const { loadUser, requireAuth, requireMfaSetup, requirePermission } = require('../../middleware/auth');
const { navFor } = require('../../lib/portalNav');

const router = express.Router();

// Keep the staff portal out of search engines and out of browser/proxy caches.
router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  next();
});

router.use(loadUser);
router.use((req, res, next) => {
  res.locals.currentPath = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/portal';
  res.locals.portalNav = req.user ? navFor(res.locals.can, res.locals.currentPath) : [];
  next();
});

// Sign-in, password reset and invitations: reachable without signing in.
router.use(require('./auth'));

// Everything below needs a signed-in user who has finished any required set-up.
router.use(requireAuth);
router.use(requireMfaSetup);

// Unread count for the bell in the header.
router.use(async (req, res, next) => {
  res.locals.unreadCount = await require('../../services/notifications').unreadCount(req.user.id);
  next();
});

router.use('/', require('./dashboard'));
router.use('/account', require('./account'));
router.use('/search', require('./search'));
router.use('/notifications', require('./notifications'));
router.use('/appointments', requirePermission(['appointments.view', 'appointments.log']), require('./appointments'));
router.use('/schedule', require('./schedule')); // everyone sees their own shifts
router.use('/accounts', requirePermission('accounts.view'), require('./accounts'));
router.use('/roles', requirePermission('roles.view'), require('./roles'));
router.use('/audit', requirePermission('audit.view'), require('./audit'));

router.use((req, res, next) => {
  const err = new Error('We couldn’t find that page in the portal.');
  err.status = 404;
  next(err);
});

module.exports = router;
