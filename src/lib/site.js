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
};

const nav = [
  { label: 'About', href: '/about' },
  { label: 'Services', href: '/services' },
  { label: 'Careers', href: '/careers' },
  { label: 'Contact', href: '/contact' },
];

module.exports = { defaults, nav };
