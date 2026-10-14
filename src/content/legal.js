'use strict';

/**
 * Legal pages. DRAFT — must be reviewed by HLO's legal counsel before launch.
 * Text describes what the site actually does; keep it in sync when features
 * change (new cookies, analytics, new forms, retention period, MFA).
 *
 * Each section: { id, heading, paragraphs: [], list?: [], onlyIf?: 'turnstile' }
 * Sections with `onlyIf` are shown only when that feature is switched on.
 * `{business}`-style tokens are not used — the template passes `site` for
 * contact details shown at the end of every page.
 */

const LAST_UPDATED = '2026-10-14';

const privacy = {
  slug: 'privacy',
  // Version 41 wording (October 2026): new keys so earlier edits of the old policy don't override it.
  cmsKey: 'privacy.v41',
  title: 'Privacy Policy',
  summary: 'How we handle information collected through this website.',
  sections: [
    {
      id: 'scope',
      heading: 'What this policy covers',
      paragraphs: [
        'This policy explains what information Healthy Living Option Inc. (“HLO Inc.”, “we”, “us”) collects through this website, how we use it, and the choices you have. It covers this website only. It does not describe how we handle records of individuals who receive our services. Please ask us about those practices.',
      ],
    },
    {
      id: 'give',
      heading: 'Information you give us',
      paragraphs: ['When you use a form on this site, we receive what you type into it. Depending on the form, that can include:'],
      list: [
        'your name, phone number and email address, and how you prefer to be contacted;',
        'your relationship to the individual who needs help, and the individual’s first name or initials, county, and answers about DDA eligibility, funding priority category, Person-Centered Plan status and services of interest;',
        'for referrals, the referrer’s role and agency, and what you choose to tell us about the individual’s situation and the services needed;',
        'for job applications, your contact details, the position you want, your resume and your message.',
      ],
    },
    {
      id: 'sensitive',
      heading: 'Please do not send sensitive documents',
      paragraphs: [
        'Please do not send Social Security numbers, medical records or other sensitive documents through the forms or by ordinary email. We will arrange a secure way to collect anything we need.',
      ],
    },
    {
      id: 'automatic',
      heading: 'Information collected automatically',
      paragraphs: [
        'Like most websites, the servers that deliver this site receive your IP address, browser type and the pages you request. We use this only to operate and protect the site.',
        'To stop automated spam, our forms use hidden checks, record when a form was opened, and store your IP address with your submission. For up to 24 hours we also keep a one-way scrambled (hashed) version of the email address used, to limit repeated submissions.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies and your browser',
      paragraphs: [
        'This site uses one strictly necessary cookie, described below. It does not set advertising or tracking cookies, and we do not use analytics.',
        'Your browser also remembers your light or dark theme choice, and that you closed our cookie notice. These stay on your device and are never sent to us.',
      ],
      table: {
        caption: 'Cookies set by this website',
        head: ['Name', 'Purpose', 'Type', 'How long it lasts'],
        rows: [
          ['hlo.sid', 'Keeps forms secure (prevents forged submissions and spam) and keeps staff signed in to the staff portal.', 'Strictly necessary', 'Expires after a period of inactivity'],
        ],
      },
    },
    {
      id: 'turnstile',
      onlyIf: 'turnstile',
      heading: 'Security check by Cloudflare',
      paragraphs: [
        'Our forms use Cloudflare Turnstile to check that a person, not an automated program, is sending them. Turnstile processes technical information about your browser and device for this purpose only, under Cloudflare’s privacy policy (cloudflare.com/privacypolicy).',
      ],
    },
    {
      id: 'third-party',
      heading: 'Third-party services',
      // HTML for the bold labels.
      html:
        '<ul><li><strong>Maps.</strong> The map on the Home and Contact pages is provided by Google Maps. When it loads, Google receives your IP address and browser details, and its privacy policy applies.</li>' +
        '<li><strong>Email.</strong> Messages from our forms are delivered by our email provider, which may use them only to deliver them to us.</li>' +
        '<li><strong>Resumes.</strong> Every resume sent with a job application is checked for viruses by an automated scanning service, which scans it in memory and does not keep a copy.</li>' +
        '<li><strong>External links.</strong> Links on the Resources page go to other organizations’ websites. We do not control them and are not responsible for their privacy practices.</li></ul>',
    },
    {
      id: 'use',
      heading: 'How we use information',
      list: [
        'to respond to your questions, requests for services and referrals;',
        'to consider job applications;',
        'to keep the website secure and working properly.',
      ],
    },
    {
      id: 'share',
      heading: 'When we share information',
      paragraphs: [
        'We share information only as needed to respond to your request, with service providers who help us run this site and receive form submissions, and when the law requires it. We do not sell your information.',
      ],
    },
    {
      id: 'careers',
      heading: 'Job applications',
      paragraphs: [
        'We use what you send with a job application only to consider you for that role and similar roles at HLO Inc. Resumes are stored encrypted, are never sent by email, and only HLO Inc. staff responsible for hiring can open them. Resumes are deleted automatically three months after an application arrives; the rest of the application is kept with our hiring records.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep information',
      paragraphs: [
        'We keep website messages and requests only as long as needed for the purpose they were sent and to meet our legal and record-keeping obligations. After that, we delete them or make them anonymous.',
      ],
    },
    {
      id: 'security',
      heading: 'How we protect information',
      paragraphs: [
        'We use technical and organizational safeguards to protect personal information, including encrypted connections, limited staff access and a record of who opens what. No website or system can be guaranteed completely secure, but we work to keep your information safe.',
      ],
    },
    {
      id: 'choices',
      heading: 'Your choices',
      paragraphs: [
        'You can ask us what information you have sent us through this site, or ask us to correct or delete it, by contacting us below. The law may require us to keep some information. We may need to confirm who you are before acting on a request.',
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      paragraphs: ['This site is written for adults and for the families and professionals who care for them. It is not directed to children under 13.'],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      paragraphs: ['If we change this policy, we will post the new version here and update the date above.'],
    },
  ],
};

/** Accessibility statement (HLO's design, version 41). */
const accessibility = {
  slug: 'accessibility',
  title: 'Accessibility',
  summary: 'Our commitment to a website everyone can use.',
  updatedLabel: 'Last reviewed:',
  sections: [
    {
      id: 'commitment',
      heading: 'Our commitment',
      paragraphs: [
        'Healthy Living Option Inc. wants everyone, including people with disabilities, to be able to use this website. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA.',
      ],
    },
    {
      id: 'done',
      heading: 'What we have done',
      list: [
        'Every page can be used with a keyboard, and a “Skip to main content” link is the first thing on each page.',
        'Text and controls meet the minimum contrast ratios, and keyboard focus is clearly visible.',
        'Text sizes follow your browser’s text-size setting, and pages reflow when you zoom in.',
        'Form fields have labels. Errors are listed at the top of the form and next to each field.',
        'Images that carry meaning have text descriptions. Animations are reduced if your device is set to reduce motion.',
        'You can switch between a light and a dark theme.',
      ],
    },
    {
      id: 'limitations',
      heading: 'Known limitations',
      list: [
        'The map is provided by Google. If you cannot use it, our address and a “Get directions” link are given as text.',
        'Third-party websites linked from the Resources page are outside our control.',
      ],
    },
    {
      id: 'problem',
      heading: 'Tell us about a problem',
      html:
        '<p>If you have trouble using any part of this site, or you need information in another format such as large print or an accessible electronic document, please tell us using the contact details below. We will work with you to provide it.</p>' +
        '<p>See also our <a href="/nondiscrimination">nondiscrimination and language help</a> notice.</p>',
    },
  ],
};

/** Nondiscrimination notice and free language help (HLO's design, version 41). */
const nondiscrimination = {
  slug: 'nondiscrimination',
  title: 'Nondiscrimination and Language Help',
  summary: 'Free help communicating with us, and how to raise a concern.',
  sections: [
    {
      id: 'notice',
      heading: 'Notice of nondiscrimination',
      paragraphs: [
        'Healthy Living Option Inc. complies with applicable Federal civil rights laws and does not discriminate on the basis of race, color, national origin, age, disability, or sex. We do not exclude people or treat them differently because of race, color, national origin, age, disability, or sex.',
      ],
    },
    {
      id: 'help',
      heading: 'Free help communicating with us',
      paragraphs: ['We provide free aids and services to people with disabilities so they can communicate effectively with us, such as:'],
      list: [
        'qualified sign language interpreters;',
        'written information in other formats, such as large print, audio and accessible electronic formats.',
      ],
    },
    {
      id: 'language',
      heading: 'Free language services',
      paragraphs: [
        'We provide free language services to people whose primary language is not English, such as qualified interpreters and information written in other languages.',
        'If you need these services, call or email us using the contact details below.',
      ],
    },
    {
      id: 'grievance',
      heading: 'If you believe we have not followed this notice',
      // HTML so the complaint addresses are links.
      html:
        '<p>If you believe we have failed to provide these services or have discriminated in another way, you can file a grievance with us. You can file in person, by mail, by phone or by email, using the contact details below. If you need help filing a grievance, we will help you.</p>' +
        '<p>You can also file a civil rights complaint with the U.S. Department of Health and Human Services, Office for Civil Rights:</p>' +
        '<ul><li>Online, through the <a href="https://ocrportal.hhs.gov/ocr/portal/lobby.jsf">Office for Civil Rights Complaint Portal</a></li>' +
        '<li>By phone: 1-800-368-1019 (TDD 800-537-7697)</li>' +
        '<li>By mail: U.S. Department of Health and Human Services, 200 Independence Avenue SW, Room 509F, HHH Building, Washington, DC 20201</li></ul>' +
        '<p>Complaint forms are available at <a href="https://www.hhs.gov/ocr/complaints/index.html">hhs.gov/ocr/complaints</a>.</p>',
    },
  ],
};

const terms = {
  slug: 'terms',
  title: 'Terms and Conditions',
  summary: 'The terms that apply when you use the Healthy Living Option Inc. website.',
  sections: [
    {
      id: 'acceptance',
      heading: 'Using this website',
      paragraphs: [
        'This website is operated by Healthy Living Option Inc. (“HLO”, “we”, “us”). By using it, you agree to these terms. If you do not agree, please do not use the website.',
      ],
    },
    {
      id: 'emergency',
      heading: 'Not for emergencies',
      paragraphs: [
        'This website and its forms are not monitored around the clock. In an emergency, call 911. For a mental health crisis, call or text 988.',
      ],
    },
    {
      id: 'information',
      heading: 'Information only',
      paragraphs: [
        'Content on this website is general information about HLO and its services. It is not medical, clinical, legal or financial advice, and it is not a promise that any person is eligible for, or will receive, a particular service.',
        'Eligibility for Developmental Disabilities Administration (DDA) funded services is decided by the Maryland Developmental Disabilities Administration. The services a person receives depend on their eligibility, their person-centered plan and availability.',
      ],
    },
    {
      id: 'appointments',
      heading: 'Appointment requests and messages',
      paragraphs: [
        'Submitting an appointment request does not create a confirmed appointment. An appointment is confirmed only when a member of our team confirms it with you. Sending a message through the website does not make you a client of HLO.',
        'Please give accurate information and do not include diagnoses, medication details or other health records in website forms.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Acceptable use',
      paragraphs: ['You agree not to:'],
      list: [
        'use the website for anything unlawful, harmful or fraudulent;',
        'send spam, or submit false or misleading information;',
        'try to gain unauthorized access to the website, the staff portal or our systems, or interfere with their security or operation;',
        'copy, scrape or reuse website content except as allowed below.',
      ],
    },
    {
      id: 'staff-portal',
      heading: 'Staff portal',
      paragraphs: [
        'The staff portal is for authorized HLO staff only. Access is monitored and recorded. Unauthorized access or attempted access is prohibited.',
      ],
    },
    {
      id: 'ip',
      heading: 'Content and trademarks',
      paragraphs: [
        'The HLO name, logo and website content belong to HLO or are used with permission. You may view and print pages for your personal, non-commercial use. Any other use requires our written permission.',
      ],
    },
    {
      id: 'third-party',
      heading: 'Third-party websites',
      paragraphs: [
        'Links to other websites are provided for convenience. We do not control those websites and are not responsible for their content, availability or practices.',
      ],
    },
    {
      id: 'liability',
      heading: 'Disclaimer and limitation of liability',
      paragraphs: [
        'We work to keep this website accurate and available, but it is provided “as is” and we do not guarantee that it will always be complete, current, uninterrupted or free of errors.',
        'To the extent permitted by law, HLO is not liable for any loss or damage arising from your use of, or inability to use, this website or any information on it. Nothing in these terms limits any liability that cannot be limited by law.',
      ],
    },
    {
      id: 'law',
      heading: 'Governing law',
      paragraphs: ['These terms are governed by the laws of the State of Maryland and applicable United States law.'],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      paragraphs: [
        'We may update these terms from time to time. The date at the top of the page shows when they were last changed. Continuing to use the website after a change means you accept the updated terms.',
      ],
    },
  ],
};

const dataProtection = {
  slug: 'data-protection',
  title: 'Data Protection',
  summary: 'The safeguards HLO uses to protect personal information collected through this website and staff portal.',
  sections: [
    {
      id: 'commitment',
      heading: 'Our commitment',
      paragraphs: [
        'The people we support and their families trust us with their information. We protect it by collecting as little as possible, limiting who can see it, and securing the systems that hold it.',
      ],
    },
    {
      id: 'minimization',
      heading: 'Collecting only what we need',
      list: [
        'Website forms ask only for contact details and the information needed to respond or arrange an appointment.',
        'Forms do not ask for diagnoses, medication details or other health records.',
        'There are no customer accounts on this website, so we do not hold visitor passwords.',
        'We do not use advertising or tracking cookies.',
      ],
    },
    {
      id: 'safeguards',
      heading: 'Technical safeguards',
      list: [
        'Encrypted connections (HTTPS) between your browser and our website.',
        'Staff passwords are stored using one-way hashing, never in plain text.',
        'Staff sessions expire after a period of inactivity and can be ended remotely.',
        'Protection against common web attacks, including cross-site request forgery, and strict browser security policies.',
        'Rate limits and spam checks on public forms.',
        'Private files are stored outside the public website.',
      ],
    },
    {
      id: 'access',
      heading: 'Who can see your information',
      list: [
        'Only named, authorized HLO staff can sign in to the staff portal; there are no shared accounts.',
        'Each staff role can see only the information it needs. For example, messages for the intake team are visible to intake staff and managers.',
        'Important actions, such as viewing, changing or deleting records, are recorded in an audit log.',
        'Accounts are removed or deactivated promptly when staff leave.',
      ],
    },
    {
      id: 'retention',
      heading: 'Keeping and deleting information',
      // CONFIRM — client question 8: add agreed retention periods.
      paragraphs: [
        'We keep information only as long as needed for the purpose it was collected and to meet legal and record-keeping requirements. We then delete it or make it anonymous. Backups are kept securely and expire on a set schedule.',
      ],
    },
    {
      id: 'incidents',
      heading: 'If something goes wrong',
      paragraphs: [
        'If we become aware of a security incident affecting personal information, we will investigate promptly, take steps to contain it, and notify affected people and authorities as required by Maryland law and other applicable law.',
      ],
    },
    {
      id: 'partners',
      heading: 'Service providers',
      paragraphs: [
        'We use carefully chosen providers for hosting and email. They may process information only on our instructions and must protect it.',
      ],
    },
    {
      id: 'questions',
      heading: 'Questions or concerns',
      paragraphs: [
        'If you have a question about how we protect information, or want to make a request about your information, please contact us using the details below. You can also read our Privacy Policy and Cookie Policy.',
      ],
    },
  ],
};

const cookies = {
  slug: 'cookies',
  title: 'Cookie Policy',
  summary: 'The cookies this website uses and why.',
  sections: [
    {
      id: 'what',
      heading: 'What cookies are',
      paragraphs: [
        'Cookies are small text files that a website stores in your browser. They help the website remember information between pages.',
      ],
    },
    {
      id: 'ours',
      heading: 'Cookies we use',
      paragraphs: [
        'This website uses only strictly necessary cookies. We do not use analytics, advertising or social media tracking cookies.',
      ],
      table: {
        caption: 'Cookies set by this website',
        head: ['Name', 'Purpose', 'Type', 'How long it lasts'],
        rows: [
          [
            'hlo.sid',
            'Keeps forms secure (prevents forged submissions and spam) and keeps staff signed in to the staff portal.',
            'Strictly necessary',
            'Expires after a period of inactivity',
          ],
        ],
      },
    },
    {
      id: 'turnstile',
      onlyIf: 'turnstile',
      heading: 'Security check on our forms',
      paragraphs: [
        'Our contact, referral and appointment forms include a Cloudflare Turnstile security check. Cloudflare may store information in your browser that is needed to run that check. It is used for security only, never for advertising or tracking.',
      ],
    },
    {
      id: 'storage',
      heading: 'Other storage',
      paragraphs: [
        'If you close our cookie notice, your browser remembers that choice using local storage on your device so the notice is not shown again. It contains no personal information and is never sent to us.',
      ],
    },
    {
      id: 'choices',
      heading: 'Your choices',
      paragraphs: [
        'Because these cookies are needed for the website to work securely, they do not require consent. You can block or delete cookies in your browser settings, but the contact and appointment forms, and the staff portal, will not work without them.',
      ],
    },
    {
      id: 'third-party',
      heading: 'Other websites',
      paragraphs: [
        'When you follow a link to another website, such as Google Maps for directions, that website may set its own cookies under its own policy.',
        'Our home and contact pages show a Google map of our office. The map is provided by Google, which may set cookies under its own privacy policy.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes',
      paragraphs: [
        'If we add new cookies, for example to understand how the website is used, we will update this policy and ask for your consent first where required.',
      ],
    },
  ],
};

const pages = { privacy, accessibility, nondiscrimination, terms, 'data-protection': dataProtection, cookies };
/** Linked from the footer and between legal pages. Terms, Data Protection and Cookie Policy are hidden (October 2026). */
const LISTED = ['privacy', 'accessibility', 'nondiscrimination'];
for (const page of Object.values(pages)) page.lastUpdated = LAST_UPDATED;

module.exports = pages;
Object.defineProperty(module.exports, 'LISTED', { value: LISTED });
