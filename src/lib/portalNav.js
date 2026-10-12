'use strict';

const { MESSAGE_ACCESS } = require('../auth/permissions');
/**
 * Portal sidebar. Items show only for roles with the permission. Items with
 * `soon` are modules from later phases, shown greyed out so staff can see
 * what's coming.
 */
const NAV = [
  { label: 'Dashboard', href: '/portal', icon: 'dashboard' },
  { label: 'Messages', href: '/portal/messages', icon: 'inbox', permission: MESSAGE_ACCESS, badge: 'messages', badgeLabel: 'unread', group: 'inbox' },
  { label: 'Leads', href: '/portal/leads', icon: 'heart', permission: 'leads.view', group: 'inbox' },
  { label: 'Appointments', href: '/portal/appointments', icon: 'calendar', permission: ['appointments.view', 'appointments.log'], badge: 'appointments', badgeLabel: 'waiting to be confirmed', group: 'scheduling' },
  { label: 'Schedule', href: '/portal/schedule', icon: 'clock', badge: 'timeOff', badgeLabel: 'time-off requests waiting', group: 'scheduling' },
  // Applications are reached from the Jobs page; the counter shows new ones (for roles that can see them).
  { label: 'Jobs', href: '/portal/jobs', icon: 'briefcase', permission: 'jobs.view', badge: 'applications', badgeLabel: 'new applications', also: ['/portal/applications'], group: 'hiring' },
  { label: 'Announcements', href: '/portal/announcements', icon: 'megaphone', permission: 'announcements.view', group: 'website' },
  { label: 'Site content', href: '/portal/content', icon: 'document', permission: ['site_content.view', 'site_content.edit', 'site_content.edit_limited'], group: 'website' },
  { label: 'Staff accounts', href: '/portal/accounts', icon: 'users', permission: 'accounts.view', group: 'admin' },
  { label: 'Roles & permissions', href: '/portal/roles', icon: 'key', permission: 'roles.view', group: 'admin' },
  { label: 'Help requests', href: '/portal/help', icon: 'question', permission: 'support.view', group: 'admin', badge: 'support', badgeLabel: 'new help requests' },
  { label: 'System health', href: '/portal/system', icon: 'server', permission: 'system.view', group: 'admin', badge: 'system', badgeLabel: 'problems' },
  { label: 'Reports', href: '/portal/reports', icon: 'document', permission: 'monthly_report.view', group: 'admin' },
  { label: 'Security settings', href: '/portal/settings/security', icon: 'lock', permission: 'security.edit', group: 'admin' },
  { label: 'Audit log', href: '/portal/audit', icon: 'shield', permission: 'audit.view', group: 'admin' },
];

/** Menu headings, in order. Items without a group (Dashboard) come first, without a heading. */
const GROUPS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'scheduling', label: 'Scheduling' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'website', label: 'Website' },
  { key: 'admin', label: 'Administration' },
];

/** The menu as headed groups: [{ key, label, items }]; the first group (no heading) holds Dashboard. */
function groupsFor(items) {
  const top = { key: '', label: '', items: items.filter((i) => !i.group && !i.soon) };
  return [top, ...GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) }))].filter((g) => g.items.length);
}

function navFor(can, currentPath) {
  return NAV.filter((item) => !item.permission || [].concat(item.permission).some((p) => can(p))).map((item) => ({
    ...item,
    active: item.href && (item.href === '/portal' ? currentPath === '/portal' : [item.href, ...(item.also || [])].some((h) => currentPath.startsWith(h))),
  }));
}

module.exports = { navFor, groupsFor, NAV, GROUPS };
