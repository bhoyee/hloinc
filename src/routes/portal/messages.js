'use strict';

const { perPageFor, pagerFor } = require('../../lib/pager');

const { of: ref } = require('../../lib/reference');
const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const msgs = require('../../services/messages');
const notifications = require('../../services/notifications');
const { notify } = require('../../services/notify');
const config = require('../../config');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { setFlash } = require('../../lib/forms');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const inboxCrumbs = [...crumbs, { label: 'Messages', href: '/portal/messages' }];
const can = requirePermission;

const noteSchema = z.string().trim().min(1, 'Write a note first.').max(2000, 'Keep notes under 2,000 characters.');
const replySchema = z.string().trim().min(5, 'Write your reply first.').max(5000, 'Keep the reply under 5,000 characters.');

// --- List -------------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const tab = msgs.TABS[req.query.tab] ? req.query.tab : 'new';
  const filters = {
    q: str(req.query.q), type: str(req.query.type), recipient: str(req.query.recipient), mine: req.query.mine === '1' ? '1' : '',
    // From the dashboard's "Needs attention" links.
    unassigned: req.query.unassigned === '1' ? '1' : '', failed: req.query.failed === '1' ? '1' : '',
  };
  const perPage = await perPageFor(req);
  const result = await msgs.list(req.user, { tab, ...filters, mine: filters.mine === '1', unassigned: filters.unassigned === '1', failed: filters.failed === '1', page: req.query.page, perPage });
  const readIds = new Set(await require('../../db/knex')('message_reads').where({ user_id: req.user.id }).whereIn('message_id', result.items.map((m) => m.id)).pluck('message_id'));
  result.items = result.items.map((m) => ({ ...m, unread: !readIds.has(m.id) && !m.archived_at && m.status !== 'resolved' }));
  const pageUrl = (p) => `/portal/messages?${new URLSearchParams(Object.entries({ tab, ...filters, page: p > 1 ? p : '' }).filter(([, v]) => v))}`;
  const seeAll = req.user.permissions.has('messages.view');
  const mine = msgs.inboxesFor(req.user);
  const inboxNames = mine.map((k) => `“${msgs.RECIPIENT_LABELS[k]}”`);
  res.render('pages/portal/messages/index.njk', {
    title: 'Messages',
    subheading: seeAll
      ? 'Contact form messages, referrals and service requests from the website.'
      : `${inboxNames.length ? `Sent to ${inboxNames.join(' or ')} on the contact page` : 'Messages from the website'}${mine.includes('intake') ? ', referrals and service requests' : ''}, and ones assigned to you.`,
    crumbs,
    tab,
    filters,
    seeAll,
    tabs: Object.entries(msgs.TABS).map(([key, t]) => ({ key, label: t.label })),
    counts: await msgs.tabCounts(req.user),
    ...result,
    statusLabels: msgs.STATUS_LABELS,
    typeLabels: msgs.TYPE_LABELS,
    recipientLabels: msgs.RECIPIENT_LABELS,
    prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
    nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
    pager: pagerFor('/portal/messages', { tab, ...filters }, result, perPage),
  });
});

router.post('/read-all', async (req, res) => {
  const n = await require('../../services/badges').markAllRead(req.user);
  setFlash(req, 'success', n ? `Marked ${n} ${n === 1 ? 'message' : 'messages'} as read.` : 'Everything is already read.');
  res.redirect(303, typeof req.body.back === 'string' && req.body.back.startsWith('/portal/messages') ? req.body.back : '/portal/messages');
});

// --- One message ------------------------------------------------------------------------

