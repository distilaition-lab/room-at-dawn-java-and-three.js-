// node canyon/tools/shot.mjs out.jpg '<js expression evaluated in the page, may use api>'
import puppeteer from 'puppeteer-core';
const [out, expr, w = '960', h = '402'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: true, protocolTimeout: 0,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${w},${h}`], defaultViewport: { width: +w, height: +h } });
const p = await b.newPage();
p.on('console', (m) => { const t = m.text(); if (/^\[(canyon|film)\]/.test(t) || m.type() === 'error' || /THREE/.test(t)) console.log(t.slice(0, 600)); });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://127.0.0.1:5319/canyon/index.html?tool=1', { timeout: 0 });
await p.waitForFunction('window.__ready || window.__error', { timeout: 0, polling: 500 });
const err = await p.evaluate('window.__error'); if (err) { console.log('ERROR', err); await b.close(); process.exit(1); }
const items = expr.split('|||'); let i = 0;
for (const e of items) {
  const r = await p.evaluate(`(async () => { const api = window.__api; return await (${e}); })()`);
  const f = items.length > 1 ? out.replace(/(\.\w+)$/, `_${i++}$1`) : out;
  await p.screenshot({ path: f, type: 'jpeg', quality: 88 }); console.log(f, JSON.stringify(r));
}
await b.close();
