'use strict';

/**
 * Portal sidebar. Items show only for roles with the permission. Items with
 * `soon` are modules from later phases, shown greyed out so staff can see
 * what's coming.
 */
const NAV = [
  { label: 'Dashboard', href: '/portal', icon: 'dashboard' },
  { label: 'Appointments', href: '/portal/appointments', icon: 'calendar', permission: ['appointments.view', 'appointments.log'], badge: 'appointments', badgeLabel: 'waiting to be confirmed' },
  { label: 'Schedule', href: '/portal/schedule', icon: 'clock' },
  { label: 'Messages', href: '/portal/messages', icon: 'inbox', permission: ['messages.view', 'messages.view_intake'], badge: 'messages', badgeLabel: 'unread' },
  { label: 'Leads', href: '/portal/leads', icon: 'heart', permission: 'leads.view' },
  { label: 'Jobs', href: '/portal/jobs', icon: 'briefcase', permission: 'jobs.view' },
  { label: 'Announcements', href: '/portal/announcements', icon: 'megaphone', permission: 'announcements.view' },
  { label: 'Site content', href: '/portal/content', icon: 'document', permission: ['site_content.view', 'site_content.edit', 'site_content.edit_limited'] },
  { label: 'Staff accounts', href: '/portal/accounts', icon: 'users', permission: 'accounts.view', group: 'admin' },
  { label: 'Roles & permissions', href: '/portal/roles', icon: 'key', permission: 'roles.view', group: 'admin' },
  { label: 'Security settings', href: '/portal/settings/security', icon: 'lock', permission: 'security.edit', group: 'admin' },
  { label: 'Audit log', href: '/portal/audit', icon: 'shield', permission: 'audit.view', group: 'admin' },
];

function navFor(can, currentPath) {
  return NAV.filter((item) => !item.permission || [].concat(item.permission).some((p) => can(p))).map((item) => ({
    ...item,
    active: item.href && (item.href === '/portal' ? currentPath === '/portal' : currentPath.startsWith(item.href)),
  }));
}

module.exports = { navFor, NAV };
