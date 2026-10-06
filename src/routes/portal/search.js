'use strict';

const express = require('express');
const { search } = require('../../services/search');

const router = express.Router();

// GET /portal/search?q=…  — HTML page, or JSON for the header's live results.
router.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const groups = await search(req.user, q, { limit: req.query.format === 'json' ? 5 : 20 });

  if (req.query.format === 'json') {
    return res.json({ q, groups });
  }
  res.render('pages/portal/search.njk', {
    title: q ? `Search: ${q}` : 'Search',
    heading: 'Search',
    crumbs: [{ label: 'Dashboard', href: '/portal' }],
    q,
    groups,
    total: groups.reduce((n, g) => n + g.items.length, 0),
  });
});

module.exports = router;
