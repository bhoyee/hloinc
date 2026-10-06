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
const recipients = [
  // The requirements document labels this "More inquiry"; CONFIRM the wording.
  { key: 'general', label: 'General inquiry', category: 'general' },
  { key: 'program_coordinator', label: 'Program coordinator', category: 'general' },
  { key: 'program_director', label: 'Program director', category: 'general' },
  { key: 'executive', label: 'CEO/COO', category: 'general' },
  { key: 'intake', label: 'Intake specialist', category: 'intake' },
];

module.exports = { defaults, nav, recipients };
