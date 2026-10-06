'use strict';

const config = require('../config');
const { notify } = require('./notify');

const SIGN_OFF = ['', 'HLO Staff Portal', 'If you did not expect this email, contact your HLO administrator.'];

function invite(user, token, invitedBy) {
  return notify({
    to: user.email,
    subject: 'Your HLO Staff Portal account',
    text: [
      `Hello ${user.name},`,
      '',
      `${invitedBy} has created an HLO Staff Portal account for you.`,
      'Choose your password using this link:',
      `${config.appUrl}/portal/invite/${token}`,
      '',
      `The link works once and expires in ${config.auth.inviteTokenHours} hours.`,
      ...SIGN_OFF,
    ].join('\n'),
  });
}

function passwordReset(user, token) {
  return notify({
    to: user.email,
    subject: 'Reset your HLO Staff Portal password',
    text: [
      `Hello ${user.name},`,
      '',
      'Someone asked to reset the password for your HLO Staff Portal account.',
      'If it was you, choose a new password using this link:',
      `${config.appUrl}/portal/reset-password/${token}`,
      '',
      `The link works once and expires in ${config.auth.resetTokenMinutes} minutes.`,
      'If it was not you, you can ignore this email. Your password has not changed.',
      ...SIGN_OFF,
    ].join('\n'),
  });
}

/** Security notices, so people notice changes they didn't make. */
function securityNotice(user, what) {
  return notify({
    to: user.email,
    subject: `Security notice: ${what}`,
    text: [
      `Hello ${user.name},`,
      '',
      `This is a notice that the following change was made to your HLO Staff Portal account: ${what}.`,
      'If you made this change, no action is needed.',
      'If you did not, contact your HLO administrator straight away.',
      ...SIGN_OFF.slice(0, 2),
    ].join('\n'),
  });
}

module.exports = { invite, passwordReset, securityNotice };
