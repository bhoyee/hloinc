'use strict';

const crypto = require('crypto');
const express = require('express');
const db = require('../../db/knex');
const { can } = require('../../auth/permissions');
const dashboard = require('../../services/dashboard');
const announcements = require('../../services/announcements');
const workday = require('../../services/workday');

const router = express.Router();

const TIMEZONE = 'America/New_York';

/**
 * Everything on the dashboard below the cards: "Needs attention", "Today at
 * HLO", the staff board, recent activity, account security and the next shift.
 * `version` changes whenever any of it would look different, so the open
 * dashboard only re-fetches the HTML when something actually changed.
 */
async function sections(req) {
  const user = req.user;
  const data = {
    panels: await workday.panels(user),
    staffSecurity: await workday.staffSecurity(user),
    board: await announcements.activeForStaff(20, { includePaused: can(user, 'announcements.edit') }),
    recentLeads: can(user, 'leads.view') ? await require('../../services/leads').recent(6) : null,
    stages: require('../../services/leads').STAGES,
    recentActivity: can(user, 'audit.view') ? await workday.recentActivity(30) : [],
    // Everyone: their own upcoming shifts (staff always see their own schedule).
    myShifts: await workday.myShifts(user),
    previousLogin: req.session.previousLoginAt,
    security: {
      mfaEnabled: user.mfa_enabled,
      mfaRequired: user.requireMfa,
      recoveryLeft: user.mfa_enabled ? await require('../../services/mfa').remainingRecoveryCodes(user.id) : null,
    },
  };
  const { version: _panelsVersion, ...panelData } = data.panels;
  const stamp = JSON.stringify({ ...data, panels: panelData, minute: Math.floor(Date.now() / 60000), twoStepOff: user.twoStepOff });
  return { ...data, version: crypto.createHash('sha1').update(stamp).digest('hex').slice(0, 12) };
}

/** Live cards and charts, plus the sections' fingerprint. Polled by the open dashboard. */
router.get('/dashboard/data', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [live, s] = await Promise.all([dashboard.snapshot(req.user, res.locals.site.schedule), sections(req)]);
  res.json({ ...live, sections: s.version });
});

/** The sections' HTML on their own, fetched when their fingerprint changes. */
router.get('/dashboard/panels', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.render('pages/portal/dashboard-panels.njk', await sections(req));
});

router.get('/', async (req, res) => {
  const user = req.user;
  const [live, s] = await Promise.all([dashboard.snapshot(user, res.locals.site.schedule), sections(req)]);
  live.sections = s.version;
  const now = new Date(live.updatedAt);

  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  res.render('pages/portal/dashboard.njk', {
    title: 'Dashboard',
    heading: `${greeting}, ${user.name.split(' ')[0]}`,
    subheading: 'Here’s what’s happening at HLO.',
    live,
    quickActions: workday.quickActions(user),
    clock: {
      date: new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(now),
      time: new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(now),
    },
    ...s,
  });
});

module.exports = router;
