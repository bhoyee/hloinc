'use strict';

const { z } = require('zod');
const { isIsoDate } = require('../lib/hours');

const date = z.string({ error: 'Choose a date.' }).refine(isIsoDate, 'Choose a valid date.');
const time = z.string({ error: 'Choose a time.' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid time.');
const duration = z.coerce
  .number({ error: 'Enter the length in minutes.' })
  .int('Use whole minutes.')
  .min(5, 'At least 5 minutes.')
  .max(480, 'At most 8 hours.');
const optionalId = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().positive().nullable());
const staffNotes = z.string().trim().max(2000, 'Keep notes under 2,000 characters.').optional().default('');
const yes = z.literal('yes').optional();

/** Confirm a request, or change the time of a confirmed appointment. */
const scheduleSchema = z.object({
  date,
  time,
  duration_minutes: duration,
  assigned_to: optionalId,
  message: z.string().trim().max(500, 'Keep the message under 500 characters.').optional().default(''),
  notify: yes, // email the visitor
  override: yes, // book anyway despite capacity / office hours
});

const phoneOrEmpty = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === '' || (/^[+()\-.\s\d]{7,}$/.test(v) && v.replace(/\D/g, '').length >= 10), 'Enter a valid phone number.')
  .optional()
  .default('');

const emailOrEmpty = z
  .string()
  .trim()
  .toLowerCase()
  .max(191)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address.')
  .optional()
  .default('');

/** Walk-in or phone appointment logged by staff. */
const logSchema = z
  .object({
    source: z.enum(['walk_in', 'phone'], { error: 'Choose walk-in or phone.' }),
    type_id: z.coerce.number({ error: 'Choose an appointment type.' }).int().positive('Choose an appointment type.'),
    name: z.string({ error: 'Enter the person’s name.' }).trim().min(1, 'Enter the person’s name.').max(120),
    phone: phoneOrEmpty,
    email: emailOrEmpty,
    date,
    time,
    duration_minutes: duration,
    assigned_to: optionalId,
    notes: z.string().trim().max(1000, 'Keep the reason under 1,000 characters.').optional().default(''),
    staff_notes: staffNotes,
    notify: yes,
    override: yes,
  })
  .refine((v) => v.notify !== 'yes' || v.email !== '', { path: ['email'], message: 'Add an email address to send a confirmation.' });

const cancelSchema = z.object({
  reason: z.string().trim().max(255, 'Keep the reason under 255 characters.').optional().default(''),
  notify: yes,
});

const notesSchema = z.object({ staff_notes: staffNotes });

const typeSchema = z.object({
  name: z.string({ error: 'Enter a name.' }).trim().min(2, 'Enter a name.').max(120),
  description: z.string().trim().max(500).optional().default(''),
  duration_minutes: duration,
  capacity: z.coerce.number({ error: 'Enter how many can happen at once.' }).int().min(1, 'At least 1.').max(50, 'At most 50.'),
  active: yes,
  sort_order: z.coerce.number().int().min(0).max(999).optional().default(0),
});

/** A shift or time-off entry on the staff schedule. */
const shiftSchema = z
  .object({
    user_id: z.coerce.number({ error: 'Choose a staff member.' }).int().positive('Choose a staff member.'),
    kind: z.enum(['shift', 'time_off'], { error: 'Choose shift or time off.' }),
    date,
    all_day: yes,
    start_time: z.string().optional().default(''),
    end_time: z.string().optional().default(''),
    label: z.string().trim().max(80, 'Keep the label under 80 characters.').optional().default(''),
    location: z.string().trim().max(120, 'Keep the location under 120 characters.').optional().default(''),
    notes: z.string().trim().max(500, 'Keep notes under 500 characters.').optional().default(''),
    repeat_weeks: z.coerce.number().int().min(1).max(12, 'Repeat for at most 12 weeks.').optional().default(1),
  })
  .superRefine((v, ctx) => {
    if (v.all_day === 'yes') return;
    const t = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!t.test(v.start_time)) ctx.addIssue({ code: 'custom', path: ['start_time'], message: 'Choose a start time.' });
    if (!t.test(v.end_time)) ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'Choose an end time.' });
    if (v.start_time === v.end_time) ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'The end time must be different from the start.' });
  });

module.exports = { scheduleSchema, logSchema, cancelSchema, notesSchema, typeSchema, shiftSchema };
