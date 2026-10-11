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

/** "20261008T133000Z", for calendar links. */
const calendarStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * The reminder the day before: a branded email with the time in a highlighted
 * card, the details, what to bring, an "Add to Google Calendar" button and
 * directions. Plain text goes along for mail programs that don't show HTML.
 */
async function reminder(appt) {
  if (!appt.email) return { ok: false, error: 'No email address' };
  const { escape, linkify } = require('../lib/emailLayout');
  const { b, lines } = await footer();
  const address = lines[2];
  const minutes = appt.duration_minutes || appt.type_duration || 30;
  const start = new Date(appt.scheduled_at);
  const end = new Date(start.getTime() + minutes * 60000);
  const fmt = (d, opts) => d.toLocaleString('en-US', { timeZone: 'America/New_York', ...opts });
  const day = fmt(start, { weekday: 'long', month: 'long', day: 'numeric' });
  const time = (d) => fmt(d, { hour: 'numeric', minute: '2-digit' }).replace('AM', 'a.m.').replace('PM', 'p.m.');
  const hours = `${time(start)} – ${time(end)}`;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.legalName}, ${address}`)}`;
  const calendar = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE',
    text: `${appt.type_name} with ${b.legalName}`,
    dates: `${calendarStamp(start)}/${calendarStamp(end)}`,
    details: `${appt.reference ? `Reference ${appt.reference}. ` : ''}To change or cancel, call ${b.phone}.`,
    location: address,
  })}`;
  const first = String(appt.name || '').split(' ')[0] || 'there';
  const details = [
    ['Appointment', appt.type_name],
    ['Length', `About ${minutes} minutes`],
    ...(appt.assigned_name ? [['You’ll meet', appt.assigned_name.split(' ')[0]]] : []),
    ['Where', address],
    ...(appt.reference ? [['Reference', appt.reference]] : []),
  ];
  const bring = ['Please arrive about 10 minutes early.', 'Bring a photo ID, and any letters or paperwork you’d like to talk about.', 'You’re welcome to bring a family member or someone who supports you.'];

  const C = { brand: '#0f6b4a', soft: '#edf8f3', ink: '#0f1c16', muted: '#475950', line: '#dfe8e3', accent: '#c41a22' };
  const p = (html, extra = '') => `<p style="margin:0 0 16px;color:${C.ink};font-size:15px;line-height:1.65;${extra}">${html}</p>`;
  const bodyHtml = [
    p(`Hello ${escape(first)},`),
    p(`This is a friendly reminder of your appointment with ${escape(b.legalName)} <strong>tomorrow</strong>. We look forward to seeing you.`),
    // The time, front and centre.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;border-collapse:separate;background:${C.soft};border-radius:14px;border-left:5px solid ${C.brand}">
      <tr><td style="padding:20px 22px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.brand}">Tomorrow</p>
        <p style="margin:0;font-size:22px;line-height:1.3;font-weight:800;color:${C.ink}">${escape(day)}</p>
        <p style="margin:4px 0 0;font-size:18px;line-height:1.4;font-weight:600;color:${C.ink}">${escape(hours)}</p>
      </td></tr>
    </table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid ${C.line};border-radius:10px;border-collapse:separate;background:#ffffff">${details
      .map(([k, v], i) => `<tr><td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ''}color:${C.muted};font-size:14px;width:36%;vertical-align:top">${escape(k)}</td><td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ''}color:${C.ink};font-size:14px;font-weight:600;vertical-align:top">${k === 'Where' ? `${escape(v)}<br><a href="${escape(maps)}" style="color:${C.brand};font-weight:600;font-size:13px">Get directions &rarr;</a>` : escape(v)}</td></tr>`)
      .join('')}</table>`,
    `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.accent}">Before you come</p>`,
    `<ul style="margin:0 0 22px;padding-left:20px;color:${C.ink};font-size:15px;line-height:1.6">${bring.map((x) => `<li style="margin:0 0 6px">${escape(x)}</li>`).join('')}</ul>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="border-radius:999px;background:${C.brand}"><a href="${escape(calendar)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">Add to Google Calendar</a></td></tr></table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:separate;border:1px solid ${C.line};border-radius:12px"><tr><td style="padding:14px 18px;color:${C.ink};font-size:14px;line-height:1.6"><strong>Need to change or cancel?</strong><br>Please call us at ${linkify(b.phone)} (${escape(b.hours)}) so we can offer the time to someone else.</td></tr></table>`,
    p(`Warm regards,<br>The ${escape(b.legalName)} team`),
  ].join('\n');

  return notify({
    to: appt.email,
    subject: `Reminder: your appointment tomorrow at ${time(start)}`,
    html: bodyHtml,
    text: [
      `Hello ${first},`,
      '',
      `This is a friendly reminder of your appointment with ${b.legalName} tomorrow.`,
      '',
      'YOUR APPOINTMENT',
      `When: ${day}, ${hours}`,
      ...details.map(([k, v]) => `${k}: ${v}`),
      `Directions: ${maps}`,
      '',
      'BEFORE YOU COME',
      ...bring.map((x) => `- ${x}`),
      '',
      `Add it to your calendar: ${calendar}`,
      '',
      `Need to change or cancel? Please call us at ${b.phone} (${b.hours}).`,
      '',
      'Warm regards,',
      `The ${b.legalName} team`,
    ].join('\n'),
    footnote: `You are receiving this reminder because you have an appointment with ${b.legalName.replace(/\.$/, '')}.`,
  });
}

module.exports = { confirmed, cancelled, reminder, when };
