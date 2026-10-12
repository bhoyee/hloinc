'use strict';

/**
 * Starting content for the redesigned public pages (HLO's design, version 20,
 * October 2026). The pages read these through the Site content editor, so staff
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
    summary: 'A furnished apartment home with the day-to-day support each individual’s Provider Implementation Plan (PIP) calls for.',
    includes: 'Support to live in the community in a home that fits the individual’s needs, preferences and goals, rather than in a facility. Staff help the individual build and keep the skills they need for everyday life, as their plan calls for: daily self-care such as bathing, dressing, grooming, toileting, eating and moving around safely, plus cooking, budgeting, health appointments and getting around. The individual makes the everyday choices about their home.',
    bullets: ['Licensed DDA community residential services', 'DDA service: Community Living – Group Home', 'Furnished apartment homes'],
  },
  {
    anchor: 'svc-supported',
    slug: 'supported-living',
    name: 'Supported Living',
    short: 'Supported Living',
    photo: 'd-kitchen-wheelchair',
    alt: 'Man in a wheelchair preparing vegetables in his kitchen',
    summary: 'Support for adults who live in their own home or apartment, so they can run it the way they choose.',
    includes: 'Support for adults to use and develop independent living skills in their own home, which they own or lease, alone or with roommates. Based on the individual’s assessed need and plan, staff give direct support and personal care assistance at the agreed times, such as help with household tasks, money, daily self-care like dressing, grooming and meals, and getting out in the community.',
    bullets: [],
  },
  {
    anchor: 'svc-personal',
    slug: 'personal-supports',
    name: 'Personal Supports',
    short: 'Personal Supports',
    photo: 'd-support-smile',
    alt: 'Woman smiling up at her support person',
    summary: 'Hands-on help with daily living, health and community life in the individual’s home, guided by the individual’s person-centered plan.',
    includes: 'Support for individuals who live in their own or their family’s home and want to build independent living skills. Staff give help at home, support to take part in community life, and personal care assistance, based on needs documented in the individual’s plan that family and other natural supports do not meet.',
    adlIntro: 'help as needed with the basic self-care tasks of each day, scheduled around the individual’s routine and guided by the plan:',
    adl: ['Bathing and showering', 'Dressing', 'Grooming and personal hygiene', 'Toileting and continence care', 'Eating and meal support', 'Moving around and transfers'],
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
    summary: 'Community-based activities that build skills, friendships and connection, chosen by the individual.',
    includes: 'Support to be more connected to the community. Staff help the individual develop or maintain social and other skills for interacting with all kinds of people, through activities the individual chooses, such as classes, clubs, volunteering and outings, with personal care assistance and transportation when needed. For adults who are 18 or older and out of high school.',
    bullets: [],
  },
  {
    anchor: 'svc-respite',
    slug: 'respite-care',
    name: 'Respite Care Services',
    short: 'Respite Care',
    photo: 'd-boardwalk',
    alt: 'Friends on a relaxed walk along a boardwalk',
    summary: 'Short-term relief for families and caregivers while the individual keeps receiving quality supports.',
    includes: 'Short-term, one-to-one support that gives the individual and their family or other primary caregiver a break from daily routines. A trained support person spends time with the individual at home or in another approved setting, helping with daily self-care such as meals, dressing and personal care, so the individual keeps their usual routine. For individuals who live in their own or their family’s home.',
    bullets: [],
  },
  {
    anchor: 'svc-transport',
    slug: 'transportation-services',
    name: 'Transportation Services',
    short: 'Transportation',
    photo: 'd-van',
    alt: 'Silver Toyota Sienna minivan converted to be wheelchair accessible, with a side-entry ramp',
    summary: 'Transportation to and from community activities and appointments, such as shopping, church and personal visits, based on the needs in each person’s Person-Centered Plan.',
    detail: 'Transportation services are designed specifically to improve the participant’s ability to independently access community activities within their own community in response to needs identified through the participant’s Person-Centered Plan.',
    includes: '',
    bullets: [],
  },
];

/** The service cards on the home page (editable list items). */
const cards = services.map((s) => ({ name: s.name, summary: s.summary, photo: s.photo, alt: s.alt, href: `/services#${s.anchor}` }));

/** Counties, as the design lists them (short names). */
const counties = ['Anne Arundel', 'Baltimore City', 'Baltimore', 'Harford', 'Howard', 'Calvert', 'Charles', 'Montgomery', 'Prince George’s', 'St. Mary’s'];

const conditions = [
  'Cerebral Palsy', 'Muscular Dystrophy', 'Multiple Sclerosis', 'Blindness / Severe Visual Impairment', 'Deafness / Severe Hearing Impairment',
  'Behavioral support needs', 'Cystic Fibrosis', 'Epilepsy / Seizure Disorder', 'Head Injury', 'Orthopedic Impairment', 'Specific Learning Disability',
  'Speech / Language Impairment', 'Spina Bifida', 'Spinal Cord Injury', 'Other Neurological Impairment', 'Other undetermined disabilities',
];

