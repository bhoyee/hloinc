'use strict';

/**
 * Default text for the public pages. The Phase 4 content editor saves
 * overrides to `site_settings` under `page.<key>`; see services/content.js.
 */
module.exports = {
  home: {
    eyebrow: 'Serving Central & Southern Maryland',
    title: 'Support for living well, at home and in the community.',
    intro:
      'Healthy Living Option Inc. supports adults with intellectual and developmental disabilities to live independent lives, with community inclusion as a choice.',
    approachTitle: 'Person-centered, from the first conversation',
    approach:
      'We approach every part of our work with dignity, compassion and respect. Each person’s support is shaped around their own goals, choices and plan, and delivered by friendly, well-trained staff.',
  },

  about: {
    title: 'About HLO',
    intro:
      'Healthy Living Option Inc. (HLO) is a Maryland provider of community-based supports for adults with intellectual and developmental disabilities.',
    mission:
      'Healthy Living Option Inc. is committed to supporting people with developmental disabilities to live independent lives as adults, with community inclusion as a choice.',
    vision:
      'Our vision sets us on the path to fulfill our mission. We truly see the person in front of us, and we work to help each person fulfill their God-given potential.',
    values: [
      { name: 'Dignity', text: 'Every person is treated with respect and has their privacy protected.' },
      { name: 'Choice', text: 'People make decisions about their own lives, supports and goals.' },
      { name: 'Compassion', text: 'We listen first and support people with patience and care.' },
      { name: 'Community', text: 'We help people take part in community life in ways that matter to them.' },
    ],
    // From the current hloinc.com Services page, in respectful person-first wording.
    supportNeeds: [
      'Intellectual disabilities',
      'Autism',
      'Cerebral palsy',
      'Muscular dystrophy',
      'Multiple sclerosis',
      'Epilepsy and seizure disorders',
      'Spina bifida',
      'Cystic fibrosis',
      'Brain and head injuries',
      'Spinal cord injuries',
      'Orthopedic and physical disabilities',
      'Blindness or low vision',
      'Deafness or hearing loss',
      'Speech and language disabilities',
      'Specific learning disabilities',
      'Behavioral support needs',
      'Other neurological disabilities',
      'Disabilities not yet diagnosed',
    ],
    eligibilityNote:
      'Eligibility for DDA-funded services is decided by the Maryland Developmental Disabilities Administration, not by HLO. We are happy to talk through the process with you.',
  },

  services: {
    pledge:
      'We pledge to support adults with intellectual disabilities in a way that promotes their dignity, choices and individual rights.',
    approach:
      'Our approach follows evidence-based practices and focuses on maximizing choice, empowerment and self-determination, so each person has a real chance at independent living. We do this within a natural sense of community between our team and the people we support.',
  },

  gettingStarted: {
    title: 'Getting started',
    intro:
      'Starting new services can feel like a lot. Here is how the process usually works in Maryland, and where HLO fits in.',
    steps: [
      {
        icon: 'chat',
        who: 'You + HLO',
        title: 'Talk to us',
        text: 'Call, email or send us a message. We will listen, answer questions and explain the services we offer.',
      },
      {
        icon: 'users',
        who: 'You + your coordinator',
        title: 'Work with your Coordinator of Community Services',
        text: 'Your Coordinator of Community Services (CCS) helps you apply to the DDA, if you have not already, and build your person-centered plan.',
      },
      {
        icon: 'heart',
        who: 'You + HLO',
        title: 'Choose HLO as your provider',
        text: 'Once services are in your plan, you can choose HLO. We meet with you to understand your goals and preferences.',
      },
      {
        icon: 'home',
        who: 'HLO team',
        title: 'Start your services',
        text: 'We match staff, agree a schedule and begin. We keep in touch with you, your family and your CCS as things change.',
      },
    ],
    referralTitle: 'Talk to us about intake',
    referralText:
      'Coordinators, case managers, families and other professionals can contact our intake team directly. Please share only contact details and the type of support being considered. Do not send diagnoses or medication details through the website.',
  },

  careers: {
    title: 'Do work that matters',
    intro: 'Join a team that helps adults across Maryland live independent, connected lives. We value kindness, reliability and respect.',
    whyTitle: 'A place to grow while helping others',
    why: [
      { title: 'Meaningful work', text: 'Help people live the lives they choose, every single day.' },
      { title: 'Training from day one', text: 'Paid training and ongoing support to build your skills.' },
      { title: 'A team that listens', text: 'Supportive colleagues and leaders who value every voice.' },
      { title: 'Close to home', text: 'Roles across ten counties in Central and Southern Maryland.' },
    ],
    steps: [
      { title: 'Find a role', text: 'Search or browse open positions and read the full details.' },
      { title: 'Apply on ADP', text: 'Select “Apply on ADP”. Our secure ADP careers portal opens in a new tab.' },
      { title: 'Hear from us', text: 'Our team reviews your application and contacts you about next steps.' },
    ],
    applyNote: 'Applications are handled securely by ADP, our recruitment provider. HLO will never ask for payment to apply.',
  },
};
