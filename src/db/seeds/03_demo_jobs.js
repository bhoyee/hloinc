'use strict';

/**
 * DEMO job postings so the Careers pages can be reviewed before the portal's
 * job editor exists (Phase 4). Never runs in production. Pay, requirements
 * and the ADP link are placeholders — HLO supplies the real ones.
 */
const ADP_PLACEHOLDER = 'https://workforcenow.adp.com/';

const duties = `As a Direct Support Professional (DSP), you help adults with intellectual and developmental disabilities live full, independent lives at home and in their communities. You work one-on-one and in small groups, following each person’s person-centered plan.

What you will do:
- Support people with daily living skills such as cooking, cleaning and personal routines
- Help people take part in community activities, appointments and errands
- Encourage choice, independence and respect in everything you do
- Keep accurate daily notes and share updates with the team
- Follow HLO policies and Maryland DDA requirements`;

const requirements = `- High school diploma or GED
- At least 18 years old
- Valid driver’s license and reliable transportation (preferred)
- Able to pass a criminal background check
- CPR and First Aid certification, or willing to complete it with us
- Experience supporting people with disabilities is a plus — we provide full training`;

const benefits = `- Paid training and certifications
- Flexible schedules
- Paid time off
- Opportunities to grow into lead and coordinator roles`;

exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production') return;

  const jobs = [
    {
      title: 'Direct Support Professional (DSP)',
      slug: 'direct-support-professional',
      department: 'Residential & Community Services',
      location: 'Catonsville, MD and surrounding counties',
      employment_type: 'Full-time',
      pay_range: '$17.00 – $19.00 per hour',
      description: duties,
      requirements,
      benefits,
      apply_url: ADP_PLACEHOLDER,
      status: 'published',
      published_at: new Date(),
    },
    {
      title: 'Direct Support Professional – Weekends',
      slug: 'direct-support-professional-weekends',
      department: 'Residential & Community Services',
      location: 'Baltimore County, MD',
      employment_type: 'Part-time',
      pay_range: '$17.50 – $19.50 per hour',
      description: duties.replace(
        'You work one-on-one',
        'This part-time role covers Saturday and Sunday shifts. You work one-on-one'
      ),
      requirements,
      benefits: '- Paid training and certifications\n- Weekend shift differential\n- Opportunities to pick up extra hours',
      apply_url: ADP_PLACEHOLDER,
      status: 'published',
      published_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  ];

  // Extra demo roles so search, filters and pagination can be tried with a realistic count.
  const roles = [
    ['Direct Support Professional (DSP)', 'Residential & Community Services', 'Full-time', '$17.00 – $19.00 per hour'],
    ['Direct Support Professional – Overnight', 'Residential & Community Services', 'Full-time', '$18.00 – $20.00 per hour'],
    ['Direct Support Professional – Weekends', 'Residential & Community Services', 'Part-time', '$17.50 – $19.50 per hour'],
    ['Community Support Specialist', 'Community Development', 'Full-time', '$18.00 – $20.00 per hour'],
    ['Respite Care Worker', 'Family Supports', 'Part-time', '$17.00 – $18.50 per hour'],
    ['House Manager', 'Residential & Community Services', 'Full-time', '$22.00 – $25.00 per hour'],
    ['Program Coordinator', 'Programs', 'Full-time', '$52,000 – $58,000 per year'],
    ['Intake Specialist', 'Intake', 'Full-time', '$45,000 – $50,000 per year'],
    ['Office Receptionist', 'Administration', 'Part-time', '$16.50 – $18.00 per hour'],
  ];
  const places = ['Baltimore County, MD', 'Howard County, MD', 'Anne Arundel County, MD', 'Prince George’s County, MD', 'Montgomery County, MD', 'Harford County, MD', 'Charles County, MD'];
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let n = 0;
  for (const [i, place] of places.entries()) {
    for (const [title, department, type, pay] of roles.slice(i % 6, (i % 6) + 4)) {
      n++;
      jobs.push({
        title,
        slug: `${slugify(title)}-${slugify(place)}-${n}`,
        department,
        location: place,
        employment_type: type,
        pay_range: pay,
        description: duties,
        requirements,
        benefits,
        apply_url: ADP_PLACEHOLDER,
        status: 'published',
        published_at: new Date(Date.now() - (n + 4) * 24 * 60 * 60 * 1000),
      });
    }
  }

  for (const job of jobs) {
    const exists = await knex('jobs').where({ slug: job.slug }).first();
    if (!exists) await knex('jobs').insert(job);
  }
};
