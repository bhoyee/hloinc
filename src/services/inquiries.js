'use strict';

const db = require('../db/knex');
const { notify } = require('./notify');
const content = require('./content');
const { recipients } = require('../lib/site');
const notifications = require('./notifications');

const WINDOW_LABELS = { morning: 'Morning (9 a.m. – 12 p.m.)', afternoon: 'Afternoon (12 p.m. – 5 p.m.)' };

/**
 * Save a contact form message, then email it to the chosen recipient.
 * The message is kept even if email fails, so it still reaches the portal inbox.
 */
async function submitContact(data, { ip }) {
  const [id] = await db('contact_messages').insert({
    recipient: data.recipient,
    name: data.name,
    email: data.email,
    phone: data.phone || null,
    message: data.message,
    ip,
  });

  const recipient = recipients.find((r) => r.key === data.recipient);
  const to = await content.getRecipientEmail(data.recipient);
  const result = await notify({
    to,
    replyTo: data.email,
    subject: `Website message for ${recipient.label} from ${data.name}`,
    text: [
      `New message from the HLO website (reference #${id}).`,
      '',
      `To: ${recipient.label}`,
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Phone: ${data.phone || 'Not given'}`,
      '',
      data.message,
    ].join('\n'),
  });

  await db('contact_messages').where({ id }).update({ email_status: result.ok ? 'sent' : 'failed' });
  await notifications.notifyPermission(data.recipient === 'intake' ? ['messages.view', 'messages.view_intake'] : ['messages.view'], {
    type: 'message',
    title: `New message from ${data.name}`,
    body: `Sent to ${recipient.label} from the website.`,
  });
  return { id, emailed: result.ok };
}

/**
 * Save a referral into the intake inbox (type "referral") and email the intake
 * team. Like contact messages, it is kept even if the email fails.
 */
async function submitReferral(data, { ip, roleLabel, serviceNames }) {
  const details = {
    referrer_role: data.referrer_role,
    organization: data.organization || null,
    person_name: data.person_name,
    person_phone: data.person_phone || null,
    person_email: data.person_email || null,
    county: data.county,
    services: data.services,
  };

  const [id] = await db('contact_messages').insert({
    type: 'referral',
    recipient: 'intake',
    name: data.referrer_name,
    email: data.referrer_email,
    phone: data.referrer_phone || null,
    message: data.notes || '(No notes)',
    details: JSON.stringify(details),
    ip,
  });

  const result = await notify({
    to: await content.getRecipientEmail('intake'),
    replyTo: data.referrer_email,
    subject: `New referral #${id} from ${data.referrer_name}`,
    text: [
      `New referral from the HLO website (reference #${id}).`,
      '',
      'REFERRED BY',
      `Name: ${data.referrer_name}`,
      `Role: ${roleLabel}`,
      `Organization: ${data.organization || 'Not given'}`,
      `Email: ${data.referrer_email}`,
      `Phone: ${data.referrer_phone || 'Not given'}`,
      '',
      'PERSON BEING REFERRED',
      `Name: ${data.person_name}`,
      `County: ${data.county}`,
      `Phone: ${data.person_phone || 'Not given'}`,
      `Email: ${data.person_email || 'Not given'}`,
      `Services of interest: ${serviceNames.length ? serviceNames.join(', ') : 'Not sure yet'}`,
      '',
      `Notes: ${data.notes || 'None'}`,
      '',
      'The referrer confirmed the person knows about this referral.',
    ].join('\n'),
  });

  await db('contact_messages').where({ id }).update({ email_status: result.ok ? 'sent' : 'failed' });
  await notifications.notifyPermission(['messages.view', 'messages.view_intake'], {
    type: 'referral',
    title: `New referral for ${data.person_name}`,
    body: `From ${data.referrer_name} (${roleLabel}) · ${data.county}`,
  });
  return { id, emailed: result.ok };
}

/** Save a website appointment request (status Requested) and acknowledge it by email. */
async function submitAppointmentRequest(data, { ip }) {
  const type = await db('appointment_types').where({ id: data.type_id, active: true }).first();

  const [id] = await db('appointments').insert({
    type_id: data.type_id,
    source: 'website',
    status: 'requested',
    name: data.name,
    email: data.email,
    phone: data.phone || null,
    preferred_contact: data.preferred_contact,
    requested_date: data.requested_date,
    requested_window: data.requested_window,
    notes: data.notes || null,
    ip,
  });

  const business = await content.getBusiness();
  const when = `${formatDate(data.requested_date)}, ${WINDOW_LABELS[data.requested_window]}`;

  const [toVisitor, toStaff] = await Promise.all([
    notify({
      to: data.email,
      subject: 'We received your appointment request',
      text: [
        `Hello ${data.name},`,
        '',
        `Thank you for contacting ${business.legalName}. We received your request for: ${type.name}.`,
        `Preferred time: ${when}`,
        '',
        'This is not yet a confirmed appointment. A member of our team will contact you to confirm.',
        '',
        `If you need to reach us sooner, call ${business.phone} (${business.hours}).`,
        '',
        business.legalName,
      ].join('\n'),
    }),
    notify({
      to: await content.getRecipientEmail('intake'),
      replyTo: data.email,
      subject: `New appointment request #${id}: ${type.name}`,
      text: [
        `New appointment request from the website (reference #${id}).`,
        '',
        `Type: ${type.name}`,
        `Preferred: ${when}`,
        `Name: ${data.name}`,
        `Email: ${data.email}`,
        `Phone: ${data.phone || 'Not given'}`,
        `Contact by: ${data.preferred_contact}`,
        '',
        `Notes: ${data.notes || 'None'}`,
      ].join('\n'),
    }),
  ]);

  await notifications.notifyPermission('appointments.view', {
    type: 'appointment',
    title: `Appointment request: ${type.name}`,
    body: `${data.name} · ${when}`,
  });
  return { id, acknowledged: toVisitor.ok, staffNotified: toStaff.ok };
}

function formatDate(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

module.exports = { submitContact, submitReferral, submitAppointmentRequest, WINDOW_LABELS };
