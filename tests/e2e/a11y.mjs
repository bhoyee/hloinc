// Accessibility scan (axe-core, WCAG 2.1 A/AA) of the public pages.
// Usage: start the app, then `node tests/e2e/a11y.mjs`
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:4310';
const paths = ['/', '/about', '/services', '/services/personal-supports', '/service-areas', '/getting-started',
  '/resources', '/careers', '/contact', '/appointments/request', '/nope'];

const browser = await chromium.launch();
let failures = 0;
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const scan = async (label) => {
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of violations) {
      failures++;
      console.log(`✗ [${viewport.width}] ${label}: ${v.id} (${v.impact}) — ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log('    ', n.target.join(' '), n.failureSummary.split('\n')[1] || '');
    }
  };
  for (const p of paths) {
    await page.goto(base + p);
    await scan(p);
  }
  // Form in its error state.
  await page.goto(base + '/contact');
  await page.fill('#f-email', 'bad');
  await page.waitForTimeout(3100); // minimum fill time
  await page.click('form button[type=submit]');
  await page.waitForLoadState();
  await scan('/contact (errors)');
  await context.close();
}
await browser.close();
console.log(failures ? `\n${failures} violation(s)` : 'No WCAG 2.1 AA violations found');
process.exitCode = failures ? 1 : 0;
