'use strict';

const db = require('../db/knex');

/**
 * Record an action in the audit log. Never throws — a logging failure
 * must not break the action being logged.
 *
 * @param {import('express').Request|null} req
 * @param {{ action: string, entityType?: string, entityId?: string|number, summary?: string, metadata?: object, user?: {id:number,name:string} }} entry
 */
async function audit(req, entry) {
  const user = entry.user || (req && req.user) || null;
  try {
    await db('audit_log').insert({
      user_id: user ? user.id : null,
      user_name: user ? user.name : null,
      action: entry.action,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId != null ? String(entry.entityId) : null,
      summary: entry.summary ? entry.summary.slice(0, 500) : null,
      ip: req ? req.ip : null,
      user_agent: req ? (req.get('user-agent') || '').slice(0, 255) : null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { audit };
