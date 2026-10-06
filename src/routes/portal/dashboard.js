'use strict';

const express = require('express');
const db = require('../../db/knex');
const { can } = require('../../auth/permissions');

const router = express.Router();

const count = (query) => query.count({ n: '*' }).first().then((r) => Number(r.n));

/** Contact inbox scope for this user: everything, intake only, or nothing. */
function inboxScope(user) {
  if (can(user, 'messages.view')) return (q) => q;
  if (can(user, 'messages.view_intake')) return (q) => q.where({ recipient: 'intake' });
  return null;
}

router.get('/', async (req, res) => {
  const user = req.user;
  const tiles = [];

  const scope = inboxScope(user);
  if (scope) {
    tiles.push({
      label: 'New messages',
      icon: 'inbox',
      value: await count(scope(db('contact_messages').where({ status: 'new', type: 'message' }))),
      note: 'From the website contact form',
    });
    tiles.push({
      label: 'New referrals',
      icon: 'document',
      value: await count(scope(db('contact_messages').where({ status: 'new', type: 'referral' }))),
      note: 'Waiting for the intake team',
    });
  }
  if (can(user, 'appointments.view')) {
    tiles.push({
      label: 'Appointment requests',
      icon: 'calendar',
      value: await count(db('appointments').where({ status: 'requested' })),
      note: 'Waiting to be confirmed',
    });
  }
  if (can(user, 'jobs.view')) {
    tiles.push({ label: 'Open jobs', icon: 'briefcase', value: await count(db('jobs').where({ status: 'published' })), note: 'Live on the careers page' });
  }
  if (can(user, 'accounts.view')) {
    tiles.push({ label: 'Active staff accounts', icon: 'users', value: await count(db('users').where({ status: 'active' })), note: 'People who can sign in', href: '/portal/accounts' });
  }

  const recentActivity = can(user, 'audit.view')
    ? await db('audit_log').select('action', 'user_name', 'summary', 'created_at').orderBy('id', 'desc').limit(6)
    : [];

  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  res.render('pages/portal/dashboard.njk', {
    title: 'Dashboard',
    heading: `${greeting}, ${user.name.split(' ')[0]}`,
    subheading: 'Here’s what’s happening at HLO.',
    tiles,
    recentActivity,
    previousLogin: req.session.previousLoginAt,
    security: {
      mfaEnabled: user.mfa_enabled,
      mfaRequired: user.requireMfa,
      recoveryLeft: user.mfa_enabled ? await require('../../services/mfa').remainingRecoveryCodes(user.id) : null,
    },
  });
});

module.exports = router;
