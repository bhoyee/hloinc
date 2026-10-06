'use strict';

const config = require('../config');

/** Turn a zod error into { field: firstMessage }. */
function fieldErrors(zodError) {
  const errors = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0];
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** Remember when a form was rendered, so instant (bot) submissions can be spotted. */
function issueForm(req, formName) {
  req.session.formIssued = { ...(req.session.formIssued || {}), [formName]: Date.now() };
}

/**
 * Honeypot + timing check. Bots fill the hidden `website` field or post
 * faster than a person could. Returns true if the submission looks automated.
 */
function looksLikeSpam(req, formName) {
  if (req.body.website) return true;
  const issued = req.session.formIssued && req.session.formIssued[formName];
  if (!issued) return true;
  return Date.now() - issued < config.forms.minSubmitSeconds * 1000;
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

module.exports = { fieldErrors, issueForm, looksLikeSpam, setFlash, flashMiddleware };
