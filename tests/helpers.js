import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
export const { createApp } = require('../src/server');
export const db = require('../src/db/knex');
export const { todayInMaryland, addDays } = require('../src/validation/public');

/** Supertest agent with a session, plus the CSRF token from a form page. */
export async function formAgent(app, path) {
  const agent = request.agent(app);
  const res = await agent.get(path);
  const match = res.text.match(/name="_csrf" value="([a-f0-9]+)"/);
  if (!match) throw new Error(`No CSRF token on ${path}`);
  return { agent, csrf: match[1] };
}

/** Next weekday at least `minDays` from today (Maryland time). */
export function nextWeekday(minDays = 1) {
  let d = addDays(todayInMaryland(), minDays);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

export function nextWeekend() {
  let d = addDays(todayInMaryland(), 1);
  while (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}
