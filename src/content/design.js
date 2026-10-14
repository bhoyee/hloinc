'use strict';

/**
 * Starting content for the redesigned public pages (HLO's design, version 20,
 * October 2026; wording from version 41, October 14). The pages read these through the Site content editor, so staff
 * can change any of it; this file is only the text a page shows until then.
 * Photos are the design's stock photos, hosted in public/img/photos (d-*.webp).
 */

/** The six services, in the design's order. `anchor` is the section id on /services. */
const services = [
  {
    anchor: 'svc-residential',
    slug: 'community-residential-services',
    name: 'Residential Support',
    short: 'Residential Support',
    photo: 'd-living-dining',
    alt: 'Furnished open-plan living and dining area in an apartment home',
    summary: 'A comfortable, furnished apartment home with the everyday help each individual needs, guided by their own Provider Implementation Plan (PIP).',
    includes: 'A home that fits each individual’s needs, preferences and goals, set in the neighborhood rather than in a facility. Our team helps each individual build and keep the skills for everyday life, as their plan calls for: personal care such as bathing, dressing and grooming, using the bathroom, eating and moving around safely, along with cooking, budgeting, health appointments and getting around. The everyday choices about the home belong to the individual who lives there.',
    bullets: ['Licensed DDA community residential services', 'DDA service: Community Living – Group Home', 'Furnished apartment homes'],
  },
  {
    anchor: 'svc-supported',
    slug: 'supported-living',
    name: 'Supported Living',
    short: 'Supported Living',
    photo: 'd-kitchen-wheelchair',
    alt: 'Man in a wheelchair preparing vegetables in his kitchen',
    summary: 'Help for adults who live in their own home or apartment, so they can run their household the way they choose.',
    includes: 'Help for adults to use and build independent living skills in their own home, which they own or lease, alone or with roommates. Based on each individual’s assessed needs and plan, our team provides hands-on help and personal care at the agreed times, such as household tasks, money, daily self-care like dressing, grooming and meals, and getting out and about.',
    bullets: [],
  },
  {
    anchor: 'svc-personal',
    slug: 'personal-supports',
    name: 'Personal Supports',
    short: 'Personal Supports',
    photo: 'd-support-smile',
    alt: 'Woman smiling up at her support person',
    summary: 'Respectful, hands-on help with daily living and health, in the individual’s own home and guided by their Person-Centered Plan.',
    includes: 'Assistance for adults who live in their own or their family’s home and want to build independent living skills. Our team helps at home, encourages individuals to take part in local life, and provides personal care, based on needs documented in the individual’s plan that family and other natural supports do not meet.',
    adlIntro: 'as-needed assistance with everyday self-care, scheduled around the individual’s own routine and guided by their plan:',
    adl: ['Bathing and showering', 'Dressing', 'Grooming and personal hygiene', 'Using the bathroom and continence support', 'Eating and meal support', 'Moving around and safe transfers'],
    bullets: [],
  },
  {
    anchor: 'svc-cds',
    slug: 'community-development-services',
    name: 'Community Development Services (CDS)',
    short: 'Community Development',
    menu: 'Community Development Services',
    photo: 'd-art-class',
    alt: 'Instructor helping an adult student in an art class',
    summary: 'Classes, clubs, volunteering and outings that build skills and friendships, all chosen by the individual.',
    includes: 'A way to feel more connected to the neighborhood. Our team helps each individual develop or maintain social and other skills for getting along with all kinds of people, through activities they choose, such as classes, clubs, volunteering and outings, with personal care assistance and transportation when needed. For adults who are 18 or older and out of high school.',
    bullets: [],
  },
  {
    anchor: 'svc-respite',
    slug: 'respite-care',
    name: 'Respite Care Services',
    short: 'Respite Care',
    photo: 'd-respite-walk',
    alt: 'A woman pushing a man in a wheelchair on a sunny day',
    summary: 'A caring break for families and caregivers, while their loved one keeps familiar routines and a trusted companion.',
    includes: 'Short-term, one-to-one attention that gives the individual and their family or other primary caregiver a break from daily routines. A trained team member spends time with the individual at home or in another approved setting, helping with daily self-care such as meals, dressing and personal care, so they keep their usual routine. For adults who live in their own or their family’s home.',
    bullets: [],
  },
  {
    anchor: 'svc-transport',
    slug: 'transportation-services',
    name: 'Transportation Services',
    short: 'Transportation',
    photo: 'd-van-lift',
    alt: 'Wheelchair-accessible van with its rear lift lowered to the ground, ready for a rider',
    summary: 'Rides to the places that matter, such as community activities, appointments, shopping, worship and visits with friends and family, based on each individual’s Person-Centered Plan. The goal is to help each individual get out and about more independently.',
    includes: '',
    bullets: [],
  },
];

