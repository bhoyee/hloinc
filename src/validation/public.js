'use strict';

const { z } = require('zod');
const { recipients } = require('../lib/site');

const TIMEZONE = 'America/New_York';

const trimmed = (max, label) =>
  z
    .string({ error: `Enter your ${label}.` })
    .trim()
    .min(1, `Enter your ${label}.`)
    .max(max, `Keep your ${label} under ${max} characters.`);

const email = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address.')
  .max(191, 'Email address is too long.')
  .pipe(z.email('Enter a valid email address, like name@example.com.'));

const phone = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === '' || /^[+()\-.\s\d]{7,}$/.test(v) && v.replace(/\D/g, '').length >= 10, {
    message: 'Enter a valid phone number, like 410-555-0123.',
  });

const contactSchema = z.object({
  recipient: z.enum(
    recipients.map((r) => r.key),
    { error: 'Choose who you would like to contact.' }
  ),
  name: trimmed(120, 'name'),
  email,
  phone: phone.optional().default(''),
  message: z
    .string({ error: 'Enter your message.' })
    .trim()
    .min(10, 'Your message should be at least 10 characters.')
    .max(3000, 'Keep your message under 3,000 characters.'),
});

/** Today's date in Maryland as YYYY-MM-DD. */
function todayInMaryland(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function appointmentSchema(typeIds, now = new Date()) {
  const today = todayInMaryland(now);
  const earliest = addDays(today, 1);
  const latest = addDays(today, 90);

  return z
    .object({
      type_id: z.coerce
        .number({ error: 'Choose an appointment type.' })
        .int()
        .refine((id) => typeIds.includes(id), 'Choose an appointment type.'),
      name: trimmed(120, 'name'),
      email,
      phone: phone.optional().default(''),
      preferred_contact: z.enum(['email', 'phone'], { error: 'Choose how we should contact you.' }),
      requested_date: z
        .string({ error: 'Choose a preferred date.' })
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a preferred date.')
        .refine((d) => d >= earliest, 'Appointments must be requested at least one day in advance.')
        .refine((d) => d <= latest, 'Choose a date within the next 90 days.')
        .refine((d) => {
          const day = new Date(`${d}T12:00:00Z`).getUTCDay();
          return day !== 0 && day !== 6;
        }, 'Our office is open Monday to Friday. Choose a weekday.'),
      requested_window: z.enum(['morning', 'afternoon'], { error: 'Choose a preferred time of day.' }),
      notes: z.string().trim().max(1000, 'Keep notes under 1,000 characters.').optional().default(''),
      consent: z.literal('yes', { error: 'Please confirm you have read the privacy note.' }),
    })
    .refine((v) => v.preferred_contact !== 'phone' || v.phone !== '', {
      path: ['phone'],
      message: 'Enter a phone number so we can call you.',
    });
}

module.exports = { contactSchema, appointmentSchema, todayInMaryland, addDays };
