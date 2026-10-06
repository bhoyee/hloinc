'use strict';

const express = require('express');

const router = express.Router();

// Keep the staff portal out of search engines.
router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  next();
});

// Login, auth guard and modules arrive in Phase 2.
router.get('/', (req, res) => {
  res.render('pages/portal/coming-soon.njk', { title: 'Staff portal' });
});

module.exports = router;
