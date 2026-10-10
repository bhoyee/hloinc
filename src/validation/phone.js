'use strict';

const { z } = require('zod');

/** Longest a phone field may be, typed punctuation included (also the input's maxlength). */
const PHONE_MAX = 20;

/**
 * A US phone number: 10 digits, or 11 starting with 1, with the usual
 * punctuation allowed. Saved and shown in the standard US format, like
 * (410) 555-0123. An empty value stays empty (callers decide whether it is required).
 */
function normalizePhone(value) {
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** For display: a US number in the standard format; anything else unchanged. */
function formatPhone(value) {
  if (!value) return value;
  return isUsPhone(String(value)) ? normalizePhone(value) : value;
}

function isUsPhone(value) {
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

const phoneField = (message = 'Enter a valid US phone number, like (410) 555-0123.') =>
  z
    .string()
    .trim()
    .max(PHONE_MAX, message)
    .refine((v) => v === '' || isUsPhone(v), { message })
    .transform((v) => (v === '' ? '' : normalizePhone(v)));

/**
 * Search help: when `q` looks like (part of) a phone number, also match on the
 * digits, so "410-555-0100", "4105550100" and "(410) 555-0100" all find it.
 * `w` is a knex where-builder; `column` the phone column.
 */
function orWherePhone(w, column, q) {
  let digits = String(q).replace(/\D/g, '');
  if (digits.length < 4 || !/^[\d\s().+-]+$/.test(String(q).trim())) return w;
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return w.orWhereRaw("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(??, '(', ''), ')', ''), ' ', ''), '-', ''), '.', '') like ?", [column, `%${digits}%`]);
}

module.exports = { phoneField, normalizePhone, formatPhone, isUsPhone, orWherePhone, PHONE_MAX };
