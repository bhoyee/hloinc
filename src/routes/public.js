'use strict';

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/public/home.njk', { title: 'Home' });
});

// Liveness check for the host / uptime monitor. Database health is checked
// separately so a DB outage doesn't hide that the app itself is up.
router.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: 'ok' });
});

router.get('/healthz/db', async (req, res) => {
  const db = require('../db/knex');
  try {
    await db.raw('select 1');
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  } catch {
    res.status(503).set('Cache-Control', 'no-store').json({ status: 'unavailable' });
  }
});

module.exports = router;
