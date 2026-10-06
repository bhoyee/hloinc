import { chromium } from '@playwright/test';
const queries = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', viewport: { width: 1400, height: 1200 } });
const p = await ctx.newPage();
for (const q of queries) {
  await p.goto('https://unsplash.com/s/photos/' + encodeURIComponent(q) + '?license=free', { timeout: 60000 });
  for (let i = 0; i < 20 && (await p.title()).includes('bot'); i++) await p.waitForTimeout(1500);
  await p.waitForTimeout(2500);
  const items = await p.$$eval('a[href^="/photos/"]', as => [...new Map(as.map(a => {
    const img = a.querySelector('img');
    return [a.getAttribute('href'), img ? (img.alt || '').slice(0, 110) : ''];
  })).entries()].filter(([h, alt]) => alt));
  console.log('## ' + q + ' — ' + (await p.title()).slice(0, 40) + ' (' + items.length + ')');
  items.slice(0, 16).forEach(([h, alt]) => console.log(h.replace('/photos/', '') + ' | ' + alt));
}
await b.close();
