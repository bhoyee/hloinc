'use strict';

const { z } = require('zod');
const { isIsoDate, marylandDateTime } = require('../lib/hours');

const time = z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a valid time.')]).optional().default('');

/** A link on the site ("/careers") or a secure web address ("https://…"). */
const link = z
  .string()
  .trim()
  .max(500, 'That link is too long.')
  .refine((v) => {
    if (v === '') return true;
    if (/^\/(?!\/)[^\s]*$/.test(v)) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && u.hostname.includes('.');
    } catch {
      return false;
    }
  }, 'Use a page on this site (like /careers) or a full link starting with https://')
  .optional()
  .default('');

const announcementSchema = z
  .object({
    title: z.string({ error: 'Enter a headline.' }).trim().min(3, 'Enter a headline.').max(160, 'Keep the headline under 160 characters.'),
    body: z.string({ error: 'Write the announcement.' }).trim().min(5, 'Write the announcement.').max(1000, 'Keep it under 1,000 characters. Short announcements get read.'),
    audience: z.enum(['public', 'internal', 'both'], { error: 'Choose who should see it.' }),
    start_date: z.string({ error: 'Choose a start date.' }).refine(isIsoDate, 'Choose a valid start date.'),
    start_time: time,
    end_date: z.union([z.literal(''), z.string().refine(isIsoDate, 'Choose a valid end date.')]).optional().default(''),
    end_time: time,
    link_url: link,
    link_label: z.string().trim().max(60, 'Keep the link text under 60 characters.').optional().default(''),
  })
  .transform((d) => ({
    ...d,
    starts_at: marylandDateTime(d.start_date, d.start_time || '00:00'),
    // No end time means "until the end of that day".
    ends_at: d.end_date ? marylandDateTime(d.end_date, d.end_time || '23:59') : null,
  }))
  .refine((d) => !d.ends_at || d.ends_at > d.starts_at, { message: 'The end must be after the start.', path: ['end_date'] });

/** The columns to save. */
function toRow(d) {
  return {
    title: d.title,
    body: d.body,
    audience: d.audience,
    starts_at: d.starts_at,
    ends_at: d.ends_at,
    link_url: d.link_url || null,
    link_label: d.link_url ? d.link_label || 'Learn more' : null,
  };
}

module.exports = { announcementSchema, toRow };
