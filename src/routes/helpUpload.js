'use strict';

const multer = require('multer');
const { MAX_BYTES } = require('../services/support');

/* Reads a "Get help" form with its optional screenshot (kept in memory until checked), before the CSRF check reads its fields. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 10, parts: 12, fieldSize: 20000 } }).single('screenshot');

module.exports = function helpUpload(req, res, next) {
  if (!String(req.get('content-type') || '').startsWith('multipart/form-data')) return next();
  upload(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'That screenshot is over 5 MB. Please choose a smaller one.' : 'We couldn’t read that upload. Please try again.';
      req.body = req.body || {};
    }
    next();
  });
};
