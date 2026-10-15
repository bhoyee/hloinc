'use strict';

const config = require('../config');

function notFound(req, res) {
  res.status(404).render('pages/errors/404.njk', { title: 'Page not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  // A reference staff can quote (and that "Report this problem" attaches), to find the error in the server log.
  const errorRef = status >= 500 ? `ERR-${require('../lib/reference').make('help').slice(-6)}` : null;
  if (status >= 500) console.error(`[${errorRef}] ${req.method} ${req.originalUrl}`, err);

  if (res.headersSent) return;
  res.status(status);

  const message = status < 500 ? err.message : 'Something went wrong on our side. Please try again shortly.';
  if (req.accepts(['html', 'json']) === 'json') return res.json({ error: errorRef ? `${message} (Reference ${errorRef})` : message, ref: errorRef });

  const titles = { 401: 'Please sign in again', 403: 'Not allowed', 404: 'Page not found' };
  // Signed-in staff see errors inside the portal layout, with its menu.
  const view = req.user && req.originalUrl.startsWith('/portal') ? 'pages/portal/error.njk' : 'pages/errors/error.njk';
  res.render(view, {
    title: titles[status] || 'Something went wrong',
    status,
    message,
    errorRef,
    from: req.originalUrl.slice(0, 300),
    stack: config.isProd ? null : err.stack,
  });
}

module.exports = { notFound, errorHandler };
