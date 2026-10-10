'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const emailLayout = require('../lib/emailLayout');
const site = require('../lib/site');

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (config.mail.transport === 'sendmail') {
    // The server's mail program (Exim on cPanel). Signs with the domain's DKIM; no mailbox needed.
    transporter = nodemailer.createTransport({ sendmail: true, newline: 'unix', path: config.mail.sendmailPath });
  } else if (!config.mail.host) {
    // No SMTP configured (local dev): print emails to the console instead.
    transporter = nodemailer.createTransport({ jsonTransport: true });
  } else {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    });
  }
  return transporter;
}

/** Business details for the email footer; falls back to the defaults if the database is unavailable. */
async function businessDetails() {
  try {
    return await require('./content').getBusiness();
  } catch {
    return site.defaults;
  }
}

// Tests read what was sent from here.
const outbox = [];

const channels = {
  // Every email goes out as plain text plus a branded HTML version of the same text.
  async email({ to, subject, text, replyTo, cta, footnote }) {
    const html = emailLayout.render({ subject, text, cta, footnote, business: await businessDetails() });
    const mail = { from: config.mail.from, to, subject, text, html, replyTo };
    if (config.isTest) outbox.push(mail);
    const info = await getTransporter().sendMail(mail);
    if (config.mail.transport !== 'sendmail' && !config.mail.host && !config.isTest) console.log('[email:dev]', { to, subject, text });
    return info;
  },
  // SMS is out of scope (requirements §2). Add a provider here later and
  // callers can pass `channel: 'sms'` without other changes.
};

/**
 * Send a notification (email: plain text plus branded HTML). Returns { ok, error } instead of throwing
 * so callers can show an honest message when delivery fails (§7).
 */
async function notify({ channel = 'email', ...message }) {
  const send = channels[channel];
  if (!send) return { ok: false, error: `Notification channel "${channel}" is not configured.` };
  try {
    await send(message);
    return { ok: true };
  } catch (err) {
    console.error(`Notification via ${channel} failed:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { notify, _outbox: outbox };
