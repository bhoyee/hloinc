'use strict';

const express = require('express');
const roles = require('../../services/roles');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { MODULES, ADMIN_ROLE, actionColumns, normalize } = require('../../auth/permissions');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { roleSchema } = require('../../validation/portal');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const editCrumbs = [...crumbs, { label: 'Roles & permissions', href: '/portal/roles' }];

/** The permission matrix: one row per module, with its action columns and extras. */
const COLUMN_ORDER = ['view', 'edit', 'archive', 'delete'];
const matrix = MODULES.map((m) => {
  const columns = actionColumns(m);
  return {
    ...m,
    // One cell per standard column; null where the area doesn't have that action.
    cells: COLUMN_ORDER.map((k) => columns.find((c) => c.key === k) || null),
    extraList: Object.entries(m.extras || {}).map(([key, label]) => ({ permission: `${m.key}.${key}`, label })),
  };
});

/** "Jobs: Delete permanently" style summary — the strongest action per module. */
function summarize(role) {
  return MODULES.map((m) => {
    const granted = COLUMN_ORDER.filter((a) => role.permissions.has(`${m.key}.${a}`));
    const extras = Object.keys(m.extras || {}).filter((a) => role.permissions.has(`${m.key}.${a}`));
    if (!granted.length && !extras.length) return null;
    const top = granted[granted.length - 1];
    const level = top ? actionColumns(m).find((c) => c.key === top).label : m.extras[extras[0]];
    return { module: m.label, level, full: granted.length === m.actions.length };
  }).filter(Boolean);
}

/** Only grant what you hold yourself (Admin holds everything). */
const beyondActor = (actor, keys) => (actor.role === ADMIN_ROLE ? [] : keys.filter((k) => !actor.permissions.has(k)));

// --- List ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const counts = await roles.userCounts();
  const list = (await roles.list()).map((r) => ({ ...r, users: counts[r.key] || 0, summary: summarize(r), isOwn: r.key === req.user.role }));
  res.render('pages/portal/roles/list.njk', {
    title: 'Roles & permissions',
    subheading: 'Choose what each role can see and do in the portal.',
    crumbs,
    roles: list,
  });
});

// --- Create / edit ---------------------------------------------------------------

function renderEditor(req, res, { role = null, values, errors = {}, status = 200, readOnly = false, readOnlyReason = '' }) {
  res.status(status).render('pages/portal/roles/edit.njk', {
    title: role ? role.name : 'New role',
    subheading: role ? role.description : 'Give the role a name, then tick what it can do.',
    crumbs: editCrumbs,
    role,
    values,
    errors,
    matrix,
    readOnly,
    readOnlyReason,
    actorRole: req.user.role,
  });
}

const valuesFrom = (role) => ({
  name: role.name,
  description: role.description || '',
  require_mfa: role.require_mfa ? 'yes' : '',
  permissions: [...role.permissions],
});

router.get('/new', requirePermission('roles.edit'), (req, res) =>
  renderEditor(req, res, { values: { name: '', description: '', require_mfa: '', permissions: [] } })
);

function parseRole(req) {
  const parsed = roleSchema.safeParse(req.body);
  const values = { ...req.body, permissions: [].concat(req.body.permissions || []) };
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error) };
  const permissions = normalize(parsed.data.permissions);
  const tooMuch = beyondActor(req.user, permissions);
  if (tooMuch.length) return { values, errors: { permissions: 'You can only give permissions that your own role has.' } };
  return { values, data: { name: parsed.data.name, description: parsed.data.description, requireMfa: parsed.data.require_mfa === 'yes', permissions } };
}

router.post('/', requirePermission('roles.edit'), async (req, res) => {
  const { values, errors, data } = parseRole(req);
  if (!data) return renderEditor(req, res, { values, errors, status: 422 });
  if ((await roles.list()).some((r) => r.name.toLowerCase() === data.name.toLowerCase())) {
    return renderEditor(req, res, { values, errors: { name: 'A role with this name already exists.' }, status: 422 });
  }
  const role = await roles.create(data);
  await audit(req, {
    action: 'role.create',
    entityType: 'role',
    entityId: role.key,
    summary: `${req.user.name} created the role “${role.name}”`,
    metadata: { permissions: [...role.permissions], requireMfa: role.require_mfa },
  });
  setFlash(req, 'success', `Role “${role.name}” created. You can now give it to staff from Staff accounts.`);
  res.redirect(303, `/portal/roles/${role.key}`);
});

router.param('key', async (req, res, next, key) => {
  const role = await roles.get(key);
  if (!role) {
    const err = new Error('That role doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  req.role = role;
  next();
});

/** Why this person can't edit this role, or '' if they can. */
function lockReason(req) {
  if (req.role.is_system) return 'The Admin role always has full access, so HLO can never be locked out. It can’t be changed.';
  if (req.role.key === req.user.role) return 'This is your own role. Another person who manages roles must change it, so nobody can lock themselves out by accident.';
  if (!req.user.permissions.has('roles.edit')) return 'Your role can view roles but not change them.';
  return '';
}

router.get('/:key', (req, res) => {
  const reason = lockReason(req);
  renderEditor(req, res, { role: req.role, values: valuesFrom(req.role), readOnly: Boolean(reason), readOnlyReason: reason });
});

router.post('/:key', requirePermission('roles.edit'), async (req, res) => {
  const reason = lockReason(req);
  if (reason) {
    setFlash(req, 'error', reason);
    return res.redirect(303, `/portal/roles/${req.role.key}`);
  }
  const { values, errors, data } = parseRole(req);
  if (!data) return renderEditor(req, res, { role: req.role, values, errors, status: 422 });
  if ((await roles.list()).some((r) => r.key !== req.role.key && r.name.toLowerCase() === data.name.toLowerCase())) {
    return renderEditor(req, res, { role: req.role, values, errors: { name: 'Another role already has this name.' }, status: 422 });
  }

  const before = req.role;
  const after = await roles.update(before.key, data);
  const added = [...after.permissions].filter((p) => !before.permissions.has(p));
  const removed = [...before.permissions].filter((p) => !after.permissions.has(p));
  await audit(req, {
    action: 'role.update',
    entityType: 'role',
    entityId: after.key,
    summary: `${req.user.name} updated the role “${after.name}” (${added.length} added, ${removed.length} removed)`,
    metadata: { added, removed, requireMfa: { from: before.require_mfa, to: after.require_mfa }, name: { from: before.name, to: after.name } },
  });
  setFlash(req, 'success', 'Role saved. Changes apply to everyone with this role straight away.');
  res.redirect(303, `/portal/roles/${after.key}`);
});

router.post('/:key/delete', requirePermission('roles.delete'), async (req, res) => {
  const role = req.role;
  const inUse = (await roles.userCounts())[role.key] || 0;
  const problem = role.is_system
    ? 'The Admin role can’t be deleted.'
    : role.key === req.user.role
      ? 'You can’t delete your own role.'
      : inUse
        ? `${inUse} ${inUse === 1 ? 'person has' : 'people have'} this role. Give them another role first, including deactivated accounts.`
        : '';
  if (problem) {
    setFlash(req, 'error', problem);
    return res.redirect(303, `/portal/roles/${role.key}`);
  }
  await roles.remove(role.key);
  await audit(req, { action: 'role.delete', entityType: 'role', entityId: role.key, summary: `${req.user.name} deleted the role “${role.name}”`, metadata: { permissions: [...role.permissions] } });
  setFlash(req, 'success', `Role “${role.name}” deleted.`);
  res.redirect(303, '/portal/roles');
});

module.exports = router;
