'use strict';

/**
 * The monthly report as a branded PDF (US Letter), drawn with pdfkit: pure
 * JavaScript, so it runs on shared hosting without a browser.
 *
 * Page 1: logo, month, six highlight figures. Then one block per area: a table
 * of measures against last month, and bar charts of the breakdowns. Every page
 * has a footer with the page number and a "counts only" confidentiality line.
 */
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO = path.join(__dirname, '../../public/img/logo.png');
const C = {
  brand: '#0f6b4a',
  brandDark: '#0b4532',
  brandSoft: '#edf8f3',
  bar: '#12845a',
  ink: '#0f1c16',
  muted: '#475950',
  faint: '#8a9a92',
  line: '#dfe8e3',
  surface: '#f6f9f7',
  up: '#0f6b4a',
  down: '#a3151c',
};
const PAGE = { width: 612, height: 792, margin: 50 };
const WIDTH = PAGE.width - PAGE.margin * 2;
const BOTTOM = PAGE.height - 70; // leave room for the footer
const REGULAR = 'Helvetica';
const BOLD = 'Helvetica-Bold';

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? '—'));

/** Shorten text with "…" to fit a width at the current font and size. */
function fit(doc, text, width) {
  let s = String(text);
  if (doc.widthOfString(s) <= width) return s;
  while (s.length > 1 && doc.widthOfString(`${s}…`) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function render(report, { business = {} } = {}) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    info: {
      Title: `Monthly report: ${report.label}`,
      Author: 'Healthy Living Option Inc.',
      Subject: `Activity in ${report.label}, compared with ${report.prevLabel}`,
      Creator: 'HLO staff portal',
    },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const L = PAGE.margin;
  let y = 0;

  // --- Headers ---------------------------------------------------------------------------------
  function firstHeader() {
    doc.image(LOGO, L, 40, { fit: [176, 52] });
    doc.font(BOLD).fontSize(8.5).fillColor(C.brand).text('MONTHLY REPORT', L, 44, { width: WIDTH, align: 'right', characterSpacing: 1.6 });
    doc.font(BOLD).fontSize(22).fillColor(C.ink).text(report.label, L, 57, { width: WIDTH, align: 'right' });
    doc.font(REGULAR).fontSize(9.5).fillColor(C.muted).text(report.partial ? `Month in progress · compared with ${report.prevLabel}` : `Compared with ${report.prevLabel}`, L, 84, { width: WIDTH, align: 'right' });
    doc.rect(L, 106, WIDTH, 2).fill(C.brand);
    y = 124;
  }
  function pageHeader() {
    doc.image(LOGO, L, 30, { fit: [100, 30] });
    doc.font(REGULAR).fontSize(9).fillColor(C.muted).text(`Monthly report · ${report.label}`, L, 42, { width: WIDTH, align: 'right' });
    doc.rect(L, 68, WIDTH, 1).fill(C.line);
    y = 86;
  }
  function ensure(height) {
    if (y + height <= BOTTOM) return;
    doc.addPage();
    pageHeader();
  }

  // --- Page 1: summary and highlights -------------------------------------------------------------
  firstHeader();
  doc.font(REGULAR).fontSize(10.5).fillColor(C.ink)
    .text(`What came in and what happened at Healthy Living Option Inc. in ${report.label}${report.partial ? ' so far' : ''}. Figures are counts only; no names or contact details are included.`, L, y, { width: WIDTH, lineGap: 2 });
  y = doc.y + 18;

  doc.font(BOLD).fontSize(12).fillColor(C.ink).text('Highlights', L, y);
  y = doc.y + 8;
  const gap = 12;
  const cardW = (WIDTH - gap * 2) / 3;
  const cardH = 82;
  report.kpis.forEach((k, i) => {
    const x = L + (i % 3) * (cardW + gap);
    const top = y + Math.floor(i / 3) * (cardH + gap);
    doc.roundedRect(x, top, cardW, cardH, 8).fillAndStroke(C.surface, C.line);
    doc.rect(x + 14, top + 14, 18, 3).fill(C.bar);
    doc.font(REGULAR).fontSize(9).fillColor(C.muted).text(k.label, x + 14, top + 22, { width: cardW - 28 });
    doc.font(BOLD).fontSize(24).fillColor(C.ink).text(fmt(k.value), x + 14, top + 36, { width: cardW - 28 });
    const ch = k.change;
    doc.font(REGULAR).fontSize(8).fillColor(ch && ch.tone === 'up' ? C.up : ch && ch.tone === 'down' ? C.down : C.muted)
      .text(ch ? ch.text : '', x + 14, top + 64, { width: cardW - 28 });
  });
  y += cardH * 2 + gap + 26;

  // --- One block per area ----------------------------------------------------------------------
  function metricsTable(section) {
    const colW = 92;
    const labelW = WIDTH - colW * 2;
    ensure(26 + 22);
    doc.font(BOLD).fontSize(8).fillColor(C.muted);
    doc.text('MEASURE', L + 10, y, { width: labelW - 10, characterSpacing: 0.6 });
    doc.text(report.label.toUpperCase(), L + labelW, y, { width: colW - 10, align: 'right', characterSpacing: 0.6 });
    doc.text(report.prevLabel.toUpperCase(), L + labelW + colW, y, { width: colW - 10, align: 'right', characterSpacing: 0.6 });
    y += 14;
    section.metrics.forEach((m, i) => {
      doc.font(REGULAR).fontSize(7.5);
      const noteH = m.note ? doc.heightOfString(m.note, { width: labelW - 20 }) + 2 : 0;
      const rowH = 20 + noteH;
      ensure(rowH);
      if (i % 2 === 0) doc.rect(L, y, WIDTH, rowH).fill(C.surface);
      doc.font(REGULAR).fontSize(10).fillColor(C.ink).text(m.label, L + 10, y + 6, { width: labelW - 20 });
      if (m.note) doc.font(REGULAR).fontSize(7.5).fillColor(C.faint).text(m.note, L + 10, y + 18, { width: labelW - 20 });
      doc.font(BOLD).fontSize(10).fillColor(C.ink).text(fmt(m.value), L + labelW, y + 6, { width: colW - 10, align: 'right' });
      doc.font(REGULAR).fontSize(10).fillColor(C.muted).text(fmt(m.prev), L + labelW + colW, y + 6, { width: colW - 10, align: 'right' });
      y += rowH;
    });
    doc.rect(L, y, WIDTH, 0.75).fill(C.line);
    y += 16;
  }

  /** Horizontal bars, one series: label, bar, value at the end. */
  function bars(b, x, top, width) {
    const labelW = Math.min(150, width * 0.42);
    const valueW = 26;
    const barMax = width - labelW - valueW - 8;
    const max = Math.max(1, ...b.rows.map((r) => r.value));
    let yy = top;
    doc.font(BOLD).fontSize(9.5).fillColor(C.ink).text(b.title, x, yy, { width });
    yy += 16;
    if (!b.rows.length) {
      doc.font(REGULAR).fontSize(9).fillColor(C.faint).text('Nothing this month', x, yy);
      return yy + 14;
    }
    for (const r of b.rows) {
      // Long labels wrap onto a second line (at most two), and the row grows to fit.
      doc.font(REGULAR).fontSize(8.5);
      const label = labelHeight(r.label, labelW - 8) > 24 ? fit(doc, r.label, (labelW - 8) * 1.9) : r.label;
      const rowH = Math.max(17, labelHeight(label, labelW - 8) + 7);
      doc.fillColor(C.ink).text(label, x, yy + 1, { width: labelW - 8 });
      const barY = yy + (rowH - 17) / 2;
      doc.rect(x + labelW, barY, barMax, 10).fill(C.surface);
      const w = Math.max(3, (r.value / max) * barMax);
      doc.roundedRect(x + labelW, barY, w, 10, 2).fill(C.bar);
      doc.font(BOLD).fontSize(8.5).fillColor(C.ink).text(fmt(r.value), x + labelW + barMax + 6, barY + 1, { width: valueW, lineBreak: false });
      yy += rowH;
    }
    return yy;
  }
  const labelHeight = (text, width) => doc.font(REGULAR).fontSize(8.5).heightOfString(text, { width });
  const barsWidth = (n) => (n === 2 ? (WIDTH - 24) / 2 : WIDTH);
  const barsHeight = (b, colW) => {
    const labelW = Math.min(150, colW * 0.42);
    return 16 + (b.rows.length ? b.rows.reduce((h, r) => h + Math.max(17, Math.min(labelHeight(r.label, labelW - 8), 24) + 7), 0) : 17);
  };

  function breakdowns(section) {
    const list = section.breakdowns;
    for (let i = 0; i < list.length; i += 2) {
      const pair = list.slice(i, i + 2);
      const colW = barsWidth(pair.length);
      ensure(Math.max(...pair.map((b) => barsHeight(b, colW))) + 8);
      const ends = pair.map((b, j) => bars(b, L + j * (colW + 24), y, colW));
      y = Math.max(...ends) + 10;
    }
  }

  for (const s of report.sections) {
    doc.font(REGULAR).fontSize(9);
    const introH = doc.heightOfString(s.intro, { width: WIDTH - 14 });
    // Keep a whole section on one page when it fits; otherwise at least its heading with the start of its table.
    doc.font(REGULAR).fontSize(7.5);
    const tableH = 30 + s.metrics.reduce((h, m) => h + 20 + (m.note ? doc.heightOfString(m.note, { width: WIDTH - 204 }) + 2 : 0), 0);
    let chartsH = 0;
    for (let i = 0; i < s.breakdowns.length; i += 2) {
      const pair = s.breakdowns.slice(i, i + 2);
      chartsH += Math.max(...pair.map((b) => barsHeight(b, barsWidth(pair.length)))) + 10;
    }
    const whole = 34 + introH + tableH + chartsH;
    ensure(whole <= BOTTOM - 86 ? whole : 30 + introH + 60);
    y += 4;
    doc.rect(L, y + 1, 4, 15).fill(C.brand);
    doc.font(BOLD).fontSize(13.5).fillColor(C.ink).text(s.title, L + 12, y, { width: WIDTH - 12 });
    y = doc.y + 3;
    doc.font(REGULAR).fontSize(9).fillColor(C.muted).text(s.intro, L + 12, y, { width: WIDTH - 12 });
    y = doc.y + 10;
    metricsTable(s);
    breakdowns(s);
    y += 12;
  }

  // --- How it's counted -------------------------------------------------------------------------
  doc.font(REGULAR).fontSize(8.5);
  const notesH = report.notes.reduce((h, n) => h + doc.heightOfString(n, { width: WIDTH - 12 }) + 4, 22);
  ensure(notesH + 10);
  doc.roundedRect(L, y, WIDTH, notesH + 10, 8).fill(C.brandSoft);
  doc.font(BOLD).fontSize(9.5).fillColor(C.brandDark).text('How these numbers are counted', L + 14, y + 10, { width: WIDTH - 28 });
  let ny = doc.y + 4;
  for (const n of report.notes) {
    doc.font(REGULAR).fontSize(8.5).fillColor(C.ink).text(`•  ${n}`, L + 14, ny, { width: WIDTH - 28 });
    ny = doc.y + 3;
  }

  // --- Footer on every page ---------------------------------------------------------------------
  const { start, count } = doc.bufferedPageRange();
  const generated = new Date(report.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
  const contact = [business.phone, business.email].filter(Boolean).join(' · ');
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing in the margin must not add a page
    const fy = PAGE.height - 50;
    doc.rect(L, fy - 8, WIDTH, 0.75).fill(C.line);
    doc.font(BOLD).fontSize(8).fillColor(C.ink).text(`Healthy Living Option Inc.${contact ? `  ·  ${contact}` : ''}`, L, fy, { width: WIDTH - 80, lineBreak: false });
    doc.font(REGULAR).fontSize(8).fillColor(C.muted).text(`Page ${i - start + 1} of ${count}`, L, fy, { width: WIDTH, align: 'right', lineBreak: false });
    doc.font(REGULAR).fontSize(7.5).fillColor(C.faint)
      .text(`Confidential: for HLO and its board. Counts only, no personal details. Generated ${generated}${report.generatedBy ? ` by ${report.generatedBy}` : ''}.`, L, fy + 12, { width: WIDTH, lineBreak: false });
  }

  doc.end();
  return done;
}

module.exports = { render };
