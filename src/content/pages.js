'use strict';

/**
 * Starting text for the public pages, in HLO's own wording (from the site
 * mock-up HLO's IT sent in October 2026). Staff change any of it in the
 * portal's visual page editor; this file is only the starting point.
 */
module.exports = {
  home: {
    title: 'Supporting adults with developmental disabilities',
    intro:
      'We are committed to supporting people with developmental disabilities to live independent lives as adults, with community inclusion as a choice.',
    welcomeEyebrow: 'Welcome to Healthy Living Option Inc.',
    approachTitle: 'The right choice of care for the differently-abled',
    approach:
      'HLO Inc. approaches our operations in a way that delivers all care and services and addresses each individual’s needs with dignity, compassion, and respect. We operate a person-centered approach to our services, with friendly supports and assistance from well-trained professional staff.',
    mission:
      'Healthy Living Option Inc. is committed to supporting people with developmental disabilities to live independent lives as adults by community inclusion as a choice.',
    vision:
      'Our vision is what set us on a path of action to fulfill our mission. We truly see the person in front of us and, thus, we work to help them fulfill their God-given potentials.',
  },

  about: {
    title: 'About HLO Inc.',
    intro: 'Our profile: who we are, what we believe, and where we serve.',
    whoTitle: 'Compassionate, person-centered care',
    who: [
      'HLO Inc. approaches our operations in a way that delivers all care and services and addresses each individual’s needs with dignity, compassion, and respect. We operate a person-centered approach to our services by friendly supports and assistance from well-trained professional staff.',
      'Our services address immediate needs as well as support and prepare for independence and full lives. We exhibit compassion and a standard that is second to none.',
      'Each person’s supports are built around their Person-Centered Plan (PCP) and carried out through an Individual Support Plan (ISP), delivered as Home and Community-Based Services (HCBS) in comfortable, furnished apartment homes and in the community.',
    ],
    mission:
      'Healthy Living Option Inc. is committed to supporting people with developmental disabilities to live independent lives as adults by community inclusion as a choice. We recognize and respect the rights and choices of the individuals, and treat them with dignity.',
    vision:
      'Our vision is what set us on a path of action to fulfill our mission. We truly see the person in front of us and, thus, we work to help them fulfill their God-given potentials. We provide care and services to improve the lives of the people we serve. This involves person-centered and community integration services.',
    values: [
      { name: 'Dignity', text: 'Every person is treated with respect and has their privacy protected.' },
      { name: 'Choice', text: 'People make decisions about their own lives, supports and goals.' },
      { name: 'Compassion', text: 'We listen first and support people with patience and care.' },
      { name: 'Community', text: 'We help people take part in community life in ways that matter to them.' },
    ],
    glance: [
      { label: 'Provider', value: 'Maryland DDA provider' },
      { label: 'Region', value: 'Central Maryland and Southern Region' },
      { label: 'Counties', value: 'Nine Maryland counties and Baltimore City' },
      { label: 'Office Hours', value: 'Monday – Friday, 9am – 5pm' },
    ],
    applySteps: [
      { title: 'Contact us', text: 'Submit the request form or call (410) 874-8551. Referrals from coordinators, agencies, and families are welcome.' },
      { title: 'Talk with our team', text: 'We learn about the person’s goals, needs, and preferences, and explain which of our services may fit.' },
      { title: 'Plan the next steps together', text: 'We coordinate with the individual, family, and Coordinator of Community Services to align services with the Person-Centered Plan and build the Individual Support Plan (ISP).' },
    ],
    // HLO's list (October 2026), in their wording.
    supportNeeds: [
      'Cerebral Palsy',
      'Muscular Dystrophy',
      'Multiple Sclerosis',
      'Blindness / Severe Visual Impairment',
      'Deafness / Severe Hearing Impairment',
      'Behavioral Problems',
      'Cystic Fibrosis',
      'Epilepsy / Seizure Disorder',
      'Head Injury',
      'Orthopedic Impairment',
      'Specific Learning Disability',
      'Speech / Language Impairment',
      'Spina Bifida',
      'Spinal Cord Injury',
      'Other Neurological Impairment',
      'Other undetermined disabilities',
    ],
    eligibilityNote:
      'Eligibility for DDA-funded services is decided by the Maryland Developmental Disabilities Administration, not by HLO. We are happy to talk through the process with you.',
  },

  services: {
    pledge:
      'We pledge to support adults with intellectual disabilities in a way that promotes their dignity, choices, and individual rights.',
    approachTitle: 'An approach built on choice and self-determination',
    approach:
      'Healthy Living Option Inc. has a service approach that follows evidence-based practices and is focused on maximizing choice, empowerment, and self-determination among vulnerable adults. In other words, we want to give them a good chance at independent living.\n\nWe are working with very special people, so we do all this and more in an atmosphere of natural community between us and the people in our care.\n\nEvery service is guided by the person’s Person-Centered Plan (PCP) and Individual Support Plan (ISP), and is delivered as Home and Community-Based Services (HCBS).',
  },

  gettingStarted: {
    title: 'Getting started',
    intro: 'We keep the first conversation easy. You do not need to have every answer ready.',
    steps: [
      {
        icon: 'chat',
        who: 'You + HLO',
        title: 'Reach out',
        text: 'Use the request or referral form, or call (410) 874-8551. Tell us who needs support and what matters most.',
      },
      {
        icon: 'users',
        who: 'HLO team',
        title: 'We talk it through',
        text: 'A member of our team follows up to learn about the person, answer questions, and explain how our services could fit.',
      },
      {
        icon: 'heart',
        who: 'You + your coordinator + HLO',
        title: 'We coordinate next steps',
        text: 'We work alongside the individual, family, and Coordinator of Community Services to build the plan and move forward with the right supports.',
      },
    ],
    referralTitle: 'I am making a referral',
    referralText:
      'Take the time to send a referral. It allows us to help more people who require our special assistance. Information is kept strictly confidential.',
  },

  careers: {
    title: 'Work with HLO Inc.',
    intro:
      'If you are certified and passionate about serving individuals facing challenges of intellectual and developmental disabilities, please consider joining the HLO team here in Maryland.',
    whyTitle: 'A place to grow while helping others',
    why: [
      { title: 'Meaningful work', text: 'Help people live the lives they choose, every single day.' },
      { title: 'Training from day one', text: 'Paid training and ongoing support to build your skills.' },
      { title: 'A team that listens', text: 'Supportive colleagues and leaders who value every voice.' },
      { title: 'Close to home', text: 'Roles across nine Maryland counties and Baltimore City.' },
    ],
    // The kinds of roles HLO hires for (HLO's list); live openings come from the Jobs section of the portal.
    roles: ['Direct Support Staff', 'Program Director / Coordinator', 'Office Secretary / Receptionist', 'Accounting Officer', 'Delegate Nurse'],
    steps: [
      { title: 'Find a role', text: 'Search or browse open positions and read the full details.' },
      { title: 'Apply on ADP', text: 'Select “Apply on ADP”. Our secure ADP careers portal opens in a new tab.' },
      { title: 'Hear from us', text: 'Our team reviews your application and contacts you about next steps.' },
    ],
    applyNote: 'Applications are handled securely by ADP, our recruitment provider. HLO will never ask for payment to apply.',
  },
};
