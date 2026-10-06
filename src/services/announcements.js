'use strict';

const db = require('../db/knex');

/** Public announcements currently within their start/end dates (§5.4). */
async function activePublic(limit = 3) {
  const now = new Date();
  try {
    return await db('announcements')
      .select('id', 'title', 'body', 'starts_at')
      .whereIn('audience', ['public', 'both'])
      .where('starts_at', '<=', now)
      .where((q) => q.whereNull('ends_at').orWhere('ends_at', '>', now))
      .orderBy('starts_at', 'desc')
      .limit(limit);
  } catch (err) {
    console.error('Could not load announcements:', err.message);
    return [];
  }
}

module.exports = { activePublic };