/** The service cards on the home page (editable list items). */
const cards = services.map((s) => ({ name: s.name, summary: s.summary, photo: s.photo, alt: s.alt, href: `/services#${s.anchor}` }));

/**
 * Home page (HLO's design, version 41): the six services in three groups. `group` is one of
 * home, life, family (headings are edited on the page). Photos are in public/img/photos.
 */
const homeCards = [
  { group: 'home', name: 'Residential Support', summary: 'A comfortable, furnished apartment home with the everyday help each individual needs, guided by their own Provider Implementation Plan (PIP).', photo: 'd-living-dining', alt: 'Furnished open-plan living and dining area in an apartment home', href: '/services#svc-residential' },
  { group: 'home', name: 'Supported Living', summary: 'Help for adults who live in their own home or apartment, so they can run their household the way they choose.', photo: 'd-kitchen-wheelchair', alt: 'Man in a wheelchair preparing vegetables in his kitchen', href: '/services#svc-supported' },
  { group: 'life', name: 'Personal Supports', summary: 'Respectful, hands-on help with daily living and health, in the individual’s own home and guided by their Person-Centered Plan.', photo: 'd-support-smile', alt: 'Woman smiling up at her support person', href: '/services#svc-personal' },
  { group: 'life', name: 'Community Development Services (CDS)', summary: 'Classes, clubs, volunteering and outings that build skills and friendships, all chosen by the individual.', photo: 'd-art-class', alt: 'Instructor helping an adult student in an art class', href: '/services#svc-cds' },
  { group: 'family', name: 'Respite Care Services', summary: 'A caring break for families and caregivers, while their loved one keeps familiar routines and a trusted companion.', photo: 'd-respite-walk', alt: 'A woman pushing a man in a wheelchair on a sunny day', href: '/services#svc-respite' },
  { group: 'family', name: 'Transportation Services', summary: 'Rides to the places that matter, such as community activities, appointments, shopping, worship and visits with friends and family, based on each individual’s Person-Centered Plan.', photo: 'd-van-lift', alt: 'Wheelchair-accessible van with its rear lift lowered to the ground, ready for a rider', href: '/services#svc-transport' },
];

/** Counties, as the design lists them (short names). */
const counties = ['Anne Arundel', 'Baltimore City', 'Baltimore', 'Harford', 'Howard', 'Calvert', 'Charles', 'Montgomery', 'Prince George’s', 'St. Mary’s'];

const conditions = [
  'Cerebral palsy', 'Muscular dystrophy', 'Multiple sclerosis', 'Blindness or severe visual impairment', 'Deafness or severe hearing impairment',
  'Behavioral support needs', 'Cystic fibrosis', 'Epilepsy or seizure disorder', 'Head injury', 'Orthopedic impairment', 'Specific learning disability',
  'Speech or language impairment', 'Spina bifida', 'Spinal cord injury', 'Other neurological impairment', 'Other disabilities',
];

const glossary = [
  { tag: 'DDA', title: 'Developmental Disabilities Administration', text: 'The Maryland Department of Health agency that determines eligibility for, funds and oversees services for people with developmental disabilities.' },
  { tag: 'HCBS', title: 'Home and Community-Based Services', text: 'Medicaid-funded supports delivered in an individual’s own home and community so they can live as independently as possible, with choice, dignity and community access.' },
  { tag: 'PCP', title: 'Person-Centered Plan', text: 'A plan developed with the individual, and the people they choose, that describes their goals, preferences, strengths and the supports they want.' },
  { tag: 'PIP', title: 'Provider Implementation Plan', text: 'The plan a provider writes from the person-centered plan. It sets out the specific supports, staffing and measurable goals, and how progress will be reviewed, with the individual and their coordinator.' },
  { tag: 'CCS', title: 'Coordinator of Community Services', text: 'The professional who helps an individual and their family plan, find and coordinate DDA services, and who often sends referrals.' },
  { tag: 'CDS', title: 'Community Development Services', text: 'Community-based activities and supports that help individuals build skills, relationships and connection to their community.' },
  { tag: 'IDD', title: 'Intellectual and Developmental Disabilities', text: 'A group of lifelong conditions that begin before adulthood and can affect learning, communication, daily living or mobility. “IDD” is the term often used in Maryland and across the country.' },
  { tag: 'Waiver', title: 'Medicaid Waiver', text: 'Medicaid funding that pays for services in an individual’s own home and community instead of in an institution. DDA runs Maryland’s waivers for people with developmental disabilities.' },
];

