'use strict';

const { z } = require('zod');
const { CATEGORY_KEYS } = require('../services/support');

// Only portal pages count as "where it happened" (never the help pages themselves).
const portalPath = (v) => (/^\/portal(?:[/?#]|$)/.test(v) && !/^\/portal\/help(?:[/?#]|$)/.test(v) && v.length <= 300 ? v : '');

const helpSchema = z.object({
  category: z.enum(CATEGORY_KEYS, { error: 'Choose what it’s about.' }),
  message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters).').max(3000, 'Keep it under 3,000 characters.'),
  from: z.string().optional().default('').transform(portalPath),
  error_ref: z.string().optional().default('').transform((v) => (/^ERR-[2-9A-HJKMNP-Z]{6}$/.test(v) ? v : '')),
  screen: z.string().optional().default('').transform((v) => (/^\d{2,5}×\d{2,5}$/.test(v) ? v : '')),
});

const replySchema = z.object({
  body: z.string().trim().max(2000, 'Keep it under 2,000 characters.').optional().default(''),
  status: z.string().optional().default(''),
});

module.exports = { helpSchema, replySchema, portalPath };
