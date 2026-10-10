'use strict';

const { z } = require('zod');
const { EMPLOYMENT_TYPE_OPTIONS } = require('../services/jobs');

const optional = (max, label) => z.string().trim().max(max, `Keep the ${label} under ${max.toLocaleString('en-US')} characters.`).optional().default('');

const jobSchema = z.object({
  title: z.string({ error: 'Enter a job title.' }).trim().min(3, 'Enter a job title.').max(160, 'Keep the title under 160 characters.'),
  department: optional(120, 'department'),
  location: optional(160, 'location'),
  employment_type: z.union([z.enum(EMPLOYMENT_TYPE_OPTIONS), z.literal('')], { error: 'Choose a schedule.' }).optional().default(''),
  pay_range: optional(120, 'pay range'),
  description: z.string({ error: 'Describe the role.' }).trim().min(20, 'Describe the role in at least a sentence or two.').max(10000, 'Keep the description under 10,000 characters.'),
  requirements: optional(6000, 'requirements'),
  benefits: optional(4000, 'benefits'),
});

module.exports = { jobSchema };
