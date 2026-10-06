'use strict';

const express = require('express');
const db = require('../../db/knex');
const users = require('../../services/users');
const tokens = require('../../services/tokens');
const mfa = require('../../services/mfa');
const staffEmails = require('../../services/staffEmails');
const notifications = require('../../services/notifications');
const { audit } = require('../../services/audit');
const roles = require('../../services/roles');
const { ADMIN_ROLE, hasAll } = require('../../auth/permissions');
const { requirePermission } = require('../../middleware/auth');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { accountSchema } = require('../../validation/portal');

const router = express.Router();
const listCrumbs = [{ label: 'Dashboard', href: '/portal' }];
const crumbs = [...listCrumbs, { label: 'Accounts', href: '/portal/accounts' }];

/**
 * Someone can only give out (or manage people in) roles whose permissions
 * they hold themselves, so nobody can grant more power than they have.
 */
const canAssign = (actor, role) => Boolean(role) && (actor.role === ADMIN_ROLE || hasAll(actor, [...role.permissions]));

async function roleOptions(actor) {
  return (await roles.list()).map((r) => ({ value: r.key, label: r.name, description: r.description, assignable: canAssign(actor, r) }));
}

const can = (perm) => requirePermission(perm);

// --- List ----------------------------------------------------------------------

router.get('/', async (req, res) => {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const roleLabels = await roles.labels();
  const filters = { q: str(req.query.q), role: roleLabels[req.query.role] ? req.query.role : '', status: ['active', 'deactivated'].includes(req.query.status) ? req.query.status : '' };
  const result = await users.list({ ...filters, page: req.query.page });
  const pageUrl = (p) => `/portal/accounts?${new URLSearchParams(Object.entries({ ...filters, page: p > 1 ? p : '' }).filter(([, v]) => v))}`;
  res.render('pages/portal/accounts/list.njk', {
    title: 'Accounts',
    subheading: 'Staff who can sign in to the portal.',
    crumbs: listCrumbs,
    ...result,
    filters,
    roleOptions: await roleOptions(req.user),
    roleLabels,
    prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
    nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
  });
});

// --- Create ----------------------------------------------------------------------

async function renderNew(req, res, { values = {}, errors = {}, status = 200 } = {}) {
  res.status(status).render('pages/portal/accounts/new.njk', { title: 'Add a staff account', crumbs, values, errors, roleOptions: await roleOptions(req.user) });
}

/** Role must exist and be one the actor is allowed to give. Returns an error message or null. */
async function roleProblem(actor, key) {
  const role = await roles.get(key);
  if (!role) return 'Choose a role.';
  if (!canAssign(actor, role)) return 'You can’t give someone a role with more access than your own.';
  return null;
}

router.get('/new', can('accounts.edit'), (req, res) => renderNew(req, res));

router.post('/', can('accounts.edit'), async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  const errors = parsed.success ? {} : fieldErrors(parsed.error);
  if (parsed.success && (await users.emailTaken(parsed.data.email))) errors.email = 'An account with this email already exists.';
  if (parsed.success) {
    const problem = await roleProblem(req.user, parsed.data.role);
    if (problem) errors.role = problem;
  }
  if (Object.keys(errors).length) return renderNew(req, res, { values: req.body, errors, status: 422 });

  const account = await users.create(parsed.data);
  await audit(req, {
    action: 'account.create',
    entityType: 'user',
    entityId: account.id,
    summary: `${req.user.name} created an account for ${account.name} (${(await roles.get(account.role)).name})`,
    metadata: { email: account.email, role: account.role },
  });
  const sent = await sendInvite(req, account);
  setFlash(req, sent ? 'success' : 'warning', sent
    ? `Account created. We’ve emailed ${account.email} a link to set their password.`
    : 'Account created, but the invitation email could not be sent. Check the email settings, then use “Resend invitation”.');
  res.redirect(303, `/portal/accounts/${account.id}`);
});

async function sendInvite(req, account) {
  const token = await tokens.issue(account.id, 'invite', req.ip);
  const result = await staffEmails.invite(account, token, req.user.name);
  return result.ok;
}

// --- Load the account for /:id routes ----------------------------------------

