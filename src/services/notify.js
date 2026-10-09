'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

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

const channels = {
  async email({ to, subject, text, replyTo }) {
    const info = await getTransporter().sendMail({ from: config.mail.from, to, subject, text, replyTo });
    if (config.mail.transport !== 'sendmail' && !config.mail.host && !config.isTest) console.log('[email:dev]', { to, subject, text });
    return info;
  },
  // SMS is out of scope (requirements §2). Add a provider here later and
  // callers can pass `channel: 'sms'` without other changes.
};

/**
 * Send a plain-text notification. Returns { ok, error } instead of throwing
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

module.exports = { notify };
