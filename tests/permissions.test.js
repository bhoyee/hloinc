import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { DEFAULT_ROLES, ALL_PERMISSIONS, normalize, can } = require('../src/auth/permissions');

const role = (key) => DEFAULT_ROLES.find((r) => r.key === key);
const user = (key, status = 'active') => ({ role: key, status, permissions: new Set(normalize(role(key).permissions)) });

describe('default roles (requirements §4)', () => {
  it('gives Admin every permission', () => {
    expect(new Set(role('admin').permissions)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('keeps accounts, roles and the audit log for Admin and IT only', () => {
    for (const r of DEFAULT_ROLES) {
      const u = user(r.key);
      for (const p of ['accounts.view', 'roles.view', 'audit.view']) expect(can(u, p)).toBe(['admin', 'it_admin'].includes(r.key));
    }
  });

  it('gives IT account management but no client information or role editing', () => {
    const it = user('it_admin');
    for (const p of ['accounts.edit', 'accounts.archive', 'accounts.manage_all', 'audit.view']) expect(can(it, p)).toBe(true);
    for (const p of ['accounts.delete', 'roles.edit', 'messages.view', 'messages.view_intake', 'appointments.view', 'jobs.view', 'site_content.edit']) {
      expect(can(it, p)).toBe(false);
    }
  });

  it('lets Reception view and log appointments but not confirm or cancel them', () => {
    const r = user('reception');
    expect(can(r, 'appointments.view')).toBe(true);
    expect(can(r, 'appointments.log')).toBe(true);
    expect(can(r, 'appointments.edit')).toBe(false);
    expect(can(r, 'schedule.edit')).toBe(false);
  });

  it('shows Intake Specialists only intake and referral messages', () => {
    const i = user('intake_specialist');
    expect(can(i, 'messages.view')).toBe(false);
    expect(can(i, 'messages.view_intake')).toBe(true);
  });

  it('gives Program Directors limited site content editing', () => {
    const d = user('program_director');
    expect(can(d, 'site_content.edit_limited')).toBe(true);
    expect(can(d, 'site_content.edit')).toBe(false);
  });
});

describe('permission rules', () => {
  it('adds View whenever a role can do more in an area', () => {
    expect(normalize(['jobs.delete'])).toEqual(['jobs.view', 'jobs.delete']);
  });

  it('treats "all messages" and "intake only" as alternatives', () => {
    expect(normalize(['messages.view', 'messages.view_intake'])).toEqual(['messages.view']);
    expect(normalize(['messages.view_intake', 'messages.edit'])).toEqual(['messages.edit', 'messages.view_intake']);
  });

  it('drops unknown permissions', () => {
    expect(normalize(['jobs.view', 'jobs.fly', 'evil'])).toEqual(['jobs.view']);
  });

  it('gives deactivated accounts nothing', () => {
    for (const p of ALL_PERMISSIONS) expect(can(user('admin', 'deactivated'), p)).toBe(false);
  });

  it('throws on unknown permission names so typos fail loudly', () => {
    expect(() => can(user('admin'), 'acounts.view')).toThrow();
  });
});
