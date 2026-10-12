'use strict';

const { z } = require('zod');
const { phoneField } = require('./phone');

const name = (label) =>
  z.string({ error: `Enter your ${label}.` }).trim().min(1, `Enter your ${label}.`).max(80, `Keep your ${label} under 80 characters.`);

/** The job application form (the resume file is checked separately, in services/applications). */
const applicationSchema = z.object({
  first_name: name('first name'),
  last_name: name('last name'),
  email: z
    .string({ error: 'Enter your email address.' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your email address.')
    .max(191, 'Email address is too long.')
    .pipe(z.email('Enter a valid email address, like name@example.com.')),
  phone: phoneField().refine((v) => v !== '', 'Enter your phone number.'),
  cover_note: z.string().trim().max(3000, 'Keep your note under 3,000 characters.').optional().default(''),
  consent: z.literal('yes', { error: 'Please confirm you have read how we use your information.' }),
});

/**
 * The "Apply online" form on the Careers page (HLO's design, version 20): the same
 * details, plus a cell number, the job chosen from the list, and a message.
 */
const careersApplicationSchema = applicationSchema.extend({
  job: z.string({ error: 'Choose the position you are applying for.' }).trim().min(1, 'Choose the position you are applying for.').max(200),
  cell: phoneField().refine((v) => v !== '', 'Enter your cell number.'),
  cover_note: z.string({ error: 'Tell us a little about yourself.' }).trim().min(1, 'Tell us a little about yourself.').max(3000, 'Keep your message under 3,000 characters.'),
});

module.exports = { applicationSchema, careersApplicationSchema };
