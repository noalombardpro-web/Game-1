// Probe for the character, weapons, jetpack and grid building: drives the game with real key
// presses in headless Chromium and saves screenshots. Usage: node tests/e2e/gear-probe.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname, stdio: 'ignore'
});
const log = (...a) => console.log(...a);
let browser;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await sleep(250); }
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log('console', m.type(), m.text()); });
  await page.addInitScript(() => localStorage.setItem('genesis.settings.v1', JSON.stringify({ quality: 'low', volume: 0, skin: new URLSearchParams(location.search).get('skin') })));
  await page.goto(BASE + (process.env.SKIN ? `?skin=${process.env.SKIN}` : ''));
  await page.fill('#seed-input', 'aurore-42');
  await page.click('#btn-new');
  await page.waitForFunction(() => window.__genesis?.state().state === 'playing', null, { timeout: 60000 });
  await page.waitForFunction(() => (window.__genesis.state().chunks ?? 0) >= 30, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__genesis.state().gear.skinLoaded, null, { timeout: 120000 });
  await page.evaluate(() => { window.__genesis.setTime(0.42); window.__genesis.look(0.6, -0.15); });
  await page.mouse.click(480, 270);
  const st = () => page.shot = page.evaluate(() => window.__genesis.state());
  const shoot = async (name) => { await page.screenshot({ path: `${OUT}/gear-${process.env.SKIN ?? ''}${name}.png`, timeout: 180000 }); log('shot', name); };
  await sleep(2000);
  await shoot('idle');
  await page.keyboard.down('KeyW');
  await sleep(2500);
  await shoot('walk');
  await page.keyboard.down('ShiftLeft');
  await sleep(2500);
  await shoot('run');
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  if (process.env.SHORT) throw new Error('short run done');
  await page.keyboard.press('Digit2');
  await sleep(1500);
  log('weapon', (await st()).gear.weapon);
  await page.mouse.down({ button: 'right' });
  await sleep(1500);
  await page.mouse.down();
  await sleep(1500);
  await shoot('aim-fire-third');
  await page.mouse.up();
  await page.mouse.up({ button: 'right' });
  log('mags', JSON.stringify((await st()).gear.mags));
  await page.keyboard.press('KeyV');
  await sleep(1500);
  await page.mouse.down();
  await sleep(800);
  await shoot('first-person');
  await page.mouse.up();
  await page.keyboard.press('KeyV');
  // Jetpack: jump then press again and hold.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__genesis.state().player.grounded, null, { timeout: 30000 });
  await page.keyboard.down('Space');
  await sleep(2500);
  const air = await st();
  log('jet', air.gear.jetting, air.gear.jetFuel.toFixed(0), 'height above ground', (air.player.y - air.player.ground).toFixed(1));
  await shoot('jetpack');
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__genesis.state().player.grounded, null, { timeout: 60000 });
  // Close-up of the aiming pose with the weapon in hand.
  await page.evaluate(() => { window.__genesis.setView('third', 2.2); window.__genesis.look(0.6 + 2.6, -0.05); });
  await page.mouse.down({ button: 'right' });
  await sleep(2500);
  await shoot('aim-closeup');
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => { window.__genesis.setView('third', 4.2); window.__genesis.look(0.6, -0.15); });
  const gear = () => page.evaluate(() => window.__genesis.state().gear);
  const waitGear = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 });
  // Grid building: wall, floor, ramp (each step waits for the game to have processed the input).
  await page.keyboard.press('KeyG');
  await waitGear(() => window.__genesis.state().gear.gridMode === 'wall');
  await page.mouse.click(480, 270);
  await waitGear(() => window.__genesis.state().gear.pieces.length >= 1);
  await page.keyboard.press('Digit2');
  await waitGear(() => window.__genesis.state().gear.gridMode === 'floor');
  await page.evaluate(() => window.__genesis.look(0.6 + Math.PI / 2, -0.15));
  await page.mouse.click(480, 270);
  await waitGear(() => window.__genesis.state().gear.pieces.length >= 2);
  await page.keyboard.press('Digit3');
  await waitGear(() => window.__genesis.state().gear.gridMode === 'ramp');
  await page.evaluate(() => window.__genesis.look(0.6 - Math.PI / 2, -0.15));
  await page.mouse.click(480, 270);
  await waitGear(() => window.__genesis.state().gear.pieces.length >= 3);
  log('pieces', JSON.stringify((await gear()).pieces));
  await page.evaluate(() => window.__genesis.look(0.6 + Math.PI, -0.3));
  await sleep(2500);
  await shoot('build');
  // Edit the wall: aim at it and cut a door (two lower middle cells).
  await page.evaluate(() => window.__genesis.look(0.3, 0.05));
  await sleep(1500);
  await page.keyboard.press('KeyH');
  await waitGear(() => window.__genesis.state().gear.editing);
  await page.mouse.click(480, 270);
  await waitGear(() => window.__genesis.state().gear.pieces.some((p) => p.edit));
  await sleep(1000);
  await shoot('edit');
  await page.keyboard.press('KeyH');
  await waitGear(() => !window.__genesis.state().gear.editing);
  log('pieces after edit', JSON.stringify((await gear()).pieces));
  await page.keyboard.press('KeyG');
  await waitGear(() => !window.__genesis.state().gear.gridMode);
  // Walk onto the ramp.
  const before = (await page.evaluate(() => window.__genesis.state())).player;
  await page.evaluate(() => window.__genesis.look(0.6 - Math.PI / 2, -0.1));
  await page.keyboard.down('KeyW');
  await sleep(6000);
  await page.keyboard.up('KeyW');
  const after = (await page.evaluate(() => window.__genesis.state())).player;
  log('ramp walk: y', before.y.toFixed(2), '->', after.y.toFixed(2), 'ground', after.ground.toFixed(2));
  await shoot('ramp');
  // Walk up the ramp (it is behind-left of the wall in the facing direction).
} catch (e) {
  log('ERROR', e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
}
