'use strict';

const multer = require('multer');
const { MAX_BYTES, MAX_LABEL } = require('../services/applications');

/*
 * Reads a job application form: its fields and one resume, kept in memory (never
 * written to disk before it is checked and scanned). Limits stop oversized or
 * padded requests early. A problem with the file is passed on as req.uploadError
 * so the form can explain it; the CSRF check still runs on the fields.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 20, fieldSize: 8 * 1024, parts: 25 },
}).single('resume');

module.exports = function applicationUpload(req, res, next) {
  if (!String(req.get('content-type') || '').startsWith('multipart/form-data')) return next();
  upload(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? `Your resume is over ${MAX_LABEL}. Please attach a smaller file.` : 'We couldn’t read that upload. Please attach one resume (PDF or Word .docx) and try again.';
      req.body = req.body || {};
    }
    next();
  });
};
