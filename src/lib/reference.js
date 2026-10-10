'use strict';

const crypto = require('crypto');

/**
 * Reference numbers people can read out over the phone, like HLO-REQ-7K3M9P.
 *
 * The code is random rather than counting up, so it does not reveal how many
 * submissions HLO receives, and it skips characters that look alike
 * (0/O, 1/I/L). Six characters from 31 give about 887 million codes; a unique
 * index catches the rare repeat and a new code is drawn.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const PREFIXES = { message: 'MSG', referral: 'REF', request: 'REQ', appointment: 'APT', application: 'APP' };
const PATTERN = /^HLO-(MSG|REF|REQ|APT|APP)-[2-9A-HJKMNP-Z]{6}$/;

function make(kind) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error(`Unknown reference kind: ${kind}`);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `HLO-${prefix}-${code}`;
}

/** Insert a row with a fresh reference, drawing again if it is already taken. Returns { id, reference }. */
async function insertWithReference(db, table, row, kind) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = module.exports.make(kind); // via exports so tests can force a clash
    try {
      const [id] = await db(table).insert({ ...row, reference });
      return { id, reference };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY' || !String(err.sqlMessage || err.message).includes('reference')) throw err;
    }
  }
  throw new Error(`Could not create a unique reference for ${table}`);
}

/** The reference to show for a row (older rows without one fall back to their number). */
const of = (row) => (row && row.reference) || (row && row.id ? `#${row.id}` : '');

/** Tidy what someone typed when searching (spaces, lower case, missing dashes). */
function normalizeSearch(q) {
  const compact = String(q).toUpperCase().replace(/[\s-]/g, '');
  const m = compact.match(/^(?:HLO)?(MSG|REF|REQ|APT|APP)?([2-9A-HJKMNP-Z]{6})$/);
  return m ? m[2] : null;
}

module.exports = { make, insertWithReference, of, normalizeSearch, PREFIXES, PATTERN, ALPHABET };
