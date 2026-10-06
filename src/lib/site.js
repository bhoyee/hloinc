'use strict';

/**
 * Default business details (requirements §3). Phase 4's site content editor
 * stores overrides in `site_settings`; these are the fallbacks and seed values.
 */
const defaults = {
  name: 'HLO Inc.',
  legalName: 'Healthy Living Option Inc.',
  phone: '410-874-8551',
  email: 'info@hloinc.com',
  address: {
    street: '4 East Rolling Crossroads, Suites 301–303',
    city: 'Catonsville',
    state: 'MD',
    zip: '', // CONFIRM — client question 3
  },
  hours: 'Monday to Friday, 9 a.m. to 5 p.m.',
  // Machine-readable hours for the "Open now" badge (Maryland time; 0 = Sunday).
  schedule: { days: [1, 2, 3, 4, 5], open: 9, close: 17 },
  walkIn: 'Walk-ins are welcome during office hours. Calling ahead helps us make sure the right person is available.',
};

const nav = [
  { label: 'About', href: '/about' },
  { label: 'Services', href: '/services' },
  { label: 'Careers', href: '/careers' },
  { label: 'Contact', href: '/contact' },
];

/**
 * Contact form recipients, in the order required by §6.5.
 * `category` drives portal inbox access (Intake Specialist sees `intake` only).
 * Email addresses come from site_settings `contact.recipient_emails` (client question 4),
 * falling back to the main business email.
 */
// `description` helps visitors choose (shown on the contact page). CONFIRM wording with HLO.
const recipients = [
  // The requirements document labels this "More inquiry"; CONFIRM the wording.
  { key: 'general', label: 'General inquiry', category: 'general', icon: 'chat',
    description: 'Questions about HLO, our services, or anything else.' },
  { key: 'program_coordinator', label: 'Program coordinator', category: 'general', icon: 'calendar',
    description: 'Day-to-day questions about current services and schedules.' },
  { key: 'program_director', label: 'Program director', category: 'general', icon: 'users',
    description: 'Feedback or concerns about the quality of a program.' },
  { key: 'executive', label: 'CEO/COO', category: 'general', icon: 'briefcase',
    description: 'Partnerships, leadership matters, or formal concerns.' },
  { key: 'intake', label: 'Intake specialist', category: 'intake', icon: 'heart',
    description: 'Starting services with HLO and referrals.' },
];

module.exports = { defaults, nav, recipients };
