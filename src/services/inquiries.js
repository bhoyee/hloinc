'use strict';

const db = require('../db/knex');
const { notify } = require('./notify');
const content = require('./content');
const { recipients } = require('../lib/site');
const notifications = require('./notifications');
const services = require('../content/services');
const { OPTIONS, REFERRER_ROLES } = require('../validation/public');
const config = require('../config');
const { insertWithReference } = require('../lib/reference');
const leads = require('./leads');

/** Link a submission to its lead. Never lets a problem here lose the submission itself. */
async function linkLead(fn, id, data) {
  try {
    await fn(id, data);
  } catch (err) {
    console.error('Could not link submission to a lead:', err.message);
  }
}

const WINDOW_LABELS = { morning: 'Morning (9 a.m. – 12 p.m.)', afternoon: 'Afternoon (12 p.m. – 5 p.m.)' };

// Emails to the team link straight to the item in the staff portal.
const TEAM_NOTE = 'Sent automatically by the HLO website. Reply to this email to answer the sender directly.';
const portalButton = (path) => ({ label: 'Open in the staff portal', href: `${config.appUrl}${path}` });

// Confirmations to visitors echo only what is needed to recognise the request:
// email is not a secure channel, so eligibility and plan details stay out.
const CONFIRMATION_NOTE = 'This is an automatic confirmation. To add anything, reply to this email or call us.';
const sooner = (business) => `If you need to reach us sooner, call ${business.phone} (${business.hours}). For a life-threatening emergency, call 911.`;

/**
 * Save a contact form message, then email it to the chosen recipient.
 * The message is kept even if email fails, so it still reaches the portal inbox.
 */
