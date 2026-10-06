// Dev helper: screenshot pages at desktop and mobile widths.
// Usage: node tests/e2e/screens.mjs [outDir] [path ...]
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL || 'http://127.0.0.1:4310';
const [outDir = 'tmp/screens', ...paths] = process.argv.slice(2);
const pages = paths.length ? paths : ['/'];

const browser = await chromium.launch();
for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    const name = (p === '/' ? 'home' : p.replace(/^\//, '').replace(/[/?=]/g, '_')) + `-${label}.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${label} ${p}${overflow ? '  ⚠ horizontal overflow' : ''}`);
  }
  if (errors.length) console.log('console errors:', errors);
  await page.close();
}
await browser.close();
