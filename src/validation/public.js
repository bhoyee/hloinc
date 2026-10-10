'use strict';

const { z } = require('zod');
const { phoneField } = require('./phone');
const { recipients } = require('../lib/site');
const services = require('../content/services');
const areas = require('../content/areas');

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

const phone = phoneField();

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

/** Who is making a referral (HLO's list, October 2026). */
const REFERRER_ROLES = {
  ccs: 'Coordinator of Community Services',
  family: 'Family member',
  guardian: 'Guardian',
  case_manager: 'Case manager or social worker',
  hospital: 'Hospital or discharge planner',
  school: 'School or transition program',
  other: 'Other',
};

/** Answer lists shared by the referral and request-services forms (HLO's wording). */
const OPTIONS = {
  relationship: {
    self: 'I am seeking services for myself',
    family: 'Parent or family member',
    guardian: 'Guardian',
    coordinator: 'Support coordinator',
    other: 'Other',
  },
  bestTime: { any: 'Any time, 9am – 5pm', morning: 'Morning, 9am – noon', afternoon: 'Afternoon, noon – 5pm' },
  ddaEligibility: { eligible: 'Eligible', in_progress: 'Application in progress', not_sure: 'Not sure' },
  pcp: { completed: 'Completed', in_progress: 'In progress', not_started: 'Not started yet', not_sure: 'Not sure' },
  priority: { cr: 'Crisis Resolution (CR)', cp: 'Crisis Prevention (CP)', other: 'Another category', not_sure: 'Not sure' },
  livingSituation: {
    family_home: 'Family home',
    own_home: 'Own home or apartment',
    other_provider: 'Another residential provider',
    facility: 'Hospital or facility',
    other: 'Other',
  },
  timeline: { asap: 'As soon as possible', '30_days': 'Within 30 days', '1_3_months': 'Within 1–3 months', planning: 'Planning ahead' },
};

/** An optional choice from one of the lists above ('' = not answered). */
const optionalChoice = (list) => z.union([z.literal(''), z.enum(Object.keys(list))], { error: 'Choose from the list.' }).optional().default('');

const COUNTIES = [...areas.flatMap((a) => a.counties), 'Other / not sure'];

/** Checkbox groups arrive as a string (one ticked), an array (several) or nothing. */
const checkboxList = (allowed) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]),
    z.array(z.enum(allowed, { error: 'Choose from the listed services.' })).max(allowed.length)
  );

const referralSchema = z.object({
  referrer_name: trimmed(120, 'name'),
  organization: z.string().trim().max(160, 'Keep the agency or organization name under 160 characters.').optional().default(''),
  referrer_role: z.enum(Object.keys(REFERRER_ROLES), { error: 'Choose your role.' }),
  referrer_phone: phone,
  referrer_email: email,
  person_name: z
    .string({ error: 'Enter the person’s first name or initials.' })
    .trim()
    .min(1, 'Enter the person’s first name or initials.')
    .max(60, 'A first name or initials is enough here.'),
  county: z.enum(COUNTIES, { error: 'Choose the county where the person lives.' }),
  living_situation: optionalChoice(OPTIONS.livingSituation),
  dda_eligibility: optionalChoice(OPTIONS.ddaEligibility),
  priority_category: optionalChoice(OPTIONS.priority),
  pcp: optionalChoice(OPTIONS.pcp),
  services: checkboxList(services.map((s) => s.slug)),
  timeline: optionalChoice(OPTIONS.timeline),
  notes: z.string().trim().max(1500, 'Keep the additional information under 1,500 characters.').optional().default(''),
  consent: z.literal('yes', { error: 'Please confirm you are authorized to share this information.' }),
});

/** "Request services": for individuals and families (HLO's form, October 2026). */
const requestSchema = z
  .object({
    first_name: trimmed(60, 'first name'),
    last_name: trimmed(60, 'last name'),
    phone,
    email,
    preferred_contact: z.enum(['phone', 'email'], { error: 'Choose how you prefer to be contacted.' }).default('phone'),
    best_time: z.enum(Object.keys(OPTIONS.bestTime), { error: 'Choose the best time to call.' }),
    relationship: z.enum(Object.keys(OPTIONS.relationship), { error: 'Choose your relationship to the person.' }),
    individual_first_name: z.string().trim().max(60, 'A first name is enough here.').optional().default(''),
    county: z.union([z.literal(''), z.enum(COUNTIES)], { error: 'Choose a county from the list.' }).optional().default(''),
    dda_eligibility: optionalChoice(OPTIONS.ddaEligibility),
    pcp: optionalChoice(OPTIONS.pcp),
    priority_category: optionalChoice(OPTIONS.priority),
    services: checkboxList(services.map((s) => s.slug)),
    message: z.string().trim().max(1500, 'Keep this under 1,500 characters.').optional().default(''),
    consent: z.literal('yes', { error: 'Please confirm the information is correct and we may contact you.' }),
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

module.exports = { contactSchema, appointmentSchema, referralSchema, requestSchema, REFERRER_ROLES, OPTIONS, COUNTIES, todayInMaryland, addDays };
