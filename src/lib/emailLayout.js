'use strict';

const config = require('../config');

/**
 * Branded HTML version of a plain-text email. Every email still carries the
 * plain text too (multipart), so it reads well in any mail program.
 *
 * The text is turned into HTML by simple rules, so callers keep writing
 * plain text:
 *  - blank lines separate blocks
 *  - a line in CAPITALS on its own is a section heading
 *  - "Label: value" lines become a two-column details table
 *  - lines starting with "- " become a bulleted list
 *  - email addresses, US phone numbers and web links become links
 * An optional `cta` ({ label, href }) adds a button.
 *
 * Inline styles and tables only: that is what email programs support.
 */

const COLORS = {
  brand: '#0f6b4a',
  brandDark: '#0b4532',
  brandSoft: '#edf8f3',
  accent: '#c41a22',
  ink: '#0f1c16',
  muted: '#475950',
  line: '#dfe8e3',
  cream: '#fbf8f3',
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const link = (href, label) => `<a href="${escape(href)}" style="color:${COLORS.brand};font-weight:600;text-decoration:underline">${label}</a>`;

/** Escape, then turn emails, phone numbers and web links into links. */
function linkify(text) {
  return escape(text)
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,)]/g, (url) => link(url.replace(/&amp;/g, '&'), url))
    .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, (m, pre, email) => `${pre}${link(`mailto:${email}`, email)}`)
    .replace(/(^|[\s(])(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})\b/g, (m, pre, phone) => `${pre}${link(`tel:${phone.replace(/[^\d]/g, '')}`, phone)}`);
}

const HEADING = /^[A-Z][A-Z0-9 &/()'-]{2,}$/;
const DETAIL = /^([A-Z][^:]{0,40}):\s+(.+)$/;

function blockToHtml(lines) {
  // A heading straight above its details: the heading, then the rest as its own block.
  if (lines.length > 1 && HEADING.test(lines[0])) return blockToHtml(lines.slice(0, 1)) + blockToHtml(lines.slice(1));
  if (lines.length === 1 && HEADING.test(lines[0])) {
    const words = lines[0].toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    return `<p style="margin:28px 0 10px;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${COLORS.accent}">${escape(words)}</p>`;
  }
  if (lines.every((l) => DETAIL.test(l))) {
    const rows = lines
      .map((l) => {
        const [, key, value] = l.match(DETAIL);
        return `<tr><td style="padding:9px 14px;border-top:1px solid ${COLORS.line};color:${COLORS.muted};font-size:14px;width:38%;vertical-align:top">${escape(key)}</td><td style="padding:9px 14px;border-top:1px solid ${COLORS.line};color:${COLORS.ink};font-size:14px;font-weight:600;vertical-align:top">${linkify(value)}</td></tr>`;
      })
      .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid ${COLORS.line};border-top:0;border-radius:10px;border-collapse:separate;background:#ffffff">${rows}</table>`;
  }
  if (lines.every((l) => l.startsWith('- '))) {
    const items = lines.map((l) => `<li style="margin:0 0 6px">${linkify(l.slice(2))}</li>`).join('');
    return `<ul style="margin:0 0 18px;padding-left:20px;color:${COLORS.ink};font-size:15px;line-height:1.6">${items}</ul>`;
  }
  return `<p style="margin:0 0 16px;color:${COLORS.ink};font-size:15px;line-height:1.65">${lines.map(linkify).join('<br>')}</p>`;
}

function bodyToHtml(text) {
  const blocks = [];
  let current = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      if (current.length) blocks.push(current);
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks.map(blockToHtml).join('\n');
}

/**
 * @param {object} opts
 * @param {string} opts.subject
 * @param {string} opts.text           the plain-text body
 * @param {object} opts.business       business details (name, phone, email, address, hours)
 * @param {{label: string, href: string}} [opts.cta]
 * @param {string} [opts.footnote]     small print under the footer
 */
function render({ subject, text, business, cta, footnote }) {
  const b = business;
  const siteUrl = config.appUrl;
  const logo = `${siteUrl}/img/logo.jpg`;
  const address = [b.address && b.address.street, b.address && [b.address.city, b.address.state].filter(Boolean).join(', ') + (b.address.zip ? ` ${b.address.zip}` : '')]
    .filter(Boolean)
    .join(', ');
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="border-radius:999px;background:${COLORS.accent}"><a href="${escape(cta.href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${escape(cta.label)} &rarr;</a></td></tr></table>`
    : '';
  const preheader = escape(String(text).split('\n').find((l) => l.trim() && !/^hello\b/i.test(l.trim())) || subject).slice(0, 140);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.cream};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream}">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT}">
      <tr><td style="background:#ffffff;border-radius:18px 18px 0 0;padding:22px 32px;border-bottom:4px solid ${COLORS.brand}">
        <a href="${escape(siteUrl)}" style="text-decoration:none"><img src="${escape(logo)}" width="160" alt="${escape(b.legalName)}" style="display:block;border:0;height:auto;max-width:160px;color:${COLORS.brand};font-size:18px;font-weight:700"></a>
      </td></tr>
      <tr><td style="background:#ffffff;padding:30px 32px 14px">
        <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${COLORS.ink};font-weight:800">${escape(subject)}</h1>
        ${bodyToHtml(text)}
        ${button}
      </td></tr>
      <tr><td style="background:${COLORS.brandDark};border-radius:0 0 18px 18px;padding:24px 32px;color:#d3efe2;font-size:13px;line-height:1.7">
        <p style="margin:0 0 6px;color:#ffffff;font-size:15px;font-weight:700">${escape(b.legalName)}</p>
        ${address ? `<p style="margin:0">${escape(address)}</p>` : ''}
        <p style="margin:0"><a href="tel:${escape(String(b.phone).replace(/[^\d]/g, ''))}" style="color:#ffffff;text-decoration:none">${escape(b.phone)}</a> &nbsp;·&nbsp; <a href="mailto:${escape(b.email)}" style="color:#ffffff;text-decoration:none">${escape(b.email)}</a></p>
        ${b.hours ? `<p style="margin:0">${escape(b.hours)}</p>` : ''}
        <p style="margin:14px 0 0;color:#ffffff;font-weight:600">For a life-threatening emergency, call 911.</p>
      </td></tr>
      <tr><td style="padding:16px 32px;color:${COLORS.muted};font-size:12px;line-height:1.6;text-align:center">
        ${escape(footnote || `You are receiving this email because you contacted ${b.legalName.replace(/\.$/, '')}.`)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

module.exports = { render, bodyToHtml, linkify };
