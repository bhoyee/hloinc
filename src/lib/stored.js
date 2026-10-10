'use strict';

/**
 * A value from a JSON column, as a JavaScript value. Depending on the database
 * (MySQL or MariaDB) and driver, JSON columns arrive either as text to parse or
 * already parsed. This accepts both, and plain text that isn't JSON at all, so
 * one odd value can never stop the rest from loading.
 */
function fromDb(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

module.exports = { fromDb };
