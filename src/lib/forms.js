'use strict';

/** Turn a zod error into { field: firstMessage }. */
function fieldErrors(zodError) {
  const errors = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0];
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function flashMiddleware(req, res, next) {
  if (req.session && req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  }
  next();
}

module.exports = { fieldErrors, setFlash, flashMiddleware };
