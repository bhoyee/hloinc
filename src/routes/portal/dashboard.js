'use strict';

const express = require('express');
const db = require('../../db/knex');
const { can } = require('../../auth/permissions');
const dashboard = require('../../services/dashboard');

const router = express.Router();

const TIMEZONE = 'America/New_York';

/** Live tiles and charts, polled by the open dashboard (silent refresh). */
router.get('/dashboard/data', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await dashboard.snapshot(req.user, res.locals.site.schedule));
});

router.get('/', async (req, res) => {
  const user = req.user;
  const live = await dashboard.snapshot(user, res.locals.site.schedule);
  const now = new Date(live.updatedAt);

  // Everyone: their next shift (staff always see their own schedule).
  const nextShift = await db('shifts').where({ user_id: user.id }).where('end_at', '>', new Date()).orderBy('start_at').first();

  const recentActivity = can(user, 'audit.view')
    ? await db('audit_log').select('action', 'user_name', 'summary', 'created_at').orderBy('id', 'desc').limit(6)
    : [];

  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  res.render('pages/portal/dashboard.njk', {
    title: 'Dashboard',
    heading: `${greeting}, ${user.name.split(' ')[0]}`,
    subheading: 'Here’s what’s happening at HLO.',
    live,
    clock: {
      date: new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now),
      time: new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(now),
    },
    recentActivity,
    previousLogin: req.session.previousLoginAt,
    nextShift,
    security: {
      mfaEnabled: user.mfa_enabled,
      mfaRequired: user.requireMfa,
      recoveryLeft: user.mfa_enabled ? await require('../../services/mfa').remainingRecoveryCodes(user.id) : null,
    },
  });
});

module.exports = router;