router.param('id', async (req, res, next, id) => {
  const account = /^\d+$/.test(id) ? await users.findById(Number(id)) : null;
  if (!account) {
    const err = new Error('That account doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  req.account = account;
  req.isSelf = account.id === req.user.id;
  // Only people who hold everything this person's role allows can manage them.
  // "Manage everyone" (e.g. IT) covers every account except Admins. Changing someone's role
  // still needs the new role's permissions (see roleProblem), so it can't be used to promote anyone.
  req.canManage =
    req.isSelf ||
    canAssign(req.user, await roles.get(account.role)) ||
    (req.user.permissions.has('accounts.manage_all') && account.role !== ADMIN_ROLE);
  next();
});

/** Guard for changes to a specific account: the permission, plus seniority. */
const manage = (perm) => [
  requirePermission(perm),
  (req, res, next) => {
    if (req.canManage) return next();
    const err = new Error('This person has more access than you, so only someone with at least their access can change their account.');
    err.status = 403;
    next(err);
  },
];

/** Refuse changes that would leave HLO without an active Admin. */
async function wouldRemoveLastAdmin(account, { newRole, newStatus } = {}) {
  if (account.role !== ADMIN_ROLE || account.status !== 'active') return false;
  const losesAdmin = (newRole && newRole !== ADMIN_ROLE) || newStatus === 'deactivated' || newStatus === 'deleted';
  return losesAdmin && (await users.countActiveAdmins()) <= 1;
}

function back(req, res, type, message) {
  setFlash(req, type, message);
  res.redirect(303, `/portal/accounts/${req.account.id}`);
}

// --- View / edit ------------------------------------------------------------------

async function renderShow(req, res, { values, errors = {}, status = 200 } = {}) {
  const account = req.account;
  const roleLabels = await roles.labels();
  const activity = await db('audit_log')
    .select('action', 'user_name', 'summary', 'created_at')
    .where((q) => q.where({ entity_type: 'user', entity_id: String(account.id) }).orWhere({ user_id: account.id }))
    .orderBy('id', 'desc')
    .limit(10);
  res.status(status).render('pages/portal/accounts/show.njk', {
    title: account.name,
    subheading: `${roleLabels[account.role]} · ${account.status === 'active' ? 'Active' : 'Deactivated'}`,
    crumbs,
    account,
    isSelf: req.isSelf,
    values: values || { name: account.name, email: account.email, phone: account.phone || '', role: account.role },
    errors,
    roleOptions: await roleOptions(req.user),
    canManage: req.canManage,
    activity,
    mfaRequired: await mfa.isRequiredFor(account),
    invitePending: account.must_change_password,
  });
}

router.get('/:id', (req, res) => renderShow(req, res));

router.post('/:id', manage('accounts.edit'), async (req, res) => {
  const account = req.account;
  const parsed = accountSchema.safeParse(req.body);
  const errors = parsed.success ? {} : fieldErrors(parsed.error);
  if (parsed.success) {
    if (await users.emailTaken(parsed.data.email, account.id)) errors.email = 'Another account already uses this email.';
    if (req.isSelf && parsed.data.role !== account.role) errors.role = 'You can’t change your own role. Ask another administrator.';
    else if (parsed.data.role !== account.role && (await roleProblem(req.user, parsed.data.role))) errors.role = await roleProblem(req.user, parsed.data.role);
    else if (await wouldRemoveLastAdmin(account, { newRole: parsed.data.role })) errors.role = 'This is the only active Admin. Make someone else an Admin first.';
  }
  if (Object.keys(errors).length) return renderShow(req, res, { values: req.body, errors, status: 422 });

  const updated = await users.update(account.id, parsed.data);
  const roleNames = await roles.labels();
  const changed = ['name', 'email', 'phone', 'role'].filter((k) => (account[k] || '') !== (updated[k] || ''));
  if (changed.length) {
    await audit(req, {
      action: changed.includes('role') ? 'account.role_change' : 'account.update',
      entityType: 'user',
      entityId: account.id,
      summary: changed.includes('role')
        ? `${req.user.name} changed ${updated.name}’s role from ${roleNames[account.role]} to ${roleNames[updated.role]}`
        : `${req.user.name} updated ${updated.name}’s details (${changed.join(', ')})`,
      metadata: Object.fromEntries(changed.map((k) => [k, { from: account[k], to: updated[k] }])),
    });
    // A new role or email takes effect at the next sign-in.
    if (changed.includes('role') || changed.includes('email')) await users.revokeSessions(account.id);
    if (changed.includes('role')) {
      await notifications.notifyUser(account.id, { type: 'security', title: `Your role is now ${roleNames[updated.role]}`, body: `Changed by ${req.user.name}.`, link: '/portal' });
    }
  }
  back(req, res, 'success', changed.length ? 'Account updated.' : 'No changes to save.');
});

// --- Access actions -------------------------------------------------------------

router.post('/:id/resend-invite', manage('accounts.edit'), async (req, res) => {
  if (!req.account.must_change_password || req.account.status !== 'active') return back(req, res, 'error', 'This person has already set up their account.');
  const sent = await sendInvite(req, req.account);
  await audit(req, { action: 'account.invite_resent', entityType: 'user', entityId: req.account.id, summary: `${req.user.name} resent the invitation to ${req.account.name}` });
  back(req, res, sent ? 'success' : 'warning', sent ? 'Invitation sent again. The previous link no longer works.' : 'The invitation email could not be sent. Check the email settings.');
});

router.post('/:id/send-reset', manage('accounts.edit'), async (req, res) => {
  if (req.account.status !== 'active') return back(req, res, 'error', 'Reactivate the account first.');
  const token = await tokens.issue(req.account.id, 'reset', req.ip);
  const result = await staffEmails.passwordReset(req.account, token);
  await users.revokeSessions(req.account.id);
  await audit(req, { action: 'account.reset_access', entityType: 'user', entityId: req.account.id, summary: `${req.user.name} sent ${req.account.name} a password reset link and signed them out` });
  back(req, res, result.ok ? 'success' : 'warning', result.ok
    ? `Password reset link emailed to ${req.account.email}. They’ve been signed out everywhere.`
    : 'They’ve been signed out, but the reset email could not be sent. Check the email settings.');
});

router.post('/:id/reset-two-step', manage('accounts.edit'), async (req, res) => {
  if (!req.account.mfa_enabled) return back(req, res, 'error', 'Two-step sign-in isn’t turned on for this account.');
  await mfa.disable(req.account.id);
  await users.revokeSessions(req.account.id);
  await audit(req, { action: 'account.reset_mfa', entityType: 'user', entityId: req.account.id, summary: `${req.user.name} reset two-step sign-in for ${req.account.name}` });
  await staffEmails.securityNotice(req.account, 'an administrator reset your two-step sign-in');
  await notifications.notifyUser(req.account.id, { type: 'security', title: 'Your two-step sign-in was reset', body: `Reset by ${req.user.name}.`, link: '/portal/account/two-step' });
  back(req, res, 'success', (await mfa.isRequiredFor(req.account))
    ? 'Two-step sign-in reset. They’ll set it up again the next time they sign in.'
    : 'Two-step sign-in has been turned off for this account.');
});

router.post('/:id/sign-out', manage('accounts.edit'), async (req, res) => {
  await users.revokeSessions(req.account.id);
  await audit(req, { action: 'account.sign_out', entityType: 'user', entityId: req.account.id, summary: `${req.user.name} signed ${req.account.name} out everywhere` });
  if (req.isSelf) return res.redirect(303, '/portal/login?ended=revoked');
  back(req, res, 'success', `${req.account.name} has been signed out on every device.`);
});

router.post('/:id/deactivate', manage('accounts.archive'), async (req, res) => {
  if (req.isSelf) return back(req, res, 'error', 'You can’t deactivate your own account.');
  if (req.account.status !== 'active') return back(req, res, 'error', 'This account is already deactivated.');
  if (await wouldRemoveLastAdmin(req.account, { newStatus: 'deactivated' })) return back(req, res, 'error', 'This is the only active Admin. Make someone else an Admin first.');
  await users.setStatus(req.account.id, 'deactivated');
  await tokens.revokeAll(req.account.id);
  await audit(req, { action: 'account.deactivate', entityType: 'user', entityId: req.account.id, summary: `${req.user.name} deactivated ${req.account.name}’s account` });
  back(req, res, 'success', `${req.account.name} can no longer sign in. Their history is kept.`);
});

router.post('/:id/reactivate', manage('accounts.archive'), async (req, res) => {
  if (req.account.status === 'active') return back(req, res, 'error', 'This account is already active.');
  await users.setStatus(req.account.id, 'active');
  await audit(req, { action: 'account.reactivate', entityType: 'user', entityId: req.account.id, summary: `${req.user.name} reactivated ${req.account.name}’s account` });
  back(req, res, 'success', `${req.account.name} can sign in again. Send a password reset link if they need one.`);
});

router.post('/:id/delete', manage('accounts.delete'), async (req, res) => {
  const account = req.account;
  if (req.isSelf) return back(req, res, 'error', 'You can’t delete your own account.');
  if (account.status !== 'deactivated') return back(req, res, 'error', 'Deactivate the account before deleting it permanently.');
  if (String(req.body.confirm || '').trim().toLowerCase() !== account.email) {
    return back(req, res, 'error', 'To delete permanently, type the account’s email address exactly.');
  }
  await audit(req, {
    action: 'account.delete',
    entityType: 'user',
    entityId: account.id,
    summary: `${req.user.name} permanently deleted ${account.name}’s account (${account.email})`,
    metadata: { email: account.email, role: account.role },
  });
  await users.remove(account.id);
  setFlash(req, 'success', `${account.name}’s account was permanently deleted. Audit history still shows their name.`);
  res.redirect(303, '/portal/accounts');
});

module.exports = router;
