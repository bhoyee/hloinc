// Screenshots for the README (docs/screens/*.webp), taken from the local app with demo data.
// Usage: npm run screens:readme   (app running, demo data seeded; never point this at a live site)
import { chromium } from '@playwright/test';
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const base = process.env.BASE_URL || 'http://127.0.0.1:4310';
const out = 'docs/screens';
const PASSWORD = 'Portal-Demo-2026!'; // local demo accounts only
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function save(page, name) {
  await page.waitForTimeout(400); // charts and fonts settle
  const png = await page.screenshot(); // what's in the window
  await sharp(png).resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 78 }).toFile(`${out}/${name}.webp`);
  console.log(`${out}/${name}.webp`);
}

async function portal(who) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/portal/login`);
  await page.fill('input[name=email]', `${who}@hloinc.test`);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
  return page;
}

// Admin
const admin = await portal('admin');
await admin.setViewportSize({ width: 1440, height: 1150 });
await admin.goto(`${base}/portal`, { waitUntil: 'networkidle' });
await save(admin, 'admin-dashboard');
await admin.setViewportSize({ width: 1440, height: 900 });
// Demo addresses only, so nothing typed in by hand during testing ends up in the README.
await admin.goto(`${base}/portal/messages?tab=all&q=example.com`, { waitUntil: 'networkidle' });
await save(admin, 'messages');
await admin.locator('main a[href^="/portal/messages/"]').filter({ hasText: /\S/ }).first().click();
await admin.waitForLoadState('networkidle');
await save(admin, 'message');
await admin.goto(`${base}/portal/appointments/calendar?view=month`, { waitUntil: 'networkidle' });
await save(admin, 'calendar');
await admin.goto(`${base}/portal/roles/reception`, { waitUntil: 'networkidle' });
await admin.evaluate(() => window.scrollTo(0, document.getElementById('perm-h').getBoundingClientRect().top + window.scrollY - 140));
await save(admin, 'roles');
await admin.goto(`${base}/portal/content/pages/home`, { waitUntil: 'networkidle' });
await save(admin, 'content-editor');
await admin.close();

// Reception: the appointments widget
const reception = await portal('reception');
await reception.goto(`${base}/portal`, { waitUntil: 'networkidle' });
// Show the busiest day this week rather than an empty one.
const busiest = await reception.$$eval('[data-appt-widget] ol a', (days) => days.reduce((best, d, i, all) => (parseInt(d.textContent.match(/(\d+)\s*appointment/)?.[1] || 0, 10) > parseInt(all[best].textContent.match(/(\d+)\s*appointment/)?.[1] || 0, 10) ? i : best), 0));
await reception.locator('[data-appt-widget] ol a').nth(busiest).click();
await reception.waitForTimeout(800);
await reception.locator('[data-appt-widget]').scrollIntoViewIfNeeded();
const shot = await reception.locator('[data-appt-widget]').screenshot();
await sharp(shot).resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 78 }).toFile(`${out}/reception-appointments.webp`);
console.log(`${out}/reception-appointments.webp`);
await reception.close();

// Public website, light and dark
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.locator('button:has-text("OK")').first().click().catch(() => {}); // cookie notice
  await save(page, `website-${theme}`);
  await ctx.close();
}

await browser.close();
