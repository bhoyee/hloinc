'use strict';

/**
 * DEMO positions for the Careers page: the six roles in HLO's website design
 * (version 20). Development, or a server with DEMO_DATA=true (src/db/demo.js),
 * so they show on the preview site. Pay ranges are placeholders: HLO supplies
 * the real ones (a live posting must show its pay range, Maryland law).
 * Adds any that are missing; `npm run demo:remove` deletes exactly these (by slug).
 */
const demo = require('../demo');

const BENEFITS = `- Health, dental and vision insurance
- Paid time off and sick leave
- Life insurance
- 401(k)
- Paid training`;

const POSITIONS = [
  {
    title: 'Direct Support Staff',
    department: 'Residential & Community Services',
    employment_type: 'Full-time',
    pay_range: '$17.00 – $19.50 per hour',
    description: `Help adults with intellectual and developmental disabilities live full, independent lives at home and in their communities, following each person’s Person-Centered Plan.

- Support daily living skills such as cooking, cleaning and personal routines
- Help people take part in community activities and appointments
- Keep accurate daily notes and share updates with the team`,
    requirements: `- High school diploma or GED
- At least 18 years old
- CPR and First Aid certification, or willing to complete it with us
- Able to pass a criminal background check`,
  },
  {
    title: 'Program Director / Coordinator',
    department: 'Programs',
    employment_type: 'Full-time',
    pay_range: '$60,000 – $75,000 per year',
    description: `Lead and coordinate HLO’s residential and community programs, making sure every individual receives the supports in their Provider Implementation Plan (PIP).

- Supervise and support Direct Support Staff
- Work with families and Coordinators of Community Services
- Keep programs in line with Maryland DDA requirements`,
    requirements: `- Bachelor’s degree in human services or a related field
- At least 2 years of experience in DDA or IDD services
- Supervisory experience`,
  },
  {
    title: 'Office Secretary / Receptionist',
    department: 'Administration',
    employment_type: 'Full-time',
    pay_range: '$16.50 – $19.00 per hour',
    description: `Be the friendly first point of contact for families, visitors and staff at our Catonsville office.

- Answer calls and welcome visitors
- Pass messages to the right person and keep records up to date
- Support the team with scheduling and office tasks`,
    requirements: `- High school diploma or GED
- Good communication and computer skills
- Office or front-desk experience preferred`,
  },
  {
    title: 'Quality Assurance Specialist',
    department: 'Quality & Compliance',
    employment_type: 'Full-time',
    pay_range: '$50,000 – $60,000 per year',
    description: `Help HLO deliver safe, high-quality services by reviewing records, practices and plans against DDA and HCBS standards.

- Review documentation and Provider Implementation Plans
- Carry out site visits and audits
- Recommend and follow up on improvements`,
    requirements: `- Bachelor’s degree, or equivalent experience
- Knowledge of Maryland DDA regulations
- Strong attention to detail`,
  },
  {
    title: 'Accounting Officer',
    department: 'Finance',
    employment_type: 'Full-time',
    pay_range: '$55,000 – $68,000 per year',
    description: `Manage HLO’s day-to-day accounts, billing and payroll support.

- Prepare invoices, reconcile accounts and track payments
- Support payroll and budgeting
- Keep accurate financial records`,
    requirements: `- Degree in accounting or finance
- Experience with accounting software
- Experience in healthcare or human services billing is a plus`,
  },
  {
    title: 'Delegating Nurse',
    department: 'Nursing',
    employment_type: 'Part-time',
    pay_range: '$40.00 – $50.00 per hour',
    description: `Oversee health care for the individuals we support and delegate nursing tasks to trained staff, as Maryland requires.

- Train and supervise Certified Medication Technicians
- Review health records, medications and care plans
- Work with doctors, families and the HLO team`,
    requirements: `- Active Maryland RN license
- Case Manager/Delegating Nurse (CM/DN) training, or willing to complete it
- Experience with IDD services preferred`,
  },
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const SLUGS = POSITIONS.map((p) => slugify(p.title));

exports.SLUGS = SLUGS;

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;
  const now = Date.now();
  for (const [i, p] of POSITIONS.entries()) {
    const slug = SLUGS[i];
    if (await knex('jobs').where({ slug }).first()) continue;
    await knex('jobs').insert({
      ...p,
      slug,
      location: 'Catonsville, MD and surrounding counties',
      benefits: BENEFITS,
      status: 'published',
      // Newest first in the design's order.
      published_at: new Date(now - i * 60 * 1000),
    });
  }
};
