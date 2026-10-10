'use strict';

/**
 * HLO's approved services, in the order and wording HLO supplied (hloinc-site
 * mock-up from HLO's IT, October 2026). Staff can change any of this text in
 * the portal's page editor; this file is the starting text.
 * Transportation and nursing are intentionally excluded (requirements §2).
 * Wording must not promise eligibility or clinical treatment.
 * Slugs stay fixed so existing links and saved referrals keep working.
 */
/** Where support happens — drives the filter on the Getting Started comparison. */
const WHERE_LABELS = {
  home: 'At home',
  'shared-home': 'In an HLO apartment home',
  community: 'Out in the community',
};

const services = [
  {
    slug: 'community-residential-services',
    photo: 'apartment-open-plan',
    where: ['shared-home'],
    imageAlt: 'Furnished open-plan living and dining area in an apartment home',
    name: 'Residential Services',
    icon: 'home',
    summary: 'A furnished apartment home with the day-to-day support each person’s Individual Support Plan (ISP) calls for.',
    intro: [
      'People we support live in furnished apartment homes that are comfortable, welcoming and set up for everyday life, with the right level of support close by.',
      'Daily support follows each person’s Individual Support Plan (ISP), and is delivered as Home and Community-Based Services (HCBS), so home life and community life go together.',
    ],
    includes: [
      'Licensed DDA community residential services',
      'Fully furnished apartment homes',
      'Day-to-day support set out in the person’s ISP',
      'Help with household routines and daily living skills',
      'Support to take part in community, social and leisure activities',
      'Respect for privacy, personal choice and individual rights',
    ],
    suitedFor: 'Adults who would like to live outside the family home, with staff support close by.',
    setting: 'A furnished HLO apartment home',
  },
  {
    slug: 'supported-living',
    photo: 'supported-living-kitchen',
    where: ['home'],
    imageAlt: 'Man in a wheelchair preparing vegetables in his kitchen',
    name: 'Supported Living',
    icon: 'key',
    summary: 'Support for adults who live in their own home or apartment, delivered as Home and Community-Based Services (HCBS).',
    intro: [
      'Supported Living is for adults who want a home of their own. The person chooses where they live, and our staff provide the support set out in their plan, delivered as Home and Community-Based Services (HCBS).',
      'The aim is real independence: making decisions, running a household and being part of the neighborhood.',
    ],
    includes: [
      'Support in the person’s own home or apartment',
      'Help managing a household, bills and appointments',
      'Building skills for greater independence over time',
      'Support to connect with neighbors and community',
      'Flexible support that adjusts as needs change',
    ],
    suitedFor: 'Adults ready for, or already living in, their own home who want ongoing support.',
    setting: 'The person’s own home',
  },
  {
    slug: 'personal-supports',
    photo: 'personal-support-smile',
    where: ['home', 'community'],
    imageAlt: 'Woman smiling up at her support person',
    name: 'Personal Support',
    icon: 'hand-heart',
    summary: 'Hands-on help with daily living, health and community life, guided by the person-centered plan.',
    intro: [
      'Personal Support helps adults build skills and confidence for everyday life. Our trained staff work alongside each person at home and out in the community, at the pace and in the way that suits them.',
      'Support is guided by the person’s own goals and their Person-Centered Plan (PCP), and it changes as those goals change.',
    ],
    includes: [
      'Building daily living skills such as cooking, cleaning and budgeting',
      'Support with health routines and appointments',
      'Getting out and taking part in community activities',
      'Shopping, errands and using local services',
      'Keeping in touch with family, friends and community',
    ],
    suitedFor: 'Adults who live with family or on their own and want hands-on support with daily life.',
    setting: 'At home and in the community',
  },
  {
    slug: 'community-development-services',
    photo: 'cds-art-class',
    where: ['community'],
    imageAlt: 'Instructor helping an adult student in an art class',
    name: 'Community Development Services (CDS)',
    icon: 'users',
    summary: 'Community-based activities that build skills, friendships and connection, chosen by the person.',
    intro: [
      'Community Development Services help people discover what they enjoy and find their place in the community, through classes, volunteering, clubs, recreation and more.',
      'Activities are chosen by the person and take place in ordinary community settings alongside other community members.',
    ],
    includes: [
      'Exploring interests, hobbies and volunteer roles',
      'Building friendships and natural supports',
      'Learning to use community resources independently',
      'Developing social, communication and travel skills',
    ],
    suitedFor: 'Adults who want a fuller, more connected life in their community.',
    setting: 'Community settings',
  },
  {
    slug: 'respite-care',
    photo: 'respite-boardwalk',
    where: ['home', 'community'],
    imageAlt: 'Friends on a relaxed walk along a boardwalk',
    name: 'Respite',
    icon: 'sun',
    summary: 'Short-term relief for families and caregivers while the person keeps receiving quality supports.',
    intro: [
      'Caring for a loved one is rewarding, and it is also demanding. Respite gives families and caregivers a planned break, while the person keeps receiving quality supports from trained, trusted staff.',
      'Respite can be arranged for a few hours or longer periods, depending on what is in the person’s plan.',
    ],
    includes: [
      'Planned, short-term breaks for families and caregivers',
      'Familiar routines kept in place during respite',
      'Activities the person enjoys, at home or in the community',
      'Clear communication with the family before and after',
    ],
    suitedFor: 'Families who provide most of a loved one’s support and need time to recharge.',
    setting: 'At home or in the community',
  },
  {
    slug: 'employment-services',
    photo: 'employment-coffee',
    where: ['community'],
    imageAlt: 'Man smiling at his job at a coffee machine',
    name: 'Employment Services',
    icon: 'briefcase',
    summary: 'Help to explore, find and keep meaningful work that matches the goals in the person’s plan.',
    intro: [
      'Employment Services help adults explore the kind of work they would enjoy, find a job that fits, and keep it, with support matched to the goals in their plan.',
      'Support continues on the job for as long as it is needed, so each person can grow in confidence and independence at work.',
    ],
    includes: [
      'Exploring interests, strengths and the right kind of work',
      'Help with applications and preparing for interviews',
      'Support learning a new job and workplace routines',
      'Ongoing support to keep a job and grow in it',
    ],
    suitedFor: 'Adults whose plan includes finding or keeping paid work.',
    setting: 'Workplaces and the community',
  },
];

/** Conditions highlighted next to the services (HLO's wording). */
const CONDITIONS = [
  { title: 'Intellectual disabilities', text: 'We will give persons with an intellectual disability the opportunity to live a good quality life.' },
  { title: 'Mental disabilities', text: 'We are competent to fill in the gaps and provide appropriate mental health services.' },
  { title: 'Autism', text: 'We let individuals with autism get the care and support services they need to thrive and establish independence.' },
];

module.exports = services;
module.exports.WHERE_LABELS = WHERE_LABELS;
module.exports.CONDITIONS = CONDITIONS;
