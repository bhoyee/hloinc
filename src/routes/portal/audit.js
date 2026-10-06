'use strict';

const express = require('express');
const db = require('../../db/knex');
const { marylandDayStart } = require('../../lib/hours');

const router = express.Router();
const PER_PAGE = 50;

/** Friendly names for action codes, grouped for the filter dropdown. */
const ACTION_LABELS = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.locked': 'Account locked',
  'auth.mfa_failed': 'Incorrect two-step code',
  'auth.logout': 'Signed out',
  'auth.reset_requested': 'Password reset requested',
  'auth.password_reset': 'Password reset',
  'auth.invite_accepted': 'Invitation accepted',
  'profile.update': 'Updated own details',
  'profile.password_change': 'Changed own password',
  'profile.sign_out_others': 'Signed out other devices',
  'mfa.enabled': 'Two-step sign-in turned on',
  'mfa.disabled': 'Two-step sign-in turned off',
  'mfa.recovery_regenerated': 'New recovery codes',
  'account.create': 'Account created',
  'account.update': 'Account details changed',
  'account.role_change': 'Role changed',
  'account.invite_resent': 'Invitation resent',
  'account.reset_access': 'Password reset sent by admin',
  'account.reset_mfa': 'Two-step reset by admin',
  'account.sign_out': 'Signed out by admin',
  'account.deactivate': 'Account deactivated',
  'account.reactivate': 'Account reactivated',
  'account.delete': 'Account deleted',
};

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

router.get('/', async (req, res) => {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const filters = {
    q: str(req.query.q),
    action: str(req.query.action),
    user: /^\d+$/.test(req.query.user || '') ? req.query.user : '',
    from: isDate(req.query.from) ? req.query.from : '',
    to: isDate(req.query.to) ? req.query.to : '',
  };

  const query = db('audit_log');
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    query.where((w) => w.where('summary', 'like', like).orWhere('user_name', 'like', like).orWhere('ip', 'like', like));
  }
  if (filters.action) query.where({ action: filters.action });
  if (filters.user) query.where({ user_id: Number(filters.user) });
  // "From" and "to" are whole Maryland calendar days (inclusive).
  if (filters.from) query.where('created_at', '>=', marylandDayStart(filters.from));
  if (filters.to) {
    const next = new Date(`${filters.to}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    query.where('created_at', '<', marylandDayStart(next.toISOString().slice(0, 10)));
  }

  const { total } = await query.clone().count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), pages);
  const entries = await query
    .select('id', 'user_id', 'user_name', 'action', 'entity_type', 'entity_id', 'summary', 'ip', 'user_agent', 'metadata', 'created_at')
    .orderBy('id', 'desc')
    .limit(PER_PAGE)
    .offset((page - 1) * PER_PAGE);

  for (const e of entries) {
    e.label = ACTION_LABELS[e.action] || e.action;
    e.tone = /failed|locked|delete|deactivate/.test(e.action) ? 'red' : /login|logout/.test(e.action) ? 'grey' : 'green';
    try {
      e.details = e.metadata ? JSON.stringify(JSON.parse(e.metadata), null, 2) : null;
    } catch {
      e.details = null;
    }
  }

  const people = await db('audit_log').distinct('user_id', 'user_name').whereNotNull('user_id').orderBy('user_name');
  const pageUrl = (p) => `/portal/audit?${new URLSearchParams(Object.entries({ ...filters, page: p > 1 ? p : '' }).filter(([, v]) => v))}`;

  res.render('pages/portal/audit.njk', {
    title: 'Audit log',
    subheading: 'A permanent record of sign-ins and important changes.',
    crumbs: [{ label: 'Dashboard', href: '/portal' }],
    entries,
    total: Number(total),
    page,
    pages,
    filters,
    people: people.filter((p, i, all) => all.findIndex((x) => x.user_id === p.user_id) === i),
    actionOptions: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
    prevUrl: page > 1 ? pageUrl(page - 1) : null,
    nextUrl: page < pages ? pageUrl(page + 1) : null,
  });
});

module.exports = router;
