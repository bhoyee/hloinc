'use strict';

/**
 * Permission catalog. Each portal area (module) lists the actions a role can
 * be given. Roles themselves live in the database and are managed by the
 * CEO/COO under Administration → Roles & permissions.
 *
 * Permission keys are "<module>.<action>", e.g. "jobs.edit".
 */

const ADMIN_ROLE = 'admin';

// Standard actions, in the order they appear as columns in the role editor.
const STANDARD_ACTIONS = {
  view: { label: 'View', help: 'Read-only access.' },
  edit: { label: 'Create & edit', help: 'Add new items and change existing ones.' },
  archive: { label: 'Archive', help: 'Temporarily remove (can be restored).' },
  delete: { label: 'Delete permanently', help: 'Remove for good. Cannot be undone.' },
};

const MODULES = [
  {
    key: 'appointments',
    label: 'Appointments',
    description: 'Website appointment requests, walk-ins and phone bookings.',
    actions: ['view', 'edit', 'archive', 'delete'],
    extras: { log: 'Log walk-in and phone appointments', manage_types: 'Manage appointment types (names, length, capacity)' },
    labels: { edit: 'Confirm & update', archive: 'Cancel' },
  },
  {
    key: 'schedule',
    label: 'Staff schedule',
    description: 'Shifts and availability.',
    actions: ['view', 'edit'],
    // Only Admin by default; the Admin can give it to other roles (e.g. Program Director).
    extras: { approve_time_off: 'Receive & approve time-off requests (for the staff this role can see)' },
  },
  {
    key: 'messages',
    label: 'Messages & referrals',
    description: 'The contact form inbox and website referrals.',
    actions: ['view', 'edit', 'archive', 'delete'],
    extras: { view_intake: 'See intake and referral messages only' },
    labels: { view: 'View all', edit: 'Reply & update status' },
  },
  {
    key: 'leads',
    label: 'Leads',
    description: 'Everyone who has reached out (requests, referrals, appointments, enquiries) and where they are in intake.',
    actions: ['view', 'edit', 'delete'],
    extras: { export: 'Export leads to a spreadsheet (CSV)' },
    labels: { edit: 'Update stage, owner & notes' },
  },
  {
    key: 'jobs',
    label: 'Jobs & careers',
    description: 'Job postings on the careers page.',
    actions: ['view', 'edit', 'archive', 'delete'],
  },
  {
    key: 'announcements',
    label: 'Announcements',
    description: 'Public and internal announcements.',
    actions: ['view', 'edit', 'archive', 'delete'],
    labels: { edit: 'Create, edit, pause & end', archive: 'Delete own (an Admin can restore)', delete: 'Delete anyone’s, restore & delete permanently' },
  },
  {
    key: 'site_content',
    label: 'Website content',
    description: 'Page text, office hours and contact details.',
    actions: ['view', 'edit'],
    extras: { edit_limited: 'Edit announcements text, careers text and office hours only' },
    labels: { edit: 'Edit all content' },
  },
  {
    key: 'accounts',
    label: 'Staff accounts',
    description: 'Invite staff, change details and roles, reset access.',
    actions: ['view', 'edit', 'archive', 'delete'],
    // Without this, people can only manage staff whose role has no more access than their own.
    extras: { manage_all: 'Manage everyone’s account except Admins (password resets, two-step resets, deactivation)' },
    labels: { archive: 'Deactivate' },
  },
  {
    key: 'roles',
    label: 'Roles & permissions',
    description: 'This screen: create roles and choose what each can do.',
    actions: ['view', 'edit', 'delete'],
  },
  {
    key: 'reports',
    label: 'Dashboard analytics',
    description: 'Charts and trends on the dashboard (only for the areas the role can already see).',
    actions: ['view'],
    labels: { view: 'See charts' },
  },
  {
    key: 'security',
    label: 'Security settings',
    description: 'Portal-wide security, such as switching two-step sign-in on or off for everyone.',
    actions: ['edit'],
    labels: { edit: 'Change' },
  },
  {
    key: 'audit',
    label: 'Audit log',
    description: 'The record of sign-ins and important changes.',
    actions: ['view'],
  },
];

/** Every valid permission key, in catalog order. */
const ALL_PERMISSIONS = MODULES.flatMap((m) => [
  ...m.actions.map((a) => `${m.key}.${a}`),
  ...Object.keys(m.extras || {}).map((a) => `${m.key}.${a}`),
]);
const VALID = new Set(ALL_PERMISSIONS);

