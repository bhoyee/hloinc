'use strict';

const { escape } = require('nunjucks').lib;

/**
 * Plain text written by staff -> safe HTML. Blank lines separate paragraphs;
 * lines starting with "- " or "• " become a bulleted list. Everything is
 * HTML-escaped first, so staff can't (accidentally) inject markup.
 */
function richText(text) {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split('\n');
      const html = [];
      let list = [];
      const flush = () => {
        if (list.length) html.push(`<ul>${list.map((li) => `<li>${li}</li>`).join('')}</ul>`);
        list = [];
      };
      let para = [];
      const flushPara = () => {
        if (para.length) html.push(`<p>${para.join('<br>')}</p>`);
        para = [];
      };
      for (const raw of lines) {
        const line = raw.trim();
        const bullet = line.match(/^[-•*]\s+(.*)$/);
        if (bullet) {
          flushPara();
          list.push(escape(bullet[1]));
        } else {
          flush();
          para.push(escape(line));
        }
      }
      flushPara();
      flush();
      return html.join('');
    })
    .join('');
}

/**
 * Escape `text` and wrap case-insensitive matches of `query` in <mark>.
 * Matching runs on the escaped text with an escaped query, so it can never
 * produce broken or unsafe HTML.
 */
function highlight(text, query) {
  const safe = escape(String(text || ''));
  const q = escape(String(query || '').trim());
  if (q.length < 2) return safe;
  const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return safe.replace(pattern, (m) => `<mark class="rounded bg-accent-100 px-0.5 text-inherit">${m}</mark>`);
}

module.exports = { richText, highlight };
