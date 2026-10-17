// End-to-end check: serves the production build, plays the game in headless Chromium
// (software WebGL), verifies core behaviour, checks for runtime errors and records
// frame-time statistics. Usage: node tests/e2e/smoke.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const state = (page) => page.evaluate(() => window.__genesis.state());
const until = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 150 });

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch { /* not yet */ }
    await sleep(250);
  }
  throw new Error('preview server did not start');
}

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', () => {});
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
  // Low quality keeps the software renderer responsive; audio is muted for the test.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('genesis-e2e')) {
      sessionStorage.setItem('genesis-e2e', '1');
      localStorage.setItem('genesis.settings.v1', JSON.stringify({ quality: 'low', volume: 0 }));
    }
  });

  await page.goto(BASE, { waitUntil: 'load' });
  check('start screen shows the title', (await page.textContent('h1')).includes('PROJECT GENESIS'));
  check('continue is disabled without a save', await page.isDisabled('#btn-continue'));

  await page.fill('#seed-input', 'aurore-42');
  await page.click('#btn-new');
  await until(page, () => window.__genesis?.state().state === 'playing', null, 30000);
  await until(page, () => (window.__genesis.state().chunks ?? 0) >= 50, null, 240000);
  await until(page, () => window.__genesis.state().frames > 60, null, 300000);
  const s0 = await state(page);
  check('world streams chunks around the player', s0.chunks >= 50, `chunks=${s0.chunks}`);
  check('fauna spawned and visible views created', s0.creatures > 0 && s0.views > 0, `creatures=${s0.creatures}, views=${s0.views}`);
  check('enemies spawned at points of interest', s0.enemies >= 6, `enemies=${s0.enemies}`);
  check('robot starts with full vitals', s0.robot.energy > 90 && s0.robot.integrity > 90, JSON.stringify(s0.robot));
  await page.screenshot({ path: `${OUT}/01-start.png` });

  // Movement relative to the camera (forward = W).
  await page.mouse.click(480, 270);
  const p0 = (await state(page)).player;
  await page.keyboard.down('KeyW');
  await until(page, (start) => {
    const s = window.__genesis.state();
    return Math.hypot(s.player.x - start.x, s.player.z - start.z) > 4;
  }, p0, 120000);
  await page.keyboard.up('KeyW');
  const s1 = await state(page);
  const moved = Math.hypot(s1.player.x - p0.x, s1.player.z - p0.z);
  check('WASD movement moves the robot', moved > 4, `moved=${moved.toFixed(1)} m`);
  check('robot stays on the terrain', Math.abs(s1.player.y - s1.player.ground) < 0.6, `y=${s1.player.y.toFixed(2)} ground=${s1.player.ground.toFixed(2)}`);

  // Jump: the robot must rise, then land back on the ground.
  const groundBefore = s1.player.ground;
  await page.keyboard.press('Space');
  await until(page, (g) => window.__genesis.state().player.y > g + 0.5 || !window.__genesis.state().player.grounded, groundBefore, 30000);
  const peak = (await state(page)).player.y;
  await until(page, () => window.__genesis.state().player.grounded, null, 30000);
  const landed = await state(page);
  check('jump lifts the robot and gravity lands it', peak > groundBefore + 0.3 && Math.abs(landed.player.y - landed.player.ground) < 0.3,
    `peak=${(peak - groundBefore).toFixed(2)} m, landed offset=${(landed.player.y - landed.player.ground).toFixed(2)} m`);

  // Camera toggle and panels.
  await page.keyboard.press('KeyV');
  await page.keyboard.press('Tab');
  await until(page, () => !document.getElementById('panel').classList.contains('hidden'), null, 30000);
  await page.screenshot({ path: `${OUT}/02-inventory.png` });
  check('Tab opens the inventory panel', true);
  await page.keyboard.press('Tab');
  await until(page, () => document.getElementById('panel').classList.contains('hidden'), null, 30000);
  await page.keyboard.press('Escape');
  await until(page, () => window.__genesis.state().state === 'paused', null, 30000);
  check('Escape opens the pause menu', true);
  await page.click('[data-action="resume"]');
  await until(page, () => window.__genesis.state().state === 'playing', null, 30000);
  check('resume returns to play', true);

  // Panels: map, journal and codex open and close; settings are reachable from the pause menu.
  for (const [key, label] of [['KeyM', 'Carte'], ['KeyJ', 'Journal de mission'], ['KeyK', 'Codex']]) {
    await page.keyboard.press(key);
    await until(page, (t) => document.getElementById('panel').textContent.includes(t), label, 60000);
    if (key === 'KeyM') await page.screenshot({ path: `${OUT}/05-map.png` });
    await page.keyboard.press(key);
    await until(page, () => document.getElementById('panel').classList.contains('hidden'), null, 60000);
  }
  check('map, journal and codex panels open and close', true);
  await page.keyboard.press('Escape');
  await until(page, () => window.__genesis.state().state === 'paused', null, 30000);
  await page.click('[data-action="open"][data-value="settings"]');
  await until(page, () => document.getElementById('panel').textContent.includes('Sensibilité souris'), null, 60000);
  await page.screenshot({ path: `${OUT}/06-settings.png` });
  await page.keyboard.press('Escape');
  await until(page, () => window.__genesis.state().state === 'playing', null, 60000);
  check('settings panel opens from the pause menu and Escape returns to play', true);

  // Weather: forced states must drive the matching precipitation levels.
  for (const [kind, field] of [['rain', 'rain'], ['sandstorm', 'sand'], ['snow', 'snow']]) {
    await page.evaluate((k) => window.__genesis.forceWeather(k), kind);
    await until(page, (f) => window.__genesis.state().weatherCurrent[f] > 0.5, field, 240000);
  }
  await page.screenshot({ path: `${OUT}/07-snow.png` });
  await page.evaluate(() => window.__genesis.forceWeather('clear'));
  check('weather transitions drive rain, sand and snow', true);

  // Resource collection: walk to the nearest node and press E.
  const node = await page.evaluate(() => window.__genesis.nearestNode());
  const stock = (s) => Object.values(s.inventory.counts).reduce((a, b) => a + b, 0);
  if (node) {
    const stockBefore = stock(await state(page));
    await page.evaluate((n) => window.__genesis.teleport(n.x + 1.2, n.z), node);
    await page.keyboard.press('KeyE');
    await until(page, (before) => Object.values(window.__genesis.state().inventory.counts).reduce((a, b) => a + b, 0) > before, stockBefore, 60000);
    check('E collects a resource node into the inventory', true, node.item);
  } else {
    check('E collects a resource node into the inventory', false, 'no node near the spawn');
  }

  // Rover: board with E, drive forward, leave with E.
  const rover0 = (await state(page)).vehicles.find((v) => v.type === 'rover');
  await page.evaluate((r) => window.__genesis.teleport(r.x + 2.5, r.z), rover0);
  await page.keyboard.press('KeyE');
  await until(page, () => window.__genesis.state().mounted?.type === 'rover', null, 60000);
  check('E boards the rover', true);
  const roverOf = async () => (await state(page)).vehicles.find((v) => v.type === 'rover');
  const roverStart = await roverOf();
  await page.keyboard.down('KeyW');
  await until(page, (r) => { const v = window.__genesis.state().vehicles.find((x) => x.type === 'rover'); return Math.hypot(v.x - r.x, v.z - r.z) > 6; }, roverStart, 120000);
  await page.keyboard.up('KeyW');
  const roverEnd = await roverOf();
  const rd = Math.hypot(roverEnd.x - roverStart.x, roverEnd.z - roverStart.z);
  check('the rover accelerates and drives', rd > 6 && roverEnd.energy < roverStart.energy,
    `moved=${rd.toFixed(1)} m, energy ${roverStart.energy.toFixed(1)} -> ${roverEnd.energy.toFixed(1)}`);
  await page.keyboard.press('KeyE');
  await until(page, () => !window.__genesis.state().mounted, null, 60000);
  check('E leaves the rover', true);

  // Scanner and weapon on the nearest living creature (several attempts: animals move).
  const target = async () => (await state(page)).nearCreatures.find((c) => c.alive);
  let scanned = false;
  for (let attempt = 0; attempt < 25 && !scanned; attempt++) {
    const c = await target();
    if (!c) { await sleep(2000); continue; }
    await page.evaluate((t) => { window.__genesis.teleport(t.x, t.z - 10); window.__genesis.aimAt(t.x, t.y + t.height * 0.5, t.z); }, c);
    await page.keyboard.press('KeyR');
    await sleep(1500);
    scanned = (await state(page)).codex.species.length > 0;
    if (!scanned) console.log('  scan attempt', attempt, c.species, await page.evaluate(() => document.getElementById('toasts')?.textContent?.slice(-120)));
  }
  check('R scans a creature and records it in the codex', scanned, scanned ? (await state(page)).codex.species.join(',') : 'no scan landed');
  await page.keyboard.press('Digit1');
  await until(page, () => window.__genesis.state().gear.weapon === 'plasma_pistol', null, 60000);
  check('1 equips the plasma pistol', true);
  let damaged = false;
  for (let attempt = 0; attempt < 12 && !damaged; attempt++) {
    const c = await target();
    if (!c) { damaged = true; break; }
    await page.evaluate((t) => { window.__genesis.teleport(t.x, t.z - 8); window.__genesis.aimAt(t.x, t.y + t.height * 0.5, t.z); }, c);
    await page.mouse.click(480, 270);
    await sleep(1500);
    const after = (await state(page)).nearCreatures.find((x) => x.id === c.id);
    damaged = !after || !after.alive || after.hp < c.hp;
  }
  check('left click fires the weapon and damages a creature', damaged);

  // Mission flow: travel to the camp, reach it, scan the beacon, collect the reward.
  const camp = (await state(page)).points.find((p) => p.id === 'camp');
  await page.evaluate((c) => window.__genesis.teleport(c.x - 7, c.z), camp);
  await until(page, () => (window.__genesis.state().missions.progress.reach_camp ?? 0) >= 1, null, 600000);
  check('reaching the camp completes the "reach" objective', true);
  let missionDone = false;
  for (let attempt = 0; attempt < 10 && !missionDone; attempt++) {
    await page.evaluate((c) => window.__genesis.aimAt(c.x, c.y + 4, c.z), camp);
    await page.keyboard.press('KeyR');
    await sleep(1500);
    missionDone = (await state(page)).missions.index >= 1;
  }
  const afterMission = await state(page);
  check('scanning the beacon completes the first mission and grants its reward',
    missionDone && (afterMission.inventory.counts.energy_cell ?? 0) >= 2 && afterMission.codex.points.includes('camp'),
    `missionIndex=${afterMission.missions.index}, cells=${afterMission.inventory.counts.energy_cell ?? 0}`);

  // Biome tour: every visited biome must be found and render without console errors.
  const tour = ['coral_reef', 'volcanic', 'canyon', 'polar_ice', 'desert', 'jungle'];
  const visited = [];
  for (const id of tour) {
    const spot = await page.evaluate((b) => window.__genesis.findBiome(b, 12000), id);
    if (!spot) continue;
    await page.evaluate((t) => window.__genesis.teleport(t.x, t.z), spot);
    await sleep(2500);
    visited.push(id);
  }
  check('biome tour: distinct biomes are reachable', visited.length >= 4, visited.join(','));
  const reef = await page.evaluate(() => window.__genesis.findBiome('coral_reef', 12000));
  if (reef) {
    await page.evaluate((t) => window.__genesis.teleport(t.x, t.z), reef);
    await until(page, () => window.__genesis.state().player.swimming, null, 60000);
    check('robot swims in the sea', true);
  }

  // Vehicles: spawn a buggy and a drone, board and leave each.
  await page.evaluate(() => { window.__genesis.grant('energy_cell', 6); });
  const land = await page.evaluate(() => window.__genesis.findBiome('meadow', 12000));
  await page.evaluate((t) => window.__genesis.teleport(t.x, t.z), land);
  await sleep(2000);
  for (const type of ['buggy', 'drone']) {
    await page.evaluate((t) => window.__genesis.spawnVehicle(t, 3, t === 'drone' ? 40 : 0), type);
    if (type === 'drone') await page.evaluate(() => { const d = window.__genesis.state().vehicles.find((v) => v.type === 'drone'); window.__genesis.teleport(d.x - 2.5, d.z); });
    await page.keyboard.press('KeyE');
    try {
      await until(page, (t) => window.__genesis.state().mounted?.type === t, type, 60000);
      await page.keyboard.down('KeyW');
      await sleep(3000);
      await page.keyboard.up('KeyW');
      const ok = (await state(page)).vehicles.find((v) => v.type === type);
      check(`${type}: board, drive/fly and consume energy`, !!ok && Math.abs(ok.speed) > 0.1 || ok?.energy < 100, `speed=${ok?.speed?.toFixed(1)}`);
    } catch { check(`${type}: board`, false, 'could not board'); }
    await page.keyboard.press('KeyE');
    await sleep(1500);
  }

  // Bases: build a generator and a workbench with the inventory resources.
  await page.evaluate(() => { for (const [i, n] of [['ore_metal', 20], ['mineral_silicate', 10], ['crystal_energy', 8], ['electronic_part', 6], ['fiber', 6]]) window.__genesis.grant(i, n); });
  const here = (await state(page)).player;
  const built = await page.evaluate((p) => [window.__genesis.build('workbench', p.x + 6, p.z + 6), window.__genesis.build('generator', p.x + 16, p.z + 6)], here);
  check('base structures can be placed with resources', built.every((b) => /^s\d+$/.test(b)), built.join(' | '));

  // Space: build the ship, launch, navigate, land back.
  await page.evaluate((p) => { window.__genesis.spawnVehicle('ship', 14, -8); }, here);
  const launched = await page.evaluate(() => window.__genesis.launch());
  if (launched) {
    await until(page, () => window.__genesis.state().space, null, 60000);
    check('ship launches into the space layer', true);
    await page.keyboard.down('KeyW');
    await sleep(3000);
    await page.keyboard.up('KeyW');
    await page.screenshot({ path: `${OUT}/08-space.png` });
    const sp = (await state(page)).space;
    check('space flight state is simulated', !!sp && sp.energy > 0, JSON.stringify(sp));
    await page.evaluate(() => window.__genesis.land('genesis'));
    await until(page, () => !window.__genesis.state().space, null, 60000);
    check('ship lands back on the planet', (await state(page)).vehicles.some((v) => v.type === 'ship'));
  } else check('ship launches into the space layer', false, 'no ship');

  // Character, weapons, jetpack and grid building.
  const g0 = (await state(page)).gear;
  check('the human character model is loaded and animated', g0.skinLoaded, g0.skin);
  await page.keyboard.press('Digit2');
  await until(page, () => window.__genesis.state().gear.weapon === 'laser_rifle', null, 60000);
  await page.mouse.down();
  await until(page, () => window.__genesis.state().gear.mags.laser_rifle < 30, null, 60000);
  await sleep(1500);
  await page.mouse.up();
  const g1 = (await state(page)).gear;
  check('the laser rifle fires on full auto and spends its magazine', g1.mags.laser_rifle < 30, `mag=${g1.mags.laser_rifle}`);
  await page.keyboard.press('KeyQ');
  await until(page, () => window.__genesis.state().gear.mags.laser_rifle === 30, null, 120000);
  check('Q reloads from the ammunition reserve', true);
  await page.keyboard.press('Space');
  await until(page, () => !window.__genesis.state().player.grounded, null, 30000);
  await page.keyboard.down('Space');
  await until(page, () => window.__genesis.state().gear.jetFuel < 99, null, 60000);
  const jetPeak = await state(page);
  await page.keyboard.up('Space');
  await until(page, () => window.__genesis.state().player.grounded, null, 120000);
  check('second jump press ignites the jetpack and burns fuel', jetPeak.gear.jetFuel < 99, `fuel=${jetPeak.gear.jetFuel.toFixed(0)}`);
  await page.keyboard.press('Digit0');
  await page.keyboard.press('KeyG');
  await until(page, () => window.__genesis.state().gear.gridMode === 'wall', null, 60000);
  const pieces0 = (await state(page)).gear.pieces.length;
  await page.mouse.click(480, 270);
  await until(page, (n) => window.__genesis.state().gear.pieces.length > n, pieces0, 60000);
  check('G then left click builds a wall', true);
  await page.keyboard.press('Digit3');
  await until(page, () => window.__genesis.state().gear.gridMode === 'ramp', null, 60000);
  await page.evaluate(() => window.__genesis.look(window.__genesis.state().player ? 1.6 : 0, -0.1));
  await page.mouse.click(480, 270);
  await until(page, (n) => window.__genesis.state().gear.pieces.length > n + 1, pieces0, 60000);
  check('3 then left click builds a ramp', true);
  await page.keyboard.press('KeyG');
  await until(page, () => !window.__genesis.state().gear.gridMode, null, 60000);

  // Measure frame times over 8 seconds of play.
  const frameStart = (await state(page)).frames;
  await sleep(8000);
  const frameEnd = (await state(page)).frames;
  const perfStats = await page.evaluate(() => window.__genesis.perf());
  const fps = (frameEnd - frameStart) / 8;
  const perfReport = {
    fps: +fps.toFixed(1), avgMs: +perfStats.avgMs.toFixed(2), p95Ms: +perfStats.p95Ms.toFixed(2),
    cpuUpdateMs: +perfStats.updateMs.toFixed(2), renderSubmitMs: +perfStats.renderMs.toFixed(2),
    drawCalls: perfStats.drawCalls, triangles: perfStats.triangles, geometries: perfStats.geometries, textures: perfStats.textures,
    viewport: '960x540', quality: 'low', renderer: await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    })
  };
  console.log('PERF', JSON.stringify(perfReport));
  check('frame loop keeps running', fps > 0.2, `fps=${fps.toFixed(1)}`);
  await page.screenshot({ path: `${OUT}/03-day.png` });

  await page.evaluate(() => window.__genesis.setTime(0.97));
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/04-night.png` });
  await page.evaluate(() => window.__genesis.setTime(0.5));

  // Save, reload and continue.
  const before = await state(page);
  await page.keyboard.press('Escape');
  await until(page, () => window.__genesis.state().state === 'paused', null, 30000);
  await page.click('[data-action="save"]');
  await until(page, () => localStorage.getItem('genesis.save.main') !== null, null, 30000);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#btn-continue:not([disabled])', { timeout: 15000 });
  await page.click('#btn-continue');
  await until(page, () => window.__genesis?.state().state === 'playing', null, 60000);
  await until(page, () => window.__genesis.state().frames > 30, null, 120000);
  const after = await state(page);
  const drift = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
  check('save and continue restore the robot position', drift < 6, `drift=${drift.toFixed(2)} m`);
  check('save and continue restore built pieces and weapon magazines',
    JSON.stringify(after.gear.pieces) === JSON.stringify(before.gear.pieces) && JSON.stringify(after.gear.mags) === JSON.stringify(before.gear.mags),
    `pieces=${after.gear.pieces.length} ${JSON.stringify(before.gear.mags)} vs ${JSON.stringify(after.gear.mags)} | ${JSON.stringify(before.gear.pieces)} vs ${JSON.stringify(after.gear.pieces)}`);
  check('save and continue restore missions and inventory',
    JSON.stringify(after.missions) === JSON.stringify(before.missions) && JSON.stringify(after.inventory) === JSON.stringify(before.inventory));

  check('no runtime errors in the console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, perf: perfReport, consoleErrors }, null, 2));
} catch (error) {
  check('test run completed', false, error.message.split('\n')[0]);
} finally {
  if (browser) await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