/**
 * Tidy a set of permission keys: drop unknown keys, and give "view" to any
 * module where the role can do more (you can't edit what you can't see).
 * "View all messages" makes "intake only" redundant.
 */
function normalize(keys) {
  const set = new Set([].concat(keys || []).filter((k) => VALID.has(k)));
  for (const m of MODULES) {
    const has = (a) => set.has(`${m.key}.${a}`);
    const needsView = m.actions.filter((a) => a !== 'view').some(has) || ['log', 'edit_limited', 'manage_types', 'export', 'approve_time_off'].some(has);
    if (needsView && m.actions.includes('view') && !(m.key === 'messages' && has('view_intake') && !has('view'))) {
      set.add(`${m.key}.view`);
    }
  }
  if (set.has('messages.view')) set.delete('messages.view_intake');
  return ALL_PERMISSIONS.filter((k) => set.has(k));
}

/** Starting roles (requirements §4). Loaded into the database by migration. */
const DEFAULT_ROLES = [
  {
    key: ADMIN_ROLE,
    name: 'Admin (CEO/COO)',
    description: 'Full access to everything, including staff accounts, roles and the audit log.',
    is_system: true,
    require_mfa: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'it_admin',
    name: 'IT Administrator',
    description: 'Keeps staff able to sign in: invites, password and two-step resets, deactivation. No access to client information.',
    require_mfa: true,
    permissions: ['accounts.view', 'accounts.edit', 'accounts.archive', 'accounts.manage_all', 'roles.view', 'audit.view'],
  },
  {
    key: 'program_director',
    name: 'Program Director',
    description: 'Runs programs: jobs, announcements, schedules, appointments and limited site content.',
    require_mfa: true,
    permissions: [
      'appointments.view', 'appointments.edit', 'appointments.archive', 'appointments.log', 'appointments.manage_types',
      'schedule.view', 'schedule.edit',
      'messages.view', 'messages.edit',
      'leads.view', 'leads.edit', 'leads.export',
      'jobs.view', 'jobs.edit', 'jobs.archive', 'jobs.delete',
      'announcements.view', 'announcements.edit', 'announcements.archive',
      'site_content.edit_limited',
      'reports.view',
    ],
  },
  {
    key: 'program_coordinator',
    name: 'Program Coordinator',
    description: 'Day-to-day coordination: announcements, schedules and appointments.',
    permissions: [
      'appointments.view', 'appointments.edit', 'appointments.archive', 'appointments.log',
      'schedule.view', 'schedule.edit',
      'messages.view', 'messages.edit',
      'leads.view', 'leads.edit',
      'announcements.view', 'announcements.edit', 'announcements.archive',
    ],
  },
  {
    key: 'intake_specialist',
    name: 'Intake Specialist',
    description: 'Appointments and the intake / referral inbox.',
    permissions: ['appointments.view', 'appointments.edit', 'appointments.archive', 'appointments.log', 'messages.view_intake', 'messages.edit', 'leads.view', 'leads.edit'],
  },
  {
    key: 'reception',
    name: 'Reception',
    description: 'Front desk: logs walk-in and phone appointments; read-only schedules and messages.',
    permissions: ['appointments.view', 'appointments.log', 'schedule.view', 'messages.view'],
  },
];

/**
 * Does the signed-in user have this permission? `user.permissions` is loaded
 * from the database for their role on every request (see middleware/auth.js).
 */
function can(user, permission) {
  if (!VALID.has(permission)) throw new Error(`Unknown permission: ${permission}`);
  if (!user || user.status !== 'active' || !user.permissions) return false;
  return user.permissions.has(permission);
}

/** True if `user` holds every permission in `keys` (used to stop privilege escalation). */
function hasAll(user, keys) {
  return keys.every((k) => user.permissions && user.permissions.has(k));
}

/** Labels for each action of a module, for the role editor and summaries. */
function actionColumns(module) {
  return module.actions.map((a) => ({
    key: a,
    permission: `${module.key}.${a}`,
    label: (module.labels && module.labels[a]) || STANDARD_ACTIONS[a].label,
    help: STANDARD_ACTIONS[a].help,
  }));
}

module.exports = { ADMIN_ROLE, MODULES, STANDARD_ACTIONS, ALL_PERMISSIONS, DEFAULT_ROLES, normalize, can, hasAll, actionColumns };
