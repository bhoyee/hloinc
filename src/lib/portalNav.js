'use strict';

/**
 * Portal sidebar. Items show only for roles with the permission. Items with
 * `soon` are modules from later phases, shown greyed out so staff can see
 * what's coming.
 */
const NAV = [
  { label: 'Dashboard', href: '/portal', icon: 'dashboard' },
  { label: 'Appointments', icon: 'calendar', permission: 'appointments.view', soon: 'Phase 3' },
  { label: 'Schedule', icon: 'clock', permission: 'schedule.view', soon: 'Phase 3' },
  { label: 'Messages', icon: 'inbox', permission: ['messages.view', 'messages.view_intake'], soon: 'Phase 4' },
  { label: 'Jobs', icon: 'briefcase', permission: 'jobs.view', soon: 'Phase 4' },
  { label: 'Announcements', icon: 'megaphone', permission: 'announcements.view', soon: 'Phase 4' },
  { label: 'Site content', icon: 'document', permission: ['site_content.view', 'site_content.edit_limited'], soon: 'Phase 4' },
  { label: 'Staff accounts', href: '/portal/accounts', icon: 'users', permission: 'accounts.view', group: 'admin' },
  { label: 'Roles & permissions', href: '/portal/roles', icon: 'key', permission: 'roles.view', group: 'admin' },
  { label: 'Audit log', href: '/portal/audit', icon: 'shield', permission: 'audit.view', group: 'admin' },
];

function navFor(can, currentPath) {
  return NAV.filter((item) => !item.permission || [].concat(item.permission).some((p) => can(p))).map((item) => ({
    ...item,
    active: item.href && (item.href === '/portal' ? currentPath === '/portal' : currentPath.startsWith(item.href)),
  }));
}

module.exports = { navFor, NAV };
