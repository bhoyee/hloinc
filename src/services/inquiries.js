'use strict';

const db = require('../db/knex');
const { notify } = require('./notify');
const content = require('./content');
const { recipients } = require('../lib/site');

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

module.exports = { submitContact, submitAppointmentRequest, WINDOW_LABELS };
