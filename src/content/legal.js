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

const LAST_UPDATED = '2026-10-10';

const privacy = {
  slug: 'privacy',
  title: 'Privacy Policy',
  summary:
    'How Healthy Living Option Inc. collects, uses and protects personal information through this website.',
  sections: [
    {
      id: 'scope',
      heading: 'Who we are and what this policy covers',
      paragraphs: [
        'Healthy Living Option Inc. (“HLO”, “we”, “us”) provides community-based supports for adults with intellectual and developmental disabilities in Maryland. This policy explains how we handle personal information collected through this website, including our contact form and appointment request form.',
        'This policy covers the website only. Information about people who receive HLO services is handled under our service records and privacy practices, which we provide to people we support and their representatives.',
      ],
    },
    {
      id: 'collect',
      heading: 'Information we collect',
      paragraphs: ['We collect only what we need to respond to you:'],
      list: [
        'Contact form: your name, email address, phone number (optional), the person or team you chose to contact, and your message.',
        'Appointment requests: your name, email address, phone number (optional), how you prefer to be contacted, the type of appointment, your preferred date and time of day, and any notes you choose to add.',
        'Requests for services: your name, phone number, email address, how and when you prefer to be contacted, your relationship to the person who needs support, and, if you choose to share them, their first name, county, DDA eligibility status, Person-Centered Plan status, DDA funding priority category, the services of interest and any message.',
        'Referrals: the referrer’s name, phone number, email address, role and agency (optional); and the referred person’s first name or initials, county and, if known, their living situation, DDA eligibility status, Person-Centered Plan status, DDA funding priority category, the services needed and how soon. We ask referrers to confirm they are authorized to share this information.',
        'Technical information: your IP address is stored with form submissions to help us prevent spam and abuse. Our hosting provider also keeps standard server logs (such as IP address, browser type and pages requested) for security and reliability.',
        'Cookies: we use one essential cookie. See our Cookie Policy for details.',
      ],
    },
    {
      id: 'spam',
      heading: 'Keeping our forms free of spam',
      paragraphs: [
        'To stop automated spam, our forms use hidden checks, record when a form was opened, and store your IP address with your submission. For up to 24 hours we also keep a one-way scrambled (hashed) version of the email address used, to limit repeated submissions. This information is used only to protect our forms.',
      ],
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
      id: 'health',
      heading: 'Please do not send health information',
      paragraphs: [
        'Our forms are not designed for medical or clinical information. Please do not include diagnoses, medication details or other health records in a form or message. If you need to share this kind of information, our team will arrange a secure way to do so.',
      ],
    },
    {
      id: 'use',
      heading: 'How we use your information',
      list: [
        'To reply to your message and route it to the right member of our team.',
        'To follow up on referrals with the referrer and the person being referred.',
        'To review, arrange and confirm appointment requests, and to send you related emails.',
        'To keep the website secure, prevent spam and investigate misuse.',
        'To meet our legal and regulatory obligations.',
      ],
      paragraphs: ['We do not use your information for advertising, and we do not sell or rent personal information.'],
    },
    {
      id: 'share',
      heading: 'When we share information',
      paragraphs: ['We share personal information only when necessary:'],
      list: [
        'With service providers who help us run the website and deliver email (for example, our web host and email provider). They may use the information only to provide their services to us.',
        'When required by law, regulation, court order or a government agency, or to protect the safety of any person.',
        'With your permission.',
      ],
    },
    {
      id: 'careers',
      heading: 'Job applications',
      paragraphs: [
        'Job applications are handled through ADP, our recruitment provider. When you select “Apply”, you leave this website and ADP’s privacy policy applies to the information you give them.',
      ],
    },
    {
      id: 'links',
      heading: 'Links to other websites',
      paragraphs: [
        'Our Resources page links to independent organizations. We are not responsible for their content or privacy practices, and we encourage you to read their policies.',
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep information',
      // CONFIRM — client question 8: state the agreed retention periods here.
      paragraphs: [
        'We keep website messages and appointment requests only as long as needed for the purpose they were sent and to meet our legal and record-keeping obligations. After that, we delete them or make them anonymous.',
      ],
    },
    {
      id: 'security',
      heading: 'How we protect information',
      paragraphs: [
        'We use technical and organizational safeguards to protect personal information. Our Data Protection page describes them in more detail. No website or system can be guaranteed completely secure, but we work to keep your information safe.',
      ],
    },
    {
      id: 'choices',
      heading: 'Your choices and requests',
      paragraphs: [
        'You can ask us to tell you what personal information we hold about you from this website, to correct it, or to delete it, subject to any legal requirement for us to keep it. To make a request, contact us using the details below. We may need to verify your identity before acting on a request.',
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      paragraphs: [
        'This website is intended for adults. We do not knowingly collect personal information from children under 13 through this website.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      paragraphs: [
        'We may update this policy from time to time. The date at the top of the page shows when it was last changed.',
      ],
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
        'Links to other websites, including our recruitment provider ADP and the organizations on our Resources page, are provided for convenience. We do not control those websites and are not responsible for their content, availability or practices.',
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
        'When you follow a link to another website, such as ADP for job applications or Google Maps for directions, that website may set its own cookies under its own policy.',
        'Our contact page can show a Google map of our office. The map loads only if you select “Show map”; until then, nothing is loaded from Google. Once loaded, Google may set cookies under its own privacy policy.',
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

const pages = { privacy, terms, 'data-protection': dataProtection, cookies };
for (const page of Object.values(pages)) page.lastUpdated = LAST_UPDATED;

module.exports = pages;
