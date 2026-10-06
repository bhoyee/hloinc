'use strict';

/**
 * The five non-nursing services (requirements §3). DRAFT copy — HLO to approve.
 * Transportation and nursing are intentionally excluded (§2).
 * Wording must not promise eligibility or clinical treatment.
 */
module.exports = [
  {
    slug: 'personal-supports',
    imageAlt: 'A man and a woman preparing a meal together in a kitchen',
    name: 'Personal Supports',
    icon: 'hand-heart',
    summary:
      'Day-to-day support at home and in the community, built around the goals in each person’s plan.',
    intro: [
      'Personal Supports help adults build skills and confidence for everyday life. Our trained staff work alongside each person at home and out in the community, at the pace and in the way that suits them.',
      'Support is shaped by the person’s own goals and their person-centered plan, and it changes as those goals change.',
    ],
    includes: [
      'Building daily living skills such as cooking, cleaning and budgeting',
      'Getting out and taking part in community activities',
      'Shopping, errands and using local services',
      'Developing routines that support independence',
      'Keeping in touch with family, friends and community',
    ],
    suitedFor: 'People who live with family or on their own and want hands-on support with daily life.',
    setting: 'At home and in the community',
  },
  {
    slug: 'community-residential-services',
    imageAlt: 'A bright, welcoming dining room in a family home',
    name: 'Community Residential Services',
    icon: 'home',
    summary:
      'Licensed community homes where people live together with the support of trained, caring staff.',
    intro: [
      'Our licensed community residential homes offer a safe, comfortable place to live, with staff support tailored to each resident.',
      'Residents are encouraged to make their own choices, take part in household life and stay connected to their wider community.',
    ],
    includes: [
      'A shared home in a residential neighborhood',
      'Staff support matched to each person’s plan',
      'Help with household routines and daily living skills',
      'Support to join community, social and leisure activities',
      'Respect for privacy, personal choice and individual rights',
    ],
    suitedFor: 'People who would like to live outside the family home with staff support on hand.',
    setting: 'A licensed HLO community home',
  },
  {
    slug: 'supported-living',
    imageAlt: 'The front door of a home surrounded by potted flowers',
    name: 'Supported Living',
    icon: 'key',
    summary:
      'Support for people who choose to live in their own home or apartment, with the help they need to thrive.',
    intro: [
      'Supported Living is for adults who want a home of their own. The person chooses where they live and who they live with, and our staff provide the support set out in their plan.',
      'The aim is real independence: making decisions, running a household and being part of the neighborhood.',
    ],
    includes: [
      'Support in the person’s own home or apartment',
      'Help managing a household, bills and appointments',
      'Building skills for greater independence over time',
      'Support to connect with neighbors and community',
      'Flexible support that adjusts as needs change',
    ],
    suitedFor: 'People ready for, or already living in, their own home who want ongoing support.',
    setting: 'The person’s own home',
  },
  {
    slug: 'respite-care',
    imageAlt: 'Hands resting around a warm mug in a calm, sunny room',
    name: 'Respite Care',
    icon: 'sun',
    summary:
      'Short-term support that gives family caregivers time to rest, while their loved one is supported by our staff.',
    intro: [
      'Caring for a loved one is rewarding, and it is also demanding. Respite Care gives family caregivers a planned break, knowing their loved one is with trained, trusted staff.',
      'Respite can be arranged for a few hours or longer periods, depending on what is in the person’s plan.',
    ],
    includes: [
      'Planned, short-term breaks for family caregivers',
      'Familiar routines kept in place during respite',
      'Activities the person enjoys, at home or in the community',
      'Clear communication with the family before and after',
    ],
    suitedFor: 'Families who provide most of a loved one’s support and need time to recharge.',
    setting: 'At home or in the community',
  },
  {
    slug: 'community-development-services',
    imageAlt: 'A group of friends relaxing together on a picnic in a park',
    name: 'Community Development Services',
    icon: 'users',
    summary:
      'Support to explore interests, build relationships and take an active part in community life.',
    intro: [
      'Community Development Services help people discover what they enjoy and find their place in the community, through volunteering, classes, clubs, recreation and more.',
      'Activities are chosen by the person and take place in ordinary community settings alongside other community members.',
    ],
    includes: [
      'Exploring interests, hobbies and volunteer roles',
      'Building friendships and natural supports',
      'Learning to use community resources independently',
      'Developing social, communication and travel skills',
    ],
    suitedFor: 'People who want a fuller, more connected life in their community.',
    setting: 'Community settings',
  },
];