async function submitContact(data, { ip }) {
  const { id, reference } = await insertWithReference(db, 'contact_messages', {
    recipient: data.recipient,
    name: data.name,
    email: data.email,
    phone: data.phone || null,
    message: data.message,
    ip,
  }, 'message');
  await linkLead(leads.attachMessage, id, data);

  const recipient = recipients.find((r) => r.key === data.recipient);
  const to = await content.getRecipientEmail(data.recipient);
  const business = await content.getBusiness();
  const [result, toVisitor] = await Promise.all([notify({
    to,
    replyTo: data.email,
    subject: `Website message ${reference} for ${recipient.label} from ${data.name}`,
    cta: portalButton(`/portal/messages/${id}`),
    footnote: TEAM_NOTE,
    text: [
      `New message from the HLO website (reference ${reference}).`,
      '',
      `To: ${recipient.label}`,
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Phone: ${data.phone || 'Not given'}`,
      '',
      data.message,
    ].join('\n'),
  }),
  notify({
    to: data.email,
    replyTo: to,
    subject: 'We received your message',
    text: [
      `Hello ${data.name},`,
      '',
      `Thank you for contacting ${business.legalName}. Your message has reached our team (${recipient.label}), and we will reply as soon as we can during office hours.`,
      '',
      'YOUR MESSAGE',
      `Reference: ${reference}`,
      `Sent to: ${recipient.label}`,
      '',
      sooner(business),
      '',
      'Warm regards,',
      `The ${business.legalName} team`,
    ].join('\n'),
    footnote: CONFIRMATION_NOTE,
  })]);

  await db('contact_messages').where({ id }).update({ email_status: result.ok ? 'sent' : 'failed' });
  await notifications.notifyPermission(data.recipient === 'intake' ? ['messages.view', 'messages.view_intake'] : ['messages.view'], {
    type: 'message',
    title: `New message from ${data.name}`,
    body: `Sent to ${recipient.label} from the website.`,
    link: `/portal/messages/${id}`,
  });
  return { id, reference, emailed: result.ok, acknowledged: toVisitor.ok };
}

const label = (list, key) => (key && list[key]) || 'Not given';
const serviceNames = (slugs) => {
  const names = services.filter((s) => slugs.includes(s.slug)).map((s) => s.name);
  return names.length ? names.join(', ') : 'Not sure yet';
};

/**
 * Save a referral into the intake inbox (type "referral") and email the intake
 * team. Like contact messages, it is kept even if the email fails.
 */
async function submitReferral(data, { ip }) {
  const details = {
    referrer_role: data.referrer_role,
    organization: data.organization || null,
    person_name: data.person_name,
    county: data.county,
    living_situation: data.living_situation || null,
    dda_eligibility: data.dda_eligibility || null,
    priority_category: data.priority_category || null,
    pcp: data.pcp || null,
    services: data.services,
    timeline: data.timeline || null,
  };
  const roleLabel = REFERRER_ROLES[data.referrer_role];

  const { id, reference } = await insertWithReference(db, 'contact_messages', {
    type: 'referral',
    recipient: 'intake',
    name: data.referrer_name,
    email: data.referrer_email,
    phone: data.referrer_phone || null,
    message: data.notes || '(No additional information)',
    details: JSON.stringify(details),
    ip,
  }, 'referral');
  await linkLead(leads.attachReferral, id, data);

  const business = await content.getBusiness();
  const intake = await content.getRecipientEmail('intake');
  const [result, toReferrer] = await Promise.all([notify({
    to: intake,
    replyTo: data.referrer_email,
    subject: `New referral ${reference} from ${data.referrer_name}`,
    cta: portalButton(`/portal/messages/${id}`),
    footnote: TEAM_NOTE,
    text: [
      `New referral from the HLO website (reference ${reference}).`,
      '',
      'REFERRED BY',
      `Name: ${data.referrer_name}`,
      `Role: ${roleLabel}`,
      `Agency or organization: ${data.organization || 'Not given'}`,
      `Phone: ${data.referrer_phone}`,
      `Email: ${data.referrer_email}`,
      '',
      'PERSON BEING REFERRED',
      `First name or initials: ${data.person_name}`,
      `County: ${data.county}`,
      `Current living situation: ${label(OPTIONS.livingSituation, data.living_situation)}`,
      `DDA eligibility: ${label(OPTIONS.ddaEligibility, data.dda_eligibility)}`,
      `DDA funding priority: ${label(OPTIONS.priority, data.priority_category)}`,
      `Person-Centered Plan: ${label(OPTIONS.pcp, data.pcp)}`,
      `Services needed: ${serviceNames(data.services)}`,
      `How soon: ${label(OPTIONS.timeline, data.timeline)}`,
      '',
      `Additional information: ${data.notes || 'None'}`,
      '',
      'The referrer confirmed they are authorized to share this information.',
    ].join('\n'),
  }),
  notify({
    to: data.referrer_email,
    replyTo: intake,
    subject: 'Thank you for your referral',
    text: [
      `Hello ${data.referrer_name},`,
      '',
      `Thank you for referring someone to ${business.legalName}. Your referral has reached our intake team.`,
      '',
      'YOUR REFERRAL',
      `Reference: ${reference}`,
      `Person referred: ${data.person_name}`,
      `County: ${data.county}`,
      `Services needed: ${serviceNames(data.services)}`,
      '',
      'WHAT HAPPENS NEXT',
      '',
      '- Our intake team reviews the referral.',
      `- We contact you at ${data.referrer_phone} or by email to talk it through.`,
      '- Together with the person, their family and their coordinator, we look at how our services could fit.',
      '',
      sooner(business),
      '',
      'Warm regards,',
      `The ${business.legalName} intake team`,
    ].join('\n'),
    footnote: CONFIRMATION_NOTE,
  })]);

  await db('contact_messages').where({ id }).update({ email_status: result.ok ? 'sent' : 'failed' });
  await notifications.notifyPermission(['messages.view', 'messages.view_intake'], {
    type: 'referral',
    title: `New referral for ${data.person_name}`,
    body: `From ${data.referrer_name} (${roleLabel}) · ${data.county}`,
    link: `/portal/messages/${id}`,
  });
  return { id, reference, emailed: result.ok, acknowledged: toReferrer.ok };
}

/**
 * Save a "Request services" form (individuals and families) into the intake
 * inbox (type "request"), email the intake team and acknowledge the visitor.
 */
async function submitRequest(data, { ip }) {
  const name = `${data.first_name} ${data.last_name}`;
  const details = {
    first_name: data.first_name,
    last_name: data.last_name,
    preferred_contact: data.preferred_contact,
    best_time: data.best_time,
    relationship: data.relationship,
    individual_first_name: data.individual_first_name || null,
    county: data.county || null,
    dda_eligibility: data.dda_eligibility || null,
    pcp: data.pcp || null,
    priority_category: data.priority_category || null,
    services: data.services,
  };

  const { id, reference } = await insertWithReference(db, 'contact_messages', {
    type: 'request',
    recipient: 'intake',
    name,
    email: data.email,
    phone: data.phone,
    message: data.message || '(No message)',
    details: JSON.stringify(details),
    ip,
  }, 'request');
  await linkLead(leads.attachRequest, id, data);

  const business = await content.getBusiness();
  const [toTeam, toVisitor] = await Promise.all([
    notify({
      to: await content.getRecipientEmail('intake'),
      replyTo: data.email,
      subject: `New service request ${reference} from ${name}`,
      cta: portalButton(`/portal/messages/${id}`),
      footnote: TEAM_NOTE,
      text: [
        `New request for services from the HLO website (reference ${reference}).`,
        '',
        'CONTACT',
        `Name: ${name}`,
        `Phone: ${data.phone}`,
        `Email: ${data.email}`,
        `Prefers: ${data.preferred_contact === 'email' ? 'Email' : 'Phone'}`,
        `Best time to call: ${label(OPTIONS.bestTime, data.best_time)}`,
        '',
        'THE PERSON WHO NEEDS SUPPORT',
        `Relationship: ${label(OPTIONS.relationship, data.relationship)}`,
        `First name: ${data.individual_first_name || 'Not given'}`,
        `County: ${data.county || 'Not given'}`,
        `DDA eligibility: ${label(OPTIONS.ddaEligibility, data.dda_eligibility)}`,
        `Person-Centered Plan: ${label(OPTIONS.pcp, data.pcp)}`,
        `DDA funding priority: ${label(OPTIONS.priority, data.priority_category)}`,
        `Services of interest: ${serviceNames(data.services)}`,
        '',
        `Anything else: ${data.message || 'None'}`,
      ].join('\n'),
    }),
    notify({
      to: data.email,
      replyTo: await content.getRecipientEmail('intake'),
      subject: 'We received your request for services',
      text: [
        `Hello ${data.first_name},`,
        '',
        `Thank you for reaching out to ${business.legalName}. We have received your request for services, and a member of our intake team will be in touch.`,
        '',
        'YOUR REQUEST',
        `Reference: ${reference}`,
        `Services of interest: ${serviceNames(data.services)}`,
        `We will contact you by: ${data.preferred_contact === 'email' ? `Email (${data.email})` : `Phone (${data.phone})`}`,
        `Best time: ${label(OPTIONS.bestTime, data.best_time)}`,
        '',
        'WHAT HAPPENS NEXT',
        '',
        '- Our intake team reviews your request.',
        `- We ${data.preferred_contact === 'email' ? 'email' : 'call'} you to learn about the person, answer your questions and explain how our services could fit.`,
        '- If it is a good fit, we work with you and your Coordinator of Community Services on the next steps.',
        '',
        'You do not need to have every answer ready. We will go through it together.',
        '',
        sooner(business),
        '',
        'Warm regards,',
        `The ${business.legalName} intake team`,
      ].join('\n'),
      cta: { label: 'Learn about our services', href: `${config.appUrl}/services` },
      footnote: CONFIRMATION_NOTE,
    }),
  ]);

  await db('contact_messages').where({ id }).update({ email_status: toTeam.ok ? 'sent' : 'failed' });
  await notifications.notifyPermission(['messages.view', 'messages.view_intake'], {
    type: 'request',
    title: `New service request from ${name}`,
    body: `${label(OPTIONS.relationship, data.relationship)}${data.county ? ` · ${data.county}` : ''}`,
    link: `/portal/messages/${id}`,
  });
  return { id, reference, emailed: toTeam.ok, acknowledged: toVisitor.ok };
}

/** Save a website appointment request (status Requested) and acknowledge it by email. */
async function submitAppointmentRequest(data, { ip }) {
  const type = await db('appointment_types').where({ id: data.type_id, active: true }).first();

  const { id, reference } = await insertWithReference(db, 'appointments', {
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
  }, 'appointment');
  await linkLead(leads.attachAppointment, id, data);

  const business = await content.getBusiness();
  const when = `${formatDate(data.requested_date)}, ${WINDOW_LABELS[data.requested_window]}`;

  const [toVisitor, toStaff] = await Promise.all([
    notify({
      to: data.email,
      subject: 'We received your appointment request',
      text: [
        `Hello ${data.name},`,
        '',
        `Thank you for contacting ${business.legalName}. We have received your appointment request.`,
        '',
        'YOUR REQUEST',
        `Reference: ${reference}`,
        `Appointment: ${type.name}`,
        `Preferred time: ${when}`,
        '',
        'This is not yet a confirmed appointment. A member of our team will contact you to confirm a date and time.',
        '',
        sooner(business),
        '',
        'Warm regards,',
        `The ${business.legalName} team`,
      ].join('\n'),
      footnote: CONFIRMATION_NOTE,
    }),
    notify({
      to: await content.getRecipientEmail('intake'),
      replyTo: data.email,
      subject: `New appointment request ${reference}: ${type.name}`,
      cta: portalButton(`/portal/appointments/${id}`),
      footnote: TEAM_NOTE,
      text: [
        `New appointment request from the website (reference ${reference}).`,
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
  return { id, reference, acknowledged: toVisitor.ok, staffNotified: toStaff.ok };
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

module.exports = { submitContact, submitReferral, submitRequest, submitAppointmentRequest, WINDOW_LABELS };
