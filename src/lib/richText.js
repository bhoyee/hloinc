'use strict';

/**
 * Formatted text written in the portal's editor (email replies). Only simple,
 * safe formatting is kept: paragraphs, line breaks, bold, italic, underline,
 * strikethrough, lists, quotes, links (https, http, mailto, tel) and four text
 * sizes (small, normal, large, huge, as classes on paragraphs). Everything
 * else (scripts, styles, images, unknown tags and attributes) is removed.
 */
const sanitizeHtml = require('sanitize-html');

// Text sizes: the only classes allowed. The browser's <font size> becomes one of these.
const SIZES = { 'rt-small': '13px', 'rt-large': '19px', 'rt-huge': '24px' };
const FONT_SIZE = { 1: 'rt-small', 2: 'rt-small', 5: 'rt-large', 6: 'rt-huge', 7: 'rt-huge' };

const OPTIONS = {
  allowedTags: ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'ul', 'ol', 'li', 'blockquote', 'a', 'span'],
  allowedAttributes: { a: ['href'], span: ['class'], p: ['class'], li: ['class'] },
  allowedClasses: { span: Object.keys(SIZES), p: Object.keys(SIZES), li: Object.keys(SIZES) },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // Editors wrap lines in <div>; treat them as paragraphs. Use one tag per meaning.
  transformTags: {
    div: 'p',
    b: 'strong',
    i: 'em',
    strike: 's',
    font: (tag, attribs) => ({ tagName: 'span', attribs: FONT_SIZE[attribs.size] ? { class: FONT_SIZE[attribs.size] } : {} }),
  },
};

/** The cleaned HTML, or '' if nothing is left. */
function clean(html) {
  const out = sanitizeHtml(String(html || ''), OPTIONS)
    .replace(/<a>(.*?)<\/a>/g, '$1') // a link whose address wasn't safe: keep its words
    .replace(/<span>(.*?)<\/span>/g, '$1') // spans with no (allowed) size: just the words
    .replace(/<p>\s*(<br \/>)?\s*<\/p>/g, '') // empty lines the editor leaves behind
    .trim();
  return toText(out) ? out : '';
}

const decode = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

/** A plain-text version of cleaned HTML (for the text part of emails and for searching). */
function toText(html) {
  return decode(
    String(html)
      .replace(/<ol>([\s\S]*?)<\/ol>/g, (m, items) => {
        let n = 0;
        return `\n${items.replace(/<li>/g, () => `${(n += 1)}. `)}</ol>`;
      })
      .replace(/<ul>/g, '\n')
      .replace(/<li>/g, '- ')
      .replace(/<a href="([^"]*)">(.*?)<\/a>/g, (m, href, label) => {
        const plain = label.replace(/<[^>]+>/g, '');
        return plain === href.replace(/^mailto:|^tel:/, '') ? plain : `${plain} (${href})`;
      })
      .replace(/<blockquote>/g, '\n> ')
      .replace(/<br \/>/g, '\n')
      .replace(/<\/(p|li|ul|ol|blockquote)>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cleaned HTML with inline styles that email programs respect. */
function forEmail(html, { ink = '#0f1c16', link = '#0f6b4a', muted = '#475950' } = {}) {
  const size = (cls) => (cls && SIZES[cls] ? `font-size:${SIZES[cls]};line-height:1.4;${cls === 'rt-huge' ? 'font-weight:700;' : ''}` : '');
  return String(html)
    .replace(/<p class="(rt-[a-z]+)">/g, (m, cls) => `<p style="margin:0 0 16px;color:${ink};font-size:15px;line-height:1.65;${size(cls)}">`)
    .replace(/<li class="(rt-[a-z]+)">/g, (m, cls) => `<li style="margin:0 0 6px;${size(cls)}">`)
    .replace(/<p>/g, `<p style="margin:0 0 16px;color:${ink};font-size:15px;line-height:1.65">`)
    .replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:22px;color:${ink};font-size:15px;line-height:1.6">`)
    .replace(/<ol>/g, `<ol style="margin:0 0 16px;padding-left:22px;color:${ink};font-size:15px;line-height:1.6">`)
    .replace(/<li>/g, '<li style="margin:0 0 6px">')
    .replace(/<blockquote>/g, `<blockquote style="margin:0 0 16px;padding:4px 0 4px 14px;border-left:3px solid #dfe8e3;color:${muted}">`)
    .replace(/<a href=/g, `<a style="color:${link};font-weight:600" href=`)
    .replace(/<span class="(rt-[a-z]+)">/g, (m, cls) => `<span style="${size(cls)}">`);
}

/** True for text saved from the editor (HTML), false for older plain text. */
const isHtml = (value) => /^\s*<(p|ul|ol|blockquote|strong|em|u|s|a)[\s>]/i.test(String(value || ''));

module.exports = { clean, toText, forEmail, isHtml };
