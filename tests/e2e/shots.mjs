// Visual probe: starts a game in headless Chromium and saves screenshots of selected biomes.
// Usage: node tests/e2e/shots.mjs [biome ...]   (writes tests/e2e/out/shot-<biome>.png)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });
const biomes = process.argv.slice(2);
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname, stdio: 'ignore'
});
let browser;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await sleep(250); }
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.addInitScript(() => localStorage.setItem('genesis.settings.v1', JSON.stringify({ quality: 'low', volume: 0 })));
  await page.goto(BASE);
  await page.fill('#seed-input', 'aurore-42');
  await page.click('#btn-new');
  await page.waitForFunction(() => window.__genesis?.state().state === 'playing', null, { timeout: 60000 });
  await page.waitForFunction(() => (window.__genesis.state().chunks ?? 0) >= 40, null, { timeout: 240000 });
  await page.evaluate(() => window.__genesis.setTime(0.42));
  await sleep(3000);
  await page.screenshot({ path: `${OUT}/shot-spawn.png`, timeout: 180000 });
  for (const b of biomes) {
    const spot = await page.evaluate((id) => window.__genesis.findBiome(id, 12000), b);
    if (!spot) { console.log('no', b); continue; }
    await page.evaluate((t) => window.__genesis.teleport(t.x, t.z), spot);
    await page.waitForFunction(() => window.__genesis.state().streaming.inflight === 0, null, { timeout: 240000 }).catch(() => {});
    await sleep(4000);
    await page.screenshot({ path: `${OUT}/shot-${b}.png`, timeout: 180000 });
    console.log('shot', b);
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
