import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ROLES, PERMISSIONS, can } = require('../src/auth/permissions');

const user = (role, status = 'active') => ({ role, status });

describe('permissions (requirements §4)', () => {
  it('only Admin manages accounts and views the audit log', () => {
    for (const role of Object.values(ROLES)) {
      expect(can(user(role), 'accounts.manage')).toBe(role === ROLES.ADMIN);
      expect(can(user(role), 'audit.view')).toBe(role === ROLES.ADMIN);
    }
  });

  it('Reception can view and log appointments but not confirm/cancel them', () => {
    const r = user(ROLES.RECEPTION);
    expect(can(r, 'appointments.view')).toBe(true);
    expect(can(r, 'appointments.log_walkin')).toBe(true);
    expect(can(r, 'appointments.update_status')).toBe(false);
    expect(can(r, 'schedule.manage')).toBe(false);
  });

  it('Intake Specialist sees only intake/referral contacts', () => {
    const i = user(ROLES.INTAKE_SPECIALIST);
    expect(can(i, 'contacts.view_all')).toBe(false);
    expect(can(i, 'contacts.view_intake')).toBe(true);
  });

  it('deactivated accounts have no permissions', () => {
    for (const permission of Object.keys(PERMISSIONS)) {
      expect(can(user(ROLES.ADMIN, 'deactivated'), permission)).toBe(false);
    }
  });

  it('throws on unknown permission names so typos fail loudly', () => {
    expect(() => can(user(ROLES.ADMIN), 'acounts.manage')).toThrow();
  });
});
