'use strict';

const express = require('express');
const report = require('../../services/monthlyReport');
const { audit } = require('../../services/audit');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];

/** "2026-09" from the query or URL, or the last full month. */
const monthFrom = (value) => (typeof value === 'string' && report.MONTH.test(value) ? value : report.defaultMonth());

router.get('/', async (req, res) => {
  const month = monthFrom(req.query.month);
  const r = await report.build(month, { user: req.user });
  const list = await report.months();
  res.render('pages/portal/reports/index.njk', {
    title: 'Monthly report',
    subheading: 'Referrals, requests, appointments and hires, month by month. Counts only, no names: ready to share with the board.',
    crumbs,
    r,
    months: list,
    monthListed: list.some((m) => m.value === month),
  });
});

const fileName = (r, ext) => `HLO-monthly-report-${r.month}.${ext}`;

router.get('/:month.pdf', async (req, res, next) => {
  if (!report.MONTH.test(req.params.month)) return next();
  const r = await report.build(req.params.month, { user: req.user });
  const pdf = await require('../../lib/reportPdf').render(r, { business: await require('../../services/content').getBusiness() });
  await audit(req, { action: 'report.download', entityType: 'report', entityId: r.month, summary: `${req.user.name} downloaded the monthly report for ${r.label} (PDF)` });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName(r, 'pdf')}"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
});

router.get('/:month.csv', async (req, res, next) => {
  if (!report.MONTH.test(req.params.month)) return next();
  const r = await report.build(req.params.month, { user: req.user });
  await audit(req, { action: 'report.download', entityType: 'report', entityId: r.month, summary: `${req.user.name} downloaded the monthly report for ${r.label} (CSV)` });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName(r, 'csv')}"`, 'Cache-Control': 'private, no-store' });
  res.send(report.toCsv(r));
});

module.exports = router;