const link = (title, text, href, site) => ({ title, text, href, site });
const resources = {
  dda: [
    link('DDA Eligibility Application', 'The first step to DDA services. Learn who can apply, what documents are needed and how eligibility is decided.', 'https://health.maryland.gov/dda/Pages/Eligibility.aspx', 'health.maryland.gov/dda'),
    link('Coordinators of Community Services (CCS) and providers', 'A CCS helps an individual and family plan, find and coordinate DDA services. See how CCS agencies and providers work together.', 'https://health.maryland.gov/dda/Pages/CCS-and-Providers.aspx', 'health.maryland.gov/dda'),
    link('Find a DDA provider', 'Search Maryland’s directory of providers approved to deliver DDA services, by service and location.', 'https://maryland.providersearch.com/', 'maryland.providersearch.com'),
    link('Developmental Disabilities Administration (DDA)', 'The Maryland Department of Health agency that funds and oversees services for people with developmental disabilities.', 'https://health.maryland.gov/dda/Pages/Home.aspx', 'health.maryland.gov/dda'),
  ],
  guides: [
    link('DDA Guide to Services', 'An overview of the services DDA funds, for individuals and their families. The current edition is dated October 2025.', 'https://health.maryland.gov/dda/Documents/Person-Centered%20Planning/5.19.23/DDA%20Guide%20To%20Services%20May%2019%202023.pdf', 'PDF on health.maryland.gov'),
    link('DDA Easy-to-Understand Guide', 'The same guide in simple words and short sentences. The current edition is dated October 2025.', 'https://health.maryland.gov/dda/documents/person-centered%20planning/5.19.23/dda%20easy%20read%20guide%20may%2019%202023.pdf', 'PDF on health.maryland.gov'),
    link('Maryland’s definition of developmental disability', 'What “developmental disability” means under Maryland law, from the Maryland Developmental Disabilities Council.', 'https://www.md-council.org/resources/marylands-definition-of-developmental-disability/', 'md-council.org'),
  ],
  family: [
    link('Parent to Parent Maryland', 'Peer support from trained parent mentors, from The Arc Maryland. The program is for parents of children from birth to age 21, so it may suit families who are planning ahead for adulthood.', 'https://thearcmd.org/programs/parent-to-parent-maryland/', 'thearcmd.org'),
    link('The Arc Maryland resources', 'Guides, news and tools for people with intellectual and developmental disabilities and their families, plus local chapters.', 'https://thearcmd.org/resources/', 'thearcmd.org'),
    link('Maryland Developmental Disabilities Council publications', 'Reports, videos and guides on community inclusion, advocacy and services in Maryland.', 'https://www.md-council.org/publications/', 'md-council.org'),
    link('Sibling support resources', 'Resources for brothers and sisters of people with developmental disabilities.', 'https://www.md-council.org/resources/sibling-support-resources/', 'md-council.org'),
    link('Disability Rights Maryland', 'Free legal information and advocacy for Marylanders with disabilities. Phone 410-727-6352 or 1-800-233-7201 (TTY 410-235-5387).', 'https://disabilityrightsmd.org/', 'disabilityrightsmd.org'),
  ],
  more: [
    link('National Institute of Mental Health', 'Research-based information on mental health conditions.', 'https://www.nimh.nih.gov/', 'www.nimh.nih.gov'),
    link('SAMHSA', 'Substance Abuse and Mental Health Services Administration: treatment locators and resources.', 'https://www.samhsa.gov', 'www.samhsa.gov'),
    link('American Psychological Association (APA)', 'Plain-language psychology information for the public.', 'https://www.apa.org', 'www.apa.org'),
  ],
};

/** Previous / next page links at the bottom of each main page (the design's order). */
const pageOrder = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About Us' },
  { href: '/services', label: 'Services' },
  { href: '/careers', label: 'Careers' },
  { href: '/resources', label: 'Resources' },
  { href: '/contact', label: 'Contact Us' },
];

/** The main menu. */
const menu = [
  { label: 'Home', href: '/' },
  { label: 'About Us', href: '/about' },
  { label: 'Services', href: '/services' },
  { label: 'Careers', href: '/careers' },
  { label: 'Resources', href: '/resources' },
  { label: 'Contact Us', href: '/contact' },
];

module.exports = { services, cards, homeCards, counties, conditions, glossary, resources, pageOrder, menu };