router.param('id', async (req, res, next, id) => {
  // Outside this person's inbox looks the same as not existing.
  req.msg = /^\d+$/.test(id) ? await msgs.get(req.user, Number(id)) : null;
  if (!req.msg) {
    const err = new Error('That message doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

/** Opening a message shows personal details: record it (once per person per 30 minutes). */
async function auditView(req) {
  const recent = await db('audit_log')
    .where({ action: 'message.view', user_id: req.user.id, entity_type: 'message', entity_id: String(req.msg.id) })
    .where('created_at', '>', new Date(Date.now() - 30 * 60 * 1000))
    .first();
  if (!recent) {
    await audit(req, { action: 'message.view', entityType: 'message', entityId: req.msg.id, summary: `${req.user.name} viewed ${req.msg.type} ${ref(req.msg)} (${req.msg.name})` });
  }
}

async function renderShow(req, res, { values = {}, errors = {}, status = 200 } = {}) {
  const m = req.msg;
  res.status(status).render('pages/portal/messages/show.njk', {
    title: m.name,
    subheading: `${msgs.TYPE_LABELS[m.type]} to ${msgs.RECIPIENT_LABELS[m.recipient] || m.recipient}`,
    crumbs: inboxCrumbs,
    m,
    answers: msgs.detailRows(m),
    events: await msgs.events(m.id),
    staff: req.user.permissions.has('messages.edit') ? await msgs.assignableStaff() : [],
    statusLabels: msgs.STATUS_LABELS,
    typeLabels: msgs.TYPE_LABELS,
    recipientLabels: msgs.RECIPIENT_LABELS,
    values,
    errors,
  });
}

router.get('/:id', async (req, res) => {
  const badges = require('../../services/badges');
  await badges.markRead(req.msg.id, req.user.id);
  res.locals.navBadges = await badges.forUser(req.user); // so the menu counter drops on this page
  await auditView(req);
  await renderShow(req, res);
});

const back = (req, res, hash = '') => res.redirect(303, `/portal/messages/${req.msg.id}${hash}`);

router.post('/:id/status', can('messages.edit'), async (req, res) => {
  const status = Object.hasOwn(msgs.STATUS_LABELS, req.body.status) ? req.body.status : null;
  if (status && (await msgs.setStatus(req.msg, status, req.user))) {
    await audit(req, { action: 'message.status', entityType: 'message', entityId: req.msg.id, summary: `${req.user.name} marked ${req.msg.type} ${ref(req.msg)} as ${msgs.STATUS_LABELS[status].toLowerCase()}` });
    setFlash(req, 'success', `Marked as ${msgs.STATUS_LABELS[status].toLowerCase()}.`);
  }
  back(req, res);
});

router.post('/:id/assign', can('messages.edit'), async (req, res) => {
  const raw = req.body.assigned_to === 'me' ? String(req.user.id) : String(req.body.assigned_to || '');
  const staff = await msgs.assignableStaff();
  const assignee = raw ? staff.find((s) => String(s.id) === raw) : null;
  if (raw && !assignee) {
    setFlash(req, 'error', 'Choose someone who works from the messages inbox.');
    return back(req, res);
  }
  if (await msgs.assign(req.msg, assignee, req.user)) {
    await audit(req, { action: 'message.assign', entityType: 'message', entityId: req.msg.id, summary: `${req.user.name} ${assignee ? `assigned ${req.msg.type} ${ref(req.msg)} to ${assignee.name}` : `unassigned ${req.msg.type} ${ref(req.msg)}`}` });
    if (assignee && assignee.id !== req.user.id) {
      await notifications.notifyUser(assignee.id, {
        type: req.msg.type,
        title: `${req.user.name} assigned you a ${req.msg.type}`,
        body: `From ${req.msg.name}`,
        link: `/portal/messages/${req.msg.id}`,
      });
      const kind = msgs.TYPE_LABELS[req.msg.type].toLowerCase();
      await notify({
        to: assignee.email,
        subject: `${req.user.name} assigned you a ${kind} (${ref(req.msg)})`,
        text: [
          `Hello ${assignee.name.split(' ')[0]},`,
          '',
          `${req.user.name} assigned you a ${kind} from the website (${ref(req.msg)}). It’s now in your Messages inbox.`,
        ].join('\n'),
        cta: { label: 'Open it in the staff portal', href: `${config.appUrl}/portal/messages/${req.msg.id}` },
        footnote: 'Sent by the HLO staff portal. The details stay in the portal.',
      });
    }
    setFlash(req, 'success', assignee ? `Assigned to ${assignee.id === req.user.id ? 'you' : assignee.name}.` : 'Unassigned.');
    // Handed on a message they only saw because it was assigned to them.
    if (!(await msgs.get(req.user, req.msg.id))) return res.redirect(303, '/portal/messages');
  }
  back(req, res);
});

router.post('/:id/note', can('messages.edit'), async (req, res) => {
  const parsed = noteSchema.safeParse(req.body.note);
  if (!parsed.success) return renderShow(req, res, { values: req.body, errors: { note: parsed.error.issues[0].message }, status: 422 });
  await msgs.addEvent(req.msg.id, req.user, 'note', parsed.data);
  await audit(req, { action: 'message.note', entityType: 'message', entityId: req.msg.id, summary: `${req.user.name} added a note to ${req.msg.type} ${ref(req.msg)}` });
  setFlash(req, 'success', 'Note added.');
  back(req, res, '#history');
});

router.post('/:id/reply', can('messages.edit'), async (req, res) => {
  const parsed = replySchema.safeParse(req.body.reply);
  if (!parsed.success) return renderShow(req, res, { values: req.body, errors: { reply: parsed.error.issues[0].message }, status: 422 });
  const sent = await msgs.reply(req.msg, req.user, parsed.data);
  await audit(req, { action: 'message.reply', entityType: 'message', entityId: req.msg.id, summary: `${req.user.name} ${sent ? 'emailed a reply to' : 'tried to email a reply to'} ${req.msg.name} (${ref(req.msg)})` });
  setFlash(req, sent ? 'success' : 'error', sent ? `Reply emailed to ${req.msg.email}.` : `The reply couldn’t be emailed, so ${req.msg.name} hasn’t received it. It’s saved below; please try again later or call them.`);
  back(req, res, '#history');
});

router.post('/:id/resend', can('messages.edit'), async (req, res) => {
  const ok = await msgs.resendToTeam(req.msg);
  setFlash(req, ok ? 'success' : 'error', ok ? 'Email sent to the team inbox.' : 'The email still couldn’t be sent. Check the email settings, or ask IT.');
  back(req, res);
});

router.post('/:id/archive', can('messages.archive'), async (req, res) => {
  const archive = req.body.action !== 'restore';
  await msgs.setArchived(req.msg, archive);
  await audit(req, { action: archive ? 'message.archive' : 'message.restore', entityType: 'message', entityId: req.msg.id, summary: `${req.user.name} ${archive ? 'archived' : 'restored'} ${req.msg.type} ${ref(req.msg)} (${req.msg.name})` });
  setFlash(req, 'success', archive ? 'Archived. You can restore it from the Archived tab.' : 'Restored to the inbox.');
  back(req, res);
});

router.post('/:id/delete', can('messages.delete'), async (req, res) => {
  if (!req.msg.archived_at) {
    setFlash(req, 'error', 'Archive it first. Only archived messages can be deleted permanently.');
    return back(req, res);
  }
  await msgs.remove(req.msg);
  await audit(req, { action: 'message.delete', entityType: 'message', entityId: req.msg.id, summary: `${req.user.name} permanently deleted ${req.msg.type} ${ref(req.msg)} (${req.msg.name})` });
  setFlash(req, 'success', 'Deleted permanently.');
  res.redirect(303, '/portal/messages?tab=archived');
});

module.exports = router;
