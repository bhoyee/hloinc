'use strict';

const { notify } = require('./notify');
const content = require('./content');

/** "Thursday, October 8, 2026 at 9:30 a.m." in Maryland time. */
function when(date) {
  const d = new Date(date);
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace('AM', 'a.m.').replace('PM', 'p.m.');
  return `${day} at ${time}`;
}

async function footer() {
  const b = await content.getBusiness();
  const address = [b.address.street, `${b.address.city}, ${b.address.state} ${b.address.zip}`.trim()].join(', ');
  return { b, lines: ['', `${b.legalName}`, address, `${b.phone} · ${b.hours}`] };
}

/** Emails to the visitor (branded by notify) (requirements §5.1: email only, no SMS). */
async function confirmed(appt, { rescheduled = false, message = '' } = {}) {
  if (!appt.email) return { ok: false, error: 'No email address' };
  const { b, lines } = await footer();
  return notify({
    to: appt.email,
    subject: rescheduled ? `Your appointment has changed: ${when(appt.scheduled_at)}` : `Appointment confirmed: ${when(appt.scheduled_at)}`,
    text: [
      `Hello ${appt.name},`,
      '',
      rescheduled ? `Your appointment with ${b.legalName} has a new time.` : `Your appointment with ${b.legalName} is confirmed.`,
      '',
      'YOUR APPOINTMENT',
      ...(appt.reference ? [`Reference: ${appt.reference}`] : []),
      `Appointment: ${appt.type_name}`,
      `Date and time: ${when(appt.scheduled_at)}`,
      `Length: About ${appt.duration_minutes || 30} minutes`,
      `Where: ${lines[2]}`,
      '',
      ...(message ? [message, ''] : []),
      `If you need to change or cancel, please call us at ${b.phone}.`,
      '',
      'Warm regards,',
      `The ${b.legalName} team`,
    ].join('\n'),
  });
}

async function cancelled(appt, { reason = '' } = {}) {
  if (!appt.email) return { ok: false, error: 'No email address' };
  const { b, lines } = await footer();
  return notify({
    to: appt.email,
    subject: 'Your HLO appointment has been cancelled',
    text: [
      `Hello ${appt.name},`,
      '',
      appt.scheduled_at ? 'Your appointment has been cancelled.' : 'Your request for an appointment has been cancelled.',
      '',
      'CANCELLED',
      ...(appt.reference ? [`Reference: ${appt.reference}`] : []),
      `Appointment: ${appt.type_name}`,
      ...(appt.scheduled_at ? [`Was booked for: ${when(appt.scheduled_at)}`] : []),
      ...(reason ? ['', reason] : []),
      '',
      `To arrange a new time, call us at ${b.phone} or request an appointment on our website.`,
      '',
      'Warm regards,',
      `The ${b.legalName} team`,
    ].join('\n'),
  });
}

module.exports = { confirmed, cancelled, when };