const glossary = [
  { tag: 'DDA', title: 'Developmental Disabilities Administration', text: 'The Maryland Department of Health agency that determines eligibility for, funds and oversees services for individuals with developmental disabilities.' },
  { tag: 'HCBS', title: 'Home and Community-Based Services', text: 'Medicaid-funded supports delivered in an individual’s home and community so they can live as independently as possible, with choice, dignity and community access.' },
  { tag: 'PCP', title: 'Person-Centered Plan', text: 'A plan developed with the person, and the people they choose, that describes their goals, preferences, strengths and the supports they want.' },
  { tag: 'PIP', title: 'Provider Implementation Plan', text: 'The plan a provider writes from the person-centered plan. It sets out the specific supports, staffing and measurable goals, and how progress will be reviewed, with the individual and their coordinator.' },
  { tag: 'CCS', title: 'Coordinator of Community Services', text: 'The person who helps an individual and family plan, find and coordinate DDA services, and who often sends referrals.' },
  { tag: 'CDS', title: 'Community Development Services', text: 'Community-based activities and supports that help individuals build skills, relationships and connection to their community.' },
  { tag: 'IDD', title: 'Intellectual and Developmental Disabilities', text: 'A group of lifelong conditions that begin in childhood and affect learning, communication, daily living or movement. “IDD” is the term often used in Maryland and across the country.' },
  { tag: 'Waiver', title: 'Medicaid Waiver', text: 'Medicaid funding that pays for services in an individual’s home and community instead of in an institution. DDA runs Maryland’s waivers for individuals with developmental disabilities.' },
];

const link = (title, text, href, site) => ({ title, text, href, site });
const resources = {
  dda: [
    link('DDA Eligibility Application', 'The first step to DDA services. Learn who can apply, what documents are needed and how eligibility is decided.', 'https://health.maryland.gov/dda/Pages/Eligibility.aspx', 'health.maryland.gov/dda'),
    link('Coordinators of Community Services (CCS) and providers', 'A CCS helps an individual and family plan, find and coordinate DDA services. See how CCS agencies and providers work together.', 'https://health.maryland.gov/dda/Pages/CCS-and-Providers.aspx', 'health.maryland.gov/dda'),
    link('Find a DDA provider', 'Search Maryland’s directory of providers approved to deliver DDA services, by service and location.', 'https://maryland.providersearch.com/', 'maryland.providersearch.com'),
    link('Developmental Disabilities Administration (DDA)', 'The Maryland Department of Health agency that funds and oversees services for individuals with developmental disabilities.', 'https://health.maryland.gov/dda/Pages/Home.aspx', 'health.maryland.gov/dda'),
  ],
  guides: [
    link('DDA Guide to Services', 'A plain-language overview of the services DDA funds and how an individual’s plan connects to them.', 'https://health.maryland.gov/dda/Documents/Person-Centered%20Planning/5.19.23/DDA%20Guide%20To%20Services%20May%2019%202023.pdf', 'PDF on health.maryland.gov'),
    link('DDA Easy Read Guide', 'An easy-to-read version of the DDA guide, with simple words and short sentences for individuals and families.', 'https://health.maryland.gov/dda/documents/person-centered%20planning/5.19.23/dda%20easy%20read%20guide%20may%2019%202023.pdf', 'PDF on health.maryland.gov'),
    link('Maryland’s definition of developmental disability', 'What “developmental disability” means under Maryland law, from the Maryland Developmental Disabilities Council.', 'https://www.md-council.org/resources/marylands-definition-of-developmental-disability/', 'md-council.org'),
  ],
  family: [
    link('Parent to Parent Maryland', 'Connects families of individuals with intellectual and developmental disabilities with trained parent mentors, from The Arc Maryland.', 'https://thearcmd.org/programs/parent-to-parent-maryland/', 'thearcmd.org'),
    link('The Arc Maryland resources', 'Guides, news and tools for individuals with intellectual and developmental disabilities and their families, plus local chapters.', 'https://thearcmd.org/resources/', 'thearcmd.org'),
    link('Maryland Developmental Disabilities Council publications', 'Reports, videos and guides on community inclusion, advocacy and services in Maryland.', 'https://www.md-council.org/publications/', 'md-council.org'),
    link('Sibling support resources', 'Resources for brothers and sisters of individuals with developmental disabilities.', 'https://www.md-council.org/resources/sibling-support-resources/', 'md-council.org'),
    link('Disability Rights Maryland', 'Free legal information and advocacy for Marylanders with disabilities. Phone (410) 727-6352 or 1-800-233-7201.', 'https://disabilityrightsmd.org/', 'disabilityrightsmd.org'),
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

module.exports = { services, cards, counties, conditions, glossary, resources, pageOrder, menu };
