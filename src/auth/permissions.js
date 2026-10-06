'use strict';

/**
 * Staff roles and permissions — Section 4 of the requirements document.
 * Marked CONFIRM by the client: change the matrix here and every route
 * guard and nav item follows.
 */

const ROLES = Object.freeze({
  ADMIN: 'admin',
  PROGRAM_DIRECTOR: 'program_director',
  PROGRAM_COORDINATOR: 'program_coordinator',
  INTAKE_SPECIALIST: 'intake_specialist',
  RECEPTION: 'reception',
});

const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Admin (CEO/COO)',
  [ROLES.PROGRAM_DIRECTOR]: 'Program Director',
  [ROLES.PROGRAM_COORDINATOR]: 'Program Coordinator',
  [ROLES.INTAKE_SPECIALIST]: 'Intake Specialist',
  [ROLES.RECEPTION]: 'Reception',
});

const { ADMIN, PROGRAM_DIRECTOR, PROGRAM_COORDINATOR, INTAKE_SPECIALIST, RECEPTION } = ROLES;
const ALL = Object.values(ROLES);

const PERMISSIONS = Object.freeze({
  'accounts.manage': [ADMIN],
  'accounts.assign_role': [ADMIN],
  'content.edit': [ADMIN],
  // "Limited" editing: announcements, careers text and office hours only.
  'content.edit_limited': [ADMIN, PROGRAM_DIRECTOR],
  'audit.view': [ADMIN],
  'jobs.manage': [ADMIN, PROGRAM_DIRECTOR],
  'announcements.post': [ADMIN, PROGRAM_DIRECTOR, PROGRAM_COORDINATOR],
  'schedule.manage': [ADMIN, PROGRAM_DIRECTOR, PROGRAM_COORDINATOR],
  'schedule.view': ALL,
  'appointments.view': ALL,
  'appointments.update_status': [ADMIN, PROGRAM_DIRECTOR, PROGRAM_COORDINATOR, INTAKE_SPECIALIST],
  'appointments.log_walkin': ALL,
  'contacts.view_all': [ADMIN, PROGRAM_DIRECTOR, PROGRAM_COORDINATOR, RECEPTION],
  'contacts.view_intake': [INTAKE_SPECIALIST],
  'contacts.manage': [ADMIN, PROGRAM_DIRECTOR, PROGRAM_COORDINATOR, INTAKE_SPECIALIST],
  'profile.edit_own': ALL,
});

function can(user, permission) {
  if (!user || user.status !== 'active') return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown permission: ${permission}`);
  return allowed.includes(user.role);
}

function isValidRole(role) {
  return ALL.includes(role);
}

module.exports = { ROLES, ROLE_LABELS, PERMISSIONS, can, isValidRole };
