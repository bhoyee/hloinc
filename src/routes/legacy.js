'use strict';

const express = require('express');

/**
 * Old WordPress URLs. Real pages get a permanent redirect so search rankings
 * carry over; leftover theme demo pages (and spam they attracted) get
 * 410 Gone so search engines drop them.
 */
const router = express.Router();

const redirects = {
  '/about-hlo-inc': '/about',
  '/about-hlo-inc/location': '/contact',
  '/about-hlo-inc/working-hours': '/contact',
  '/about-hlo-inc/appointments': '/appointments/request',
  '/contact-us': '/contact',
  '/schedule-an-appointment': '/appointments/request',
  '/send-your-referrals': '/referrals',
};

const gonePrefixes = [
  '/about-hlo-inc',
  '/blog',
  '/shop',
  '/portfolio',
  '/portfolio-grid',
  '/portfolio-single',
  '/portfolio-tiles',
  '/sample-page',
  '/footer',
  '/wp-admin',
  '/wp-login.php',
  '/wp-content',
  '/wp-includes',
  '/xmlrpc.php',
  '/feed',
  '/comments',
];

router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  // Collapse leading slashes so "//evil.com/" can never become an off-site redirect.
  const clean = req.path.replace(/^\/+/, '/');
  const path = clean.length > 1 ? clean.replace(/\/+$/, '') || '/' : clean;
  if (redirects[path]) return res.redirect(301, redirects[path]);

  if (gonePrefixes.some((p) => path === p || path.startsWith(`${p}/`))) {
    return res.status(410).render('pages/errors/404.njk', { title: 'Page removed' });
  }

  // Old site used trailing slashes (/services/, /careers/); canonicalise them.
  if (path !== req.path) {
    const q = req.originalUrl.indexOf('?');
    return res.redirect(301, path + (q === -1 ? '' : req.originalUrl.slice(q)));
  }
  next();
});

module.exports = router;
