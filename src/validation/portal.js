'use strict';

const { z } = require('zod');

const email = z
  .string({ error: 'Enter an email address.' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter an email address.')
  .max(191, 'Email address is too long.')
  .pipe(z.email('Enter a valid email address.'));

const loginSchema = z.object({
  email,
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.').max(200),
});

const COMMON = new Set(['password1234', 'password12345', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'welcome12345', 'hlo123456789']);

/** New password rules: long rather than complex (NIST SP 800-63B style). */
function newPasswordSchema(userEmail = '') {
  const local = String(userEmail).split('@')[0].toLowerCase();
  return z
    .object({
      password: z
        .string({ error: 'Enter a new password.' })
        .min(12, 'Use at least 12 characters. A short phrase of a few words works well.')
        .max(128, 'Use 128 characters or fewer.')
        .refine((p) => !COMMON.has(p.toLowerCase()), 'That password is too common. Choose something less predictable.')
        .refine((p) => new Set(p).size >= 5, 'That password is too repetitive.')
        .refine((p) => local.length < 4 || !p.toLowerCase().includes(local), 'Don’t include your email name in your password.'),
      confirm: z.string({ error: 'Type the new password again.' }),
    })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The two passwords don’t match.' });
}

const changePasswordSchema = (userEmail) =>
  z
    .object({ current: z.string({ error: 'Enter your current password.' }).min(1, 'Enter your current password.') })
    .and(newPasswordSchema(userEmail));

const name = z
  .string({ error: 'Enter a name.' })
  .trim()
  .min(2, 'Enter a name.')
  .max(120, 'Keep the name under 120 characters.');

const phone = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === '' || (/^[+()\-.\s\d]{7,}$/.test(v) && v.replace(/\D/g, '').length >= 10), 'Enter a valid phone number.')
  .optional()
  .default('');

const accountSchema = z.object({
  name,
  email,
  phone,
  // Checked against the roles in the database by the route.
  role: z.string({ error: 'Choose a role.' }).trim().min(1, 'Choose a role.').max(40),
});

const profileSchema = z.object({ name, phone });

const mfaCodeSchema = z.object({
  code: z
    .string({ error: 'Enter the code.' })
    .trim()
    .min(6, 'Enter the 6-digit code.')
    .max(20, 'Enter the 6-digit code.'),
});

const roleSchema = z.object({
  name: z.string({ error: 'Enter a role name.' }).trim().min(2, 'Enter a role name.').max(80, 'Keep the name under 80 characters.'),
  description: z.string().trim().max(255, 'Keep the description under 255 characters.').optional().default(''),
  require_mfa: z.literal('yes').optional(),
  permissions: z.preprocess((v) => (v === undefined ? [] : [].concat(v)), z.array(z.string().max(80)).max(200)),
});

module.exports = { roleSchema, loginSchema, newPasswordSchema, changePasswordSchema, accountSchema, profileSchema, mfaCodeSchema, email };
