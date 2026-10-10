'use strict';

const { z } = require('zod');
const { marylandParts, addDaysIso, isIsoDate } = require('../lib/hours');

const REASON_KEYS = ['vacation', 'sick', 'personal', 'training', 'other'];
const MAX_DAYS = 60;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time, like 09:00.');

/** A time-off request: whole days (one or several), or set hours on one day. */
const timeOffSchema = z
  .object({
    reason: z.enum(REASON_KEYS, { error: 'Choose a reason.' }),
    start_date: z.string().refine(isIsoDate, 'Choose the first day.'),
    end_date: z.string().optional().default(''),
    all_day: z.preprocess((v) => v === 'yes' || v === 'on' || v === true, z.boolean()),
    start_time: z.string().optional().default(''),
    end_time: z.string().optional().default(''),
    notes: z.string().trim().max(1000, 'Keep the note under 1,000 characters.').optional().default(''),
  })
  .superRefine((d, ctx) => {
    const today = marylandParts(new Date()).date;
    if (d.start_date < today) ctx.addIssue({ code: 'custom', path: ['start_date'], message: 'Choose today or a later day.' });
    if (d.all_day) {
      const end = d.end_date || d.start_date;
      if (!isIsoDate(end)) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'Choose the last day.' });
      else if (end < d.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'The last day can’t be before the first.' });
      else if (end > addDaysIso(d.start_date, MAX_DAYS - 1)) ctx.addIssue({ code: 'custom', path: ['end_date'], message: `Ask for up to ${MAX_DAYS} days at a time.` });
    } else {
      if (!time.safeParse(d.start_time).success) ctx.addIssue({ code: 'custom', path: ['start_time'], message: 'Enter a start time.' });
      if (!time.safeParse(d.end_time).success) ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'Enter an end time.' });
      else if (d.end_time <= d.start_time) ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'The end time must be after the start.' });
    }
  });

const decisionSchema = z.object({
  note: z.string().trim().max(500, 'Keep the note under 500 characters.').optional().default(''),
});

module.exports = { timeOffSchema, decisionSchema, REASON_KEYS, MAX_DAYS };
