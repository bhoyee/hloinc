'use strict';

const db = require('../db/knex');
const roles = require('./roles');
const { NAV } = require('../lib/portalNav');
const { can } = require('../auth/permissions');

/*
 * Global portal search. Each provider checks the user's permissions, so
 * people only ever find what their role lets them see. New modules
 * (appointments, messages…) add a provider here when they're built.
 */

const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const EXTRA_PAGES = [
  { label: 'My account', href: '/portal/account', icon: 'users', keywords: 'profile password details' },
  { label: 'Two-step sign-in', href: '/portal/account/two-step', icon: 'device', keywords: 'mfa authenticator security recovery codes' },
  { label: 'Notifications', href: '/portal/notifications', icon: 'megaphone', keywords: 'alerts' },
  { label: 'Add a staff account', href: '/portal/accounts/new', icon: 'plus', permission: 'accounts.edit', keywords: 'invite new user staff' },
  { label: 'New role', href: '/portal/roles/new', icon: 'plus', permission: 'roles.edit', keywords: 'create role permissions' },
];

const providers = [
  {
    label: 'Pages',
    async run(user, q) {
      const needle = q.toLowerCase();
      const pages = [...NAV.filter((n) => n.href), ...EXTRA_PAGES];
      return pages
        .filter((p) => !p.permission || [].concat(p.permission).some((perm) => can(user, perm)))
        .filter((p) => `${p.label} ${p.keywords || ''}`.toLowerCase().includes(needle))
        .map((p) => ({ title: p.label, subtitle: 'Go to page', href: p.href, icon: p.icon }));
    },
  },
  {
    label: 'Staff',
    permission: 'accounts.view',
    async run(user, q, limit) {
      const labels = await roles.labels();
      const rows = await db('users')
        .select('id', 'name', 'email', 'role', 'status')
        .where((w) => w.where('name', 'like', likeOf(q)).orWhere('email', 'like', likeOf(q)))
        .orderBy('name')
        .limit(limit);
      return rows.map((u) => ({
        title: u.name,
        subtitle: `${labels[u.role] || u.role} · ${u.email}${u.status === 'active' ? '' : ' · deactivated'}`,
        href: `/portal/accounts/${u.id}`,
        icon: 'users',
      }));
    },
  },
  {
    label: 'Roles',
    permission: 'roles.view',
    async run(user, q) {
      const needle = q.toLowerCase();
      return (await roles.list())
        .filter((r) => `${r.name} ${r.description || ''}`.toLowerCase().includes(needle))
        .map((r) => ({ title: r.name, subtitle: r.description || 'Role', href: `/portal/roles/${r.key}`, icon: 'key' }));
    },
  },
  {
    label: 'Appointments',
    permission: 'appointments.view',
    async run(user, q, limit) {
      const rows = await db('appointments as a')
        .leftJoin('appointment_types as t', 't.id', 'a.type_id')
        .select('a.id', 'a.name', 'a.status', 'a.scheduled_at', 'a.requested_date', 't.name as type_name')
        .where((w) => w.where('a.name', 'like', likeOf(q)).orWhere('a.email', 'like', likeOf(q)).orWhere('a.phone', 'like', likeOf(q)))
        .orderBy('a.created_at', 'desc')
        .limit(limit);
      const fmt = (d) => new Date(d).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
      return rows.map((a) => ({
        title: a.name,
        subtitle: `${a.type_name} · ${a.status.replace('_', '-')}${a.scheduled_at ? ` · ${fmt(a.scheduled_at)}` : ''}`,
        href: `/portal/appointments/${a.id}`,
        icon: 'calendar',
      }));
    },
  },
  {
    label: 'Jobs',
    permission: 'jobs.view',
    async run(user, q, limit) {
      const rows = await db('jobs')
        .select('title', 'slug', 'location', 'status')
        .where((w) => w.where('title', 'like', likeOf(q)).orWhere('location', 'like', likeOf(q)).orWhere('department', 'like', likeOf(q)))
        .orderBy('published_at', 'desc')
        .limit(limit);
      // The jobs manager arrives in Phase 4; until then published roles open on the careers page.
      return rows.map((j) => ({
        title: j.title,
        subtitle: `${j.location || 'Job'} · ${j.status}`,
        href: j.status === 'published' ? `/careers/${j.slug}` : null,
        icon: 'briefcase',
      }));
    },
  },
  {
    label: 'Audit log',
    permission: 'audit.view',
    async run(user, q) {
      const { n } = await db('audit_log').where('summary', 'like', likeOf(q)).count({ n: '*' }).first();
      return Number(n)
        ? [{ title: `${n} audit log ${Number(n) === 1 ? 'entry' : 'entries'} mentioning “${q}”`, subtitle: 'Open the audit log', href: `/portal/audit?q=${encodeURIComponent(q)}`, icon: 'shield' }]
        : [];
    },
  },
];

/** Returns [{ label, items: [{ title, subtitle, href, icon }] }], skipping empty groups. */
async function search(user, query, { limit = 5 } = {}) {
  const q = String(query || '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const groups = [];
  for (const p of providers) {
    if (p.permission && !can(user, p.permission)) continue;
    const items = (await p.run(user, q, limit)).slice(0, limit);
    if (items.length) groups.push({ label: p.label, items });
  }
  return groups;
}

module.exports = { search };
