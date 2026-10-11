'use strict';

const multer = require('multer');
const { MAX_BYTES } = require('../services/avatars');

/* Reads a profile photo upload (kept in memory until checked), before the CSRF check reads its fields. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 5, parts: 8 } }).single('photo');

module.exports = function avatarUpload(req, res, next) {
  if (!String(req.get('content-type') || '').startsWith('multipart/form-data')) return next();
  upload(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'That photo is over 5 MB. Please choose a smaller one.' : 'We couldn’t read that upload. Please try again.';
      req.body = req.body || {};
    }
    next();
  });
};
