'use strict';

const db = require('../db/knex');
const site = require('../lib/site');
const pages = require('../content/pages');

const TTL_MS = 60 * 1000;
let cache = { at: 0, settings: null };

async function loadSettings() {
  if (cache.settings && Date.now() - cache.at < TTL_MS) return cache.settings;
  try {
    const rows = await db('site_settings').select('key', 'value');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = JSON.parse(row.value);
    }
    cache = { at: Date.now(), settings };
  } catch (err) {
    // The site must still render if the database is briefly unavailable.
    console.error('Could not load site settings:', err.message);
    return cache.settings || {};
  }
  return cache.settings;
}

/** Call after saving settings so changes show immediately. */
function clearCache() {
  cache = { at: 0, settings: null };
}

async function getBusiness() {
  const s = await loadSettings();
  return {
    ...site.defaults,
    phone: s['business.phone'] ?? site.defaults.phone,
    email: s['business.email'] ?? site.defaults.email,
    address: { ...site.defaults.address, ...(s['business.address'] || {}) },
    hours: s['business.hours'] ?? site.defaults.hours,
    schedule: s['business.schedule'] ?? site.defaults.schedule,
    walkIn: s['business.walk_in'] ?? site.defaults.walkIn,
  };
}

async function getPage(key) {
  const s = await loadSettings();
  return { ...pages[key], ...(s[`page.${key}`] || {}) };
}

/** Where a contact form choice is emailed. Falls back to the main business email unless `fallback: false`. */
async function getRecipientEmail(recipientKey, { fallback = true } = {}) {
  const s = await loadSettings();
  const emails = s['contact.recipient_emails'] || {};
  return emails[recipientKey] || (fallback ? (await getBusiness()).email : '');
}

module.exports = { getBusiness, getPage, getRecipientEmail, clearCache };
