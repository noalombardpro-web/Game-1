// Game orchestrator: builds the world for a seed (or a save), runs the simulation step,
// handles player interactions, and drives rendering, HUD, panels, saving and audio.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadContent } from '../world/content.js';
import { createTerrain, WATER_LEVEL } from '../world/terrain.js';
import { World } from '../world/world.js';
import { Environment } from '../world/environment.js';
import { Weather, WeatherParticles } from '../world/weather.js';
import { createVegetationAssets } from '../world/vegetationAssets.js';
import { createWindUniforms, createDetailTexture, createTerrainMaterial } from '../world/materials.js';
import { placePoints, buildPointVisual, containerId } from '../world/pois.js';
import { Player } from '../entities/player.js';
import { CameraRig } from '../entities/cameraRig.js';
import { CreatureManager } from '../entities/creatures.js';
import { EnemyManager } from '../entities/enemies.js';
import { Rover } from '../entities/rover.js';
import { Effects } from '../entities/effects.js';
import { Inventory } from '../systems/inventory.js';
import { Missions } from '../systems/missions.js';
import { RobotState, thermalTarget } from '../systems/survival.js';
import { raySphere, rayTerrain } from '../systems/raycast.js';
import { SaveManager, createStorage } from '../systems/save.js';
import { seedFromString } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { Input } from './input.js';
import { loadSettings, saveSettings, QUALITY_PRESETS } from './settings.js';
import { GameAudio } from '../audio/audio.js';
import { Profiler } from '../perf/profiler.js';
import { UI } from '../ui/ui.js';

const SIM_STEP = 1 / 30;
const SIM_MAX_FRAME = 0.25;
const AUTOSAVE_SECONDS = 90;
const INTERACT_RANGE = 3.2;
const SCAN_RANGE = 45;
const BOLT_RANGE = 70;
const BOLT_COOLDOWN = 0.35;
const WEAPON = { creature: 35, enemy: 40 };
const PANEL_KEYS = { inventory: 'inventory', map: 'map', journal: 'journal', codex: 'codex' };
const DAY_MINUTES = 24 * 60;

const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Frees GPU resources of a discarded scene. Shared assets are re-uploaded on demand by three.js. */
function disposeScene(scene) {
  scene.traverse((obj) => {
    if (obj.isInstancedMesh) obj.dispose();
    if (obj.geometry) obj.geometry.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of materials) m?.dispose?.();
  });
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.content = loadContent();
    this.storage = createStorage();
    this.saves = new SaveManager(this.storage);
    this.settings = loadSettings(this.storage);
    this.bindingOverrides = { ...(this.settings.bindings ?? {}) };
    this.bindings = { ...this.content.controls.bindings, ...this.bindingOverrides };
    this.ui = new UI(this.content, (name, payload) => this.onAction(name, payload));
    this.audio = new GameAudio(this.settings.volume);
    this.state = 'start';
    this.world = null;
    this.lastSaveText = null;
    this.logEntries = [];
    this.shotNoise = 0;
    this.weaponCooldown = 0;
    this.autosaveTimer = AUTOSAVE_SECONDS;
    this.biomeCache = { key: '', id: '' };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral studio reflections for the metallic robot and vehicles (no external texture).
    this.envMap = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.15, 3000);
    this.scene = new THREE.Scene();
    this.input = new Input(this.bindings, canvas);
    this.profiler = new Profiler(this.renderer);
    this.windUniforms = createWindUniforms();
    this.assets = createVegetationAssets(this.windUniforms);
    this.detailTexture = createDetailTexture();
    this.terrainMaterial = createTerrainMaterial(this.detailTexture);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => { if (this.state === 'playing') this.save(true); });
    // Click to capture the mouse; if the browser releases the lock (Esc) while playing, open the pause menu.
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !document.pointerLockElement) this.capturePointer();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing' && this.world) this.openPause();
    });
    this.last = performance.now();
    this.exposeDebugApi();
    requestAnimationFrame((t) => this.frame(t));
    this.ui.showStart(this.saves.hasSave);
  }

  resize() {
    const q = QUALITY_PRESETS[this.settings.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Exposes read-only state and a few test hooks for the end-to-end checks. */
  exposeDebugApi() {
    window.__genesis = {
      state: () => this.debugState(),
      teleport: (x, z) => this.player && this.player.spawnAt(x, z),
      setTime: (t) => this.environment?.setTime(t),
      perf: () => this.profiler.snapshot(),
      grant: (id, n) => this.inventory?.add(id, n),
      aimAt: (x, y, z) => this.rig?.aimAt(x, y, z),
      forceWeather: (kind) => { if (this.weather) { this.weather.kind = kind; this.weather.timer = 600; } },
      nearestNode: () => {
        const p = this.player.pos;
        const nodes = this.world.nodesNear(p.x, p.z).sort((a, b) => dist2d(a.x, a.z, p.x, p.z) - dist2d(b.x, b.z, p.x, p.z));
        return nodes[0] ? { x: nodes[0].x, y: nodes[0].y, z: nodes[0].z, item: nodes[0].item } : null;
      }
    };
  }

  debugState() {
    if (!this.world) return { state: this.state };
    return {
      state: this.state,
      seed: this.seed,
      frames: this.profiler.count,
      player: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, ground: this.player.groundY, grounded: this.player.grounded, swimming: this.player.swimming },
      robot: this.robot.toJSON(),
      chunks: this.world.loadedCount,
      streaming: { inflight: this.world.inflight.size, queued: this.world.results.length, workers: this.world.workers.length },
      creatures: this.creatures.count,
      views: this.creatures.activeViews,
      enemies: this.enemies.enemies.length,
      weather: this.weather.kind,
      weatherCurrent: { rain: this.weather.current.rain, snow: this.weather.current.snow, sand: this.weather.current.sand, fog: this.weather.current.fog },
      timeOfDay: this.environment.timeOfDay,
      missions: this.missions.toJSON(),
      rover: { seated: this.rover.seated, x: this.rover.x, z: this.rover.z, speed: this.rover.speed, energy: this.rover.energy },
      points: this.points.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z })),
      nearCreatures: this.creatures.near(this.player.pos.x, this.player.pos.z, 80).slice(0, 6).map((c) => ({
        id: c.id, species: c.species.id, x: c.x, y: c.y, z: c.z, hp: c.hp, alive: c.alive, height: c.species.size.height
      })),
      inventory: this.inventory.toJSON(),
      codex: { species: [...this.codex.species], points: [...this.codex.points] }
    };
  }

  // ---- Lifecycle ---------------------------------------------------------

  /** Starts (or restarts) a game. `options`: { load, seed, difficulty }. */
  startGame(options = {}) {
    let data = null;
    if (options.load) {
      const saved = this.saves.read();
      if (!saved) {
        this.ui.toast('Aucune sauvegarde lisible.', 'danger');
        return;
      }
      data = saved.data;
      if (saved.source === 'backup') this.ui.toast('Sauvegarde principale illisible : sauvegarde de secours chargée.', 'warn');
    }
    const seed = data ? data.seed : options.seed ? seedFromString(options.seed) : Math.floor(Math.random() * 0xffffffff) >>> 0;
    const difficulty = data?.difficulty ?? options.difficulty ?? this.settings.difficulty;
    this.buildWorld(seed, difficulty, data);
    this.state = 'playing';
    this.ui.showGame();
    this.audio.ensure();
    this.lastSaveText = data?.savedAt ? new Date(data.savedAt).toLocaleTimeString('fr-FR') : null;
    this.capturePointer();
    if (data) this.ui.toast('Partie chargée.', 'good');
    else this.ui.toast('Bienvenue sur PROJECT GENESIS. Votre expédition a perdu le contact : cherchez le signal au nord-est.', 'info');
  }

  buildWorld(seed, difficulty, data) {
    this.world?.dispose();
    if (this.scene) disposeScene(this.scene);
    this.scene = new THREE.Scene();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.45;
    this.seed = seed >>> 0;
    this.difficulty = difficulty;
    this.difficultyTable = this.content.enemies.difficulty[difficulty] ?? this.content.enemies.difficulty.normal;
    const q = QUALITY_PRESETS[this.settings.quality];
    this.quality = q;
    this.terrain = createTerrain(this.seed, this.content.biomeRules);
    this.environment = new Environment(this.scene, this.renderer, { shadowMap: q.shadowMap });
    this.weather = new Weather(this.seed, this.content.biomesById);
    this.weatherFx = new WeatherParticles(this.scene);
    this.effects = new Effects(this.scene);

    this.world = new World({
      scene: this.scene,
      seed: this.seed,
      terrain: this.terrain,
      content: this.content,
      assets: this.assets,
      terrainMaterial: this.terrainMaterial,
      quality: { viewRadius: q.viewRadius, vegDensity: q.vegDensity },
      collected: new Set(data?.collected ?? []),
      onChunkReady: (chunk) => this.creatures.onChunkReady(chunk),
      onChunkRemoved: (chunk) => this.creatures.onChunkRemoved(chunk)
    });
    this.creatures = new CreatureManager({
      scene: this.scene, world: this.world, content: this.content, difficulty: this.difficultyTable,
      damagePlayer: (amount) => this.damagePlayer(amount)
    });

    this.robot = new RobotState(data?.robot);
    this.player = new Player(this.scene, this.world, this.robot);
    const spawn = data?.player ?? { ...this.content.world.spawn, yaw: 0 };
    this.player.yaw = spawn.yaw;
    this.player.spawnAt(spawn.x, spawn.z);
    this.checkpoint = data?.checkpoint ?? { x: spawn.x, z: spawn.z };

    this.rig = new CameraRig(this.camera, this.settings);
    this.rig.yaw = spawn.yaw;
    this.inventory = new Inventory(this.content, data?.inventory);
    this.missions = new Missions(this.content, data?.missions);
    this.codex = { species: new Set(data?.codex?.species ?? []), points: new Set(data?.codex?.points ?? []) };

    this.points = placePoints(this.terrain, this.content.world, this.seed);
    this.pointVisuals = new Map();
    this.enemies = new EnemyManager({
      scene: this.scene, content: this.content, world: this.world, difficulty: this.difficultyTable,
      damagePlayer: (amount) => this.damagePlayer(amount), effects: this.effects, seed: this.seed
    });
    for (const poi of this.points) {
      for (const spec of this.content.world.enemies) {
        if (spec.poi === poi.id) this.enemies.spawnForPoint(poi, spec);
      }
    }

    const roverState = data?.rover;
    this.rover = roverState
      ? Object.assign(new Rover(this.scene, this.world, roverState.x, roverState.z), {
        yaw: roverState.yaw, energy: roverState.energy, hull: roverState.hull
      })
      : new Rover(this.scene, this.world, spawn.x + 5, spawn.z + 4);
    this.rover.yaw = roverState?.yaw ?? 0;
    this.rover.place();
    this.logEntries = [];
    this.world.update(this.player.pos.x, this.player.pos.z, 8);
    this.autosaveTimer = AUTOSAVE_SECONDS;
    if (data?.clock) this.environment.setTime(data.clock.timeOfDay);
  }

  capturePointer() {
    try {
      const result = this.canvas.requestPointerLock?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      /* pointer lock is optional */
    }
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  // ---- Main loop ---------------------------------------------------------

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    this.profiler.frame(now);
    const dt = clamp((now - this.last) / 1000, 0, SIM_MAX_FRAME);
    this.last = now;
    if (!this.world) {
      this.input.endFrame();
      return;
    }
    this.handleMenuKeys();
    if (this.state === 'playing') {
      // Fixed-rate substeps keep game time close to wall time when frames are slow.
      // Key edges belong to the first substep only, so one press is never applied twice.
      const t0 = performance.now();
      const steps = Math.max(1, Math.ceil(dt / SIM_STEP));
      for (let i = 0; i < steps; i++) {
        this.simulate(dt / steps);
        if (i === 0) this.input.endFrame();
      }
      this.world.update(this.player.pos.x, this.player.pos.z, 2);
      this.ui.update(dt, this.hudState());
      this.profiler.recordUpdate(performance.now() - t0);
    }
    const t1 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.profiler.recordRender(performance.now() - t1);
    this.input.endFrame();
  }

  handleMenuKeys() {
    if (this.state === 'start') return;
    if (this.input.pressed('menu')) {
      if (this.ui.panel) {
        this.onAction('close');
      } else if (this.state === 'playing') {
        this.openPause();
      } else if (this.state === 'paused') {
        this.onAction('resume');
      }
      return;
    }
    if (this.state !== 'playing' && this.state !== 'panel') return;
    for (const [action, panel] of Object.entries(PANEL_KEYS)) {
      if (this.input.pressed(action)) {
        if (this.ui.panel === panel) {
          this.onAction('close');
        } else {
          this.openPanel(panel);
        }
        return;
      }
    }
    if (this.input.pressed('perf')) this.perfVisible = !this.perfVisible;
  }

  openPause() {
    this.state = 'paused';
    this.releasePointer();
    this.openPanel('pause');
  }

  openPanel(name) {
    if (this.state === 'playing') this.state = 'panel';
    this.releasePointer();
    this.ui.openPanel(name, this.panelData());
  }

  refreshPanel() {
    if (this.ui.panel) this.ui.refreshPanel(this.panelData());
  }

  panelData() {
    return {
      inventory: this.inventory,
      content: this.content,
      missions: this.missions,
      logEntries: this.logEntries,
      codex: { species: [...this.codex.species], points: [...this.codex.points] },
      points: this.points,
      settings: this.settings,
      bindings: this.bindings,
      hasSave: this.saves.hasSave,
      lastSave: this.lastSaveText,
      player: { x: this.player?.pos.x ?? 0, z: this.player?.pos.z ?? 0 },
      creatures: this.creatures ? this.creatures.near(this.player.pos.x, this.player.pos.z, 300).map((c) => ({ x: c.x, z: c.z, predator: c.isPredator })) : [],
      enemies: this.enemies ? this.enemies.near(this.player.pos.x, this.player.pos.z, 500) : [],
      rover: this.rover ? { x: this.rover.x, z: this.rover.z } : null,
      objectiveTarget: this.objectiveTarget(),
      biomeAt: (x, z) => this.biomeColorAt(x, z)
    };
  }

  // ---- Simulation --------------------------------------------------------

  simulate(dt) {
    const player = this.player;
    const rover = this.rover;
    const look = this.input.consumeLook();
    this.rig.applyLook(look, true);
    this.weaponCooldown -= dt;
    this.shotNoise = Math.max(0, this.shotNoise - dt);
    this.autosaveTimer -= dt;

    if (this.input.pressed('camera')) this.rig.toggleMode();
    if (this.input.pressed('interact')) this.interact();
    if (this.input.pressed('scan')) this.scan();
    if (this.input.pressed('use')) this.useConsumable();
    if (this.input.isDown('fire')) this.fire();

    if (rover.seated) {
      rover.update(dt, this.input);
      player.pos.set(rover.x, rover.y, rover.z);
      player.model.root.visible = false;
      player.model.place(rover.x, rover.y, rover.z, rover.yaw);
      player.noise = rover.speed > 1 ? 0.8 : 0.2;
    } else {
      player.model.root.visible = true;
      player.update(dt, this.input, this.rig.yaw, (x, z) => this.biomeAt(x, z).id);
      rover.update(dt, this.input);
    }
    for (const event of player.takeEvents()) this.onPlayerEvent(event);

    const biome = this.biomeAt(player.pos.x, player.pos.z);
    const daylight = this.environment.daylight;
    this.robot.tick(dt, { target: thermalTarget(biome.id, daylight, player.pos.y), thermalFactor: this.inventory.effects.thermalFactor });
    if (this.robot.energy <= 0) this.robot.damage(0.3 * dt);
    if (this.robot.destroyed) this.onRobotDestroyed();

    this.weather.update(dt, biome.id);
    for (const event of this.weather.takeEvents()) {
      if (event.type === 'thunder') {
        this.environment.lightningFlash();
        this.audio.playThunder(event.delay);
      } else if (event.type === 'weather' && (event.kind === 'storm' || event.kind === 'sandstorm')) {
        this.ui.toast(`Alerte météo : ${this.weather.label}.`, 'warn');
      }
    }
    this.environment.update(dt, player.pos, this.weather, true);
    this.weatherFx.update(dt, this.rig.camera.position, this.weather);
    this.windUniforms.uTime.value += dt;
    this.windUniforms.uWind.value.set(this.weather.wind.x * 0.5, this.weather.wind.y * 0.5);
    this.windUniforms.uStrength.value = 0.35 + this.weather.windStrength * 0.25;

    const playerState = {
      x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw,
      noise: Math.max(player.noise, this.shotNoise), alive: this.robot.integrity > 0, crouched: player.crouched
    };
    this.creatures.update(dt, playerState, daylight, this.scene);
    this.enemies.update(dt, playerState);
    for (const loot of this.enemies.drainLoot()) this.grant(loot.item, loot.count);

    this.updateObjectives();
    this.effects.update(dt);

    this.audio.update(dt, {
      wind: this.weather.windStrength * 0.6,
      rain: this.weather.current.rain,
      engine: rover.seated ? rover.engineLoad : 0,
      tension: this.enemies.enemies.some((e) => e.fsm.current === 'combat' || e.fsm.current === 'alert') ? 1 : 0,
      alarm: this.enemies.enemies.some((e) => e.fsm.current === 'alert' && e.alive)
    });

    const target = rover.seated
      ? { x: rover.x, y: rover.y, z: rover.z, height: 2.2, distance: 8, forceThird: true }
      : { x: player.pos.x, y: player.pos.y, z: player.pos.z, height: player.crouched ? 1.0 : 1.5 };
    this.rig.update(dt, target, (x, z) => this.world.heightAt(x, z));

    if (this.autosaveTimer <= 0) this.save(true);
  }

  onPlayerEvent(event) {
    if (event.type === 'step') this.audio.playStep(event.surface, event.sprint);
    else if (event.type === 'jump') this.audio.playJump();
    else if (event.type === 'land') this.audio.playLand(event.drop);
    else if (event.type === 'fall-damage') this.ui.toast(`Chute : intégrité −${event.amount.toFixed(0)}`, 'danger');
  }

  damagePlayer(amount) {
    if (this.robot.destroyed) return;
    const taken = this.robot.damage(amount, 1 - this.inventory.effects.damageReduction);
    this.ui.flashDamage(taken * 3);
    this.audio.playHit();
    if (this.robot.destroyed) this.onRobotDestroyed();
  }

  onRobotDestroyed() {
    if (this.rover.seated) this.dismount();
    this.robot.integrity = 45;
    this.robot.energy = Math.max(this.robot.energy, 35);
    this.player.spawnAt(this.checkpoint.x, this.checkpoint.z);
    this.ui.toast('Robot réactivé au dernier point sûr. Intégrité partielle.', 'danger');
  }

  // ---- Player actions ----------------------------------------------------

  interact() {
    const p = this.player.pos;
    if (this.rover.seated) {
      this.dismount();
      return;
    }
    if (dist2d(p.x, p.z, this.rover.x, this.rover.z) < 4.2) {
      this.mount();
      return;
    }
    let nearest = null;
    let best = INTERACT_RANGE;
    for (const node of this.world.nodesNear(p.x, p.z)) {
      const d = dist2d(p.x, p.z, node.x, node.z);
      if (d < best) { best = d; nearest = node; }
    }
    if (nearest) {
      const got = this.grant(nearest.item, 1);
      if (got > 0) {
        this.world.collectNode(nearest);
        this.audio.playChime();
        this.handleNotices(this.missions.notify({ type: 'collect', item: nearest.item, amount: got }));
      }
      return;
    }
    const wreck = this.points.find((poi) => poi.type === 'wreck' && dist2d(p.x, p.z, poi.x, poi.z) < 8);
    if (wreck) {
      const id = containerId(wreck);
      if (this.world.collected.has(id)) {
        this.ui.toast('Le conteneur est vide.', 'info');
        return;
      }
      this.world.collected.add(id);
      const bonus = this.inventory.effects.lootBonus;
      this.grant('electronic_part', 2 + bonus);
      if (Math.random() < 0.5) this.grant('alien_sample', 1);
      this.audio.playChime();
      this.ui.toast('Conteneur scellé ouvert.', 'good');
      return;
    }
    this.ui.setPrompt(null);
  }

  mount() {
    this.rover.seated = true;
    this.rig.yaw = this.rover.yaw;
    this.ui.toast('Véhicule embarqué. W/S accélérer et freiner, A/D diriger, Maj turbo, E descendre.', 'info');
    this.audio.playChime();
  }

  dismount() {
    const at = this.rover.dismountPosition();
    this.rover.seated = false;
    this.rover.speed *= 0.2;
    this.player.yaw = this.rover.yaw;
    this.player.spawnAt(at.x, at.z);
    this.player.model.root.visible = true;
  }

  /** Fires the robot's plasma weapon (auto-fire while held, with a cooldown). */
  fire() {
    if (this.weaponCooldown > 0 || this.robot.destroyed) return;
    if (!this.robot.spend(1)) return;
    this.weaponCooldown = BOLT_COOLDOWN;
    this.shotNoise = 0.9;
    this.audio.playShot();
    const origin = this.rig.camera.position.clone();
    const dir = this.rig.forward();
    const gun = { x: this.player.pos.x + dir.x * 0.6, y: this.player.pos.y + 1.2, z: this.player.pos.z + dir.z * 0.6 };
    const terrainT = rayTerrain(this.world, origin, dir, BOLT_RANGE, 1);
    let hit = null;
    for (const c of this.creatures.near(origin.x, origin.z, BOLT_RANGE)) {
      const t = raySphere(origin, dir, { x: c.x, y: c.y + c.species.size.height * 0.5, z: c.z }, c.species.size.length * 0.5 + 0.3);
      if (t !== null && t < terrainT && (!hit || t < hit.t)) hit = { t, kind: 'creature', obj: c };
    }
    for (const e of this.enemies.enemies) {
      if (!e.alive) continue;
      const t = raySphere(origin, dir, { x: e.x, y: e.y, z: e.z }, 1.0);
      if (t !== null && t < terrainT && (!hit || t < hit.t)) hit = { t, kind: 'enemy', obj: e };
    }
    const endT = hit ? hit.t : terrainT;
    const end = { x: origin.x + dir.x * endT, y: origin.y + dir.y * endT, z: origin.z + dir.z * endT };
    this.effects.beam(gun, end, '#7fe9ff', 0.09);
    if (!hit) {
      this.effects.burst(end, '#7fe9ff', 0.4, 0.25);
      return;
    }
    if (hit.kind === 'creature') {
      const c = hit.obj;
      if (c.takeDamage(WEAPON.creature)) {
        this.grant('bio_sample', 1 + this.inventory.effects.lootBonus);
        this.ui.toast(`${c.species.name} neutralisé : matériau biologique récupéré.`, 'good');
      }
    } else if (this.enemies.hit(hit.obj, WEAPON.enemy)) {
      this.ui.toast(`${hit.obj.name} détruit.`, 'good');
      this.grant('ore_metal', 1);
    }
  }

  useConsumable() {
    const result = this.inventory.useConsumable(this.robot);
    this.ui.toast(result.message, result.ok ? 'good' : 'warn');
    this.refreshPanel();
  }

  craft(recipeId) {
    const recipe = this.content.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const result = this.inventory.craft(recipe);
    this.ui.toast(result.message, result.ok ? 'good' : 'warn');
    if (result.ok) this.audio.playChime();
    this.refreshPanel();
  }

  /** Scanner: identifies the closest target along the view ray and records it in the codex. */
  scan() {
    const origin = this.rig.camera.position.clone();
    const dir = this.rig.forward();
    const range = SCAN_RANGE * (1 + this.inventory.effects.scanRangeBonus);
    let best = null;
    const consider = (t, kind, obj) => {
      if (t !== null && t < range && (!best || t < best.t)) best = { t, kind, obj };
    };
    for (const c of this.creatures.near(origin.x, origin.z, range + 10)) {
      consider(raySphere(origin, dir, { x: c.x, y: c.y + c.species.size.height * 0.5, z: c.z }, c.species.size.length * 0.5 + 0.4), 'creature', c);
    }
    for (const e of this.enemies.enemies) {
      if (e.alive) consider(raySphere(origin, dir, { x: e.x, y: e.y, z: e.z }, 1.1), 'enemy', e);
    }
    for (const node of this.world.nodesNear(origin.x, origin.z)) {
      consider(raySphere(origin, dir, { x: node.x, y: node.y + 0.6, z: node.z }, 1.3), 'node', node);
    }
    for (const poi of this.points) {
      consider(raySphere(origin, dir, { x: poi.x, y: poi.y + 4, z: poi.z }, poi.radius * 0.7), 'poi', poi);
    }
    if (!this.rover.seated) consider(raySphere(origin, dir, { x: this.rover.x, y: this.rover.y + 1, z: this.rover.z }, 2.5), 'rover', this.rover);

    if (!best || rayTerrain(this.world, origin, dir, best.t, 2) < best.t - 2) {
      this.ui.toast('Aucune cible scannable dans le viseur.', 'info');
      return;
    }
    this.describeScan(best);
  }

  describeScan(hit) {
    const { kind, obj } = hit;
    if (kind === 'creature') {
      const sp = obj.species;
      const isNew = !this.codex.species.has(sp.id);
      this.codex.species.add(sp.id);
      this.ui.showScan({
        title: sp.name, body: sp.description,
        stats: [
          ['Régime', sp.diet], ['Taille', `${sp.size.length} m`], ['Vitesse de course', `${sp.speed.run} m/s`],
          ['Caractère', sp.temperament], ['État', obj.alive ? obj.state : 'neutralisé']
        ]
      });
      if (isNew) this.ui.toast(`Codex : ${sp.name} ajouté.`, 'good');
      this.handleNotices(this.missions.notify({ type: 'species', id: sp.id }));
    } else if (kind === 'enemy') {
      this.ui.showScan({
        title: obj.name, body: obj.description,
        stats: [['Points de structure', `${Math.round(obj.hp)} / ${obj.maxHp}`], ['Dégâts', `${obj.type.damage}`], ['Mode', obj.fsm.current]]
      });
    } else if (kind === 'node') {
      const item = this.content.itemsById[obj.item];
      this.ui.showScan({ title: item.name, body: item.description, stats: [['Gisement', 'Collectable (E)']] });
    } else if (kind === 'poi') {
      const isNew = !this.codex.points.has(obj.id);
      this.codex.points.add(obj.id);
      this.ui.showScan({ title: obj.name, body: obj.log, stats: [['Distance', `${Math.round(dist2d(this.player.pos.x, this.player.pos.z, obj.x, obj.z))} m`]] });
      if (isNew) this.addLog(`${obj.name} : ${obj.log}`);
      this.handleNotices(this.missions.notify({ type: 'scan', poi: obj.id }));
    } else if (kind === 'rover') {
      this.ui.showScan({ title: 'Rover d\'exploration', body: 'Véhicule tout-terrain à propulsion électrique.', stats: [['Énergie', `${Math.round(obj.energy)} %`], ['Coque', `${Math.round(obj.hull)} %`]] });
    }
    this.refreshPanel();
  }

  grant(id, count) {
    const got = this.inventory.add(id, count);
    const item = this.content.itemsById[id];
    if (got > 0) this.ui.toast(`+${got} ${item.name}`, 'good');
    if (got < count) this.ui.toast('Stockage plein : libérez de la place.', 'warn');
    return got;
  }

  // ---- Missions and objectives ------------------------------------------

  updateObjectives() {
    const step = this.missions.step;
    if (step?.type === 'reach') {
      const poi = this.points.find((p) => p.id === step.poi);
      if (poi && dist2d(this.player.pos.x, this.player.pos.z, poi.x, poi.z) < poi.radius + 6) {
        if (poi.type === 'camp') this.checkpoint = { x: poi.x + 3, z: poi.z + 3 };
        this.handleNotices(this.missions.notify({ type: 'reach', poi: poi.id }));
      }
    }
    this.syncPointVisuals();
  }

  /** Lazily builds the POI visuals near the player and removes far ones. Enemies stay simulated. */
  syncPointVisuals() {
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    for (const poi of this.points) {
      const d = dist2d(px, pz, poi.x, poi.z);
      if (!this.pointVisuals.has(poi.id) && d < 520) {
        this.pointVisuals.set(poi.id, buildPointVisual(poi, (x, z) => this.world.heightAt(x, z)));
        this.scene.add(this.pointVisuals.get(poi.id).group);
      } else if (this.pointVisuals.has(poi.id) && d > 760) {
        const visual = this.pointVisuals.get(poi.id);
        this.scene.remove(visual.group);
        visual.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
        this.pointVisuals.delete(poi.id);
      }
    }
    for (const [id, visual] of this.pointVisuals) {
      const poi = this.points.find((p) => p.id === id);
      if (visual.glyphs) visual.glyphs.forEach((g) => { g.material.emissiveIntensity = 1.6 + Math.sin(performance.now() * 0.002 + poi.x) * 0.6; });
      if (visual.beacon) visual.beacon.material.emissiveIntensity = 1.5 + Math.sin(performance.now() * 0.004) * 1.2;
    }
  }

  handleNotices(notices) {
    for (const notice of notices) {
      if (notice.kind === 'step') {
        this.ui.toast(`Objectif : ${notice.text}`, 'info');
        this.addLog(notice.text);
      } else if (notice.kind === 'complete') {
        this.ui.toast(`Mission terminée : ${notice.mission}`, 'good');
        this.addLog(notice.text);
        this.audio.playChime();
        for (const [id, count] of Object.entries(notice.reward)) this.grant(id, count);
      }
    }
    if (notices.length) this.refreshPanel();
  }

  addLog(text) {
    this.logEntries.unshift(`${this.clockLabel()} · ${text}`);
    if (this.logEntries.length > 40) this.logEntries.length = 40;
  }

  objectiveTarget() {
    const step = this.missions?.step;
    if (!step || !step.poi) return null;
    return this.points.find((p) => p.id === step.poi) ?? null;
  }

  // ---- Queries -----------------------------------------------------------

  biomeAt(x, z) {
    const sample = this.terrain.sample(x, z);
    const index = this.terrain.classify(sample.h, sample.temp, sample.moist);
    return this.content.biomes[index];
  }

  biomeColorAt(x, z) {
    const sample = this.terrain.sample(x, z);
    if (sample.h < WATER_LEVEL) return '#1f6f80';
    return this.content.biomes[this.terrain.classify(sample.h, sample.temp, sample.moist)].ground;
  }

  clockLabel() {
    const minutes = Math.floor(this.environment.timeOfDay * DAY_MINUTES);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  hudState() {
    const p = this.player.pos;
    const biome = this.biomeAt(p.x, p.z);
    const step = this.missions.step;
    const target = this.objectiveTarget();
    const aiming = this.enemies.enemies.some((e) => e.alive && e.fsm.current === 'combat');
    let prompt = null;
    if (!this.rover.seated) {
      if (dist2d(p.x, p.z, this.rover.x, this.rover.z) < 4.2) prompt = '[E] Monter dans le rover';
      else {
        const node = this.world.nodesNear(p.x, p.z).find((n) => dist2d(p.x, p.z, n.x, n.z) < INTERACT_RANGE);
        if (node) prompt = `[E] Collecter : ${this.content.itemsById[node.item].name}`;
        const wreck = this.points.find((poi) => poi.type === 'wreck' && dist2d(p.x, p.z, poi.x, poi.z) < 8);
        if (!node && wreck && !this.world.collected.has(containerId(wreck))) prompt = '[E] Ouvrir le conteneur scellé';
      }
    } else {
      prompt = '[E] Descendre du rover';
    }
    const objectiveText = this.missions.finished
      ? 'Missions principales terminées — exploration libre'
      : `${this.missions.mission.title} — ${step?.text ?? ''}`;
    const markers = [];
    const pointsForCompass = target ? [target] : this.points;
    for (const poi of pointsForCompass) {
      const d = dist2d(p.x, p.z, poi.x, poi.z);
      if (d > 1200) continue;
      const bearing = ((Math.atan2(poi.x - p.x, poi.z - p.z) * 180) / Math.PI + 360) % 360;
      markers.push({ bearing, label: poi.name.split(' ')[0], distance: Math.round(d), kind: target ? 'objective' : '' });
    }
    return {
      energy: this.robot.energy,
      integrity: this.robot.integrity,
      temperature: this.robot.temperature,
      weatherLabel: this.weather.label,
      biomeName: biome.name,
      clock: this.clockLabel(),
      objective: objectiveText,
      prompt,
      scanning: false,
      aiming,
      rover: this.rover.seated ? this.rover : null,
      roverCamera: this.rover.seated,
      markers,
      radar: {
        creatures: this.creatures.near(p.x, p.z, 70).map((c) => ({ x: c.x, z: c.z, predator: c.isPredator })),
        enemies: this.enemies.near(p.x, p.z, 90).map((e) => ({ x: e.x, z: e.z })),
        points: this.points.filter((poi) => dist2d(p.x, p.z, poi.x, poi.z) < 150).map((poi) => ({ x: poi.x, z: poi.z }))
      },
      objectiveTarget: target,
      player: { x: p.x, z: p.z },
      yaw: this.rig.yaw,
      perfVisible: !!this.perfVisible,
      perf: this.perfVisible ? this.profiler.snapshot() : null,
      chunks: this.world.loadedCount,
      creatures: this.creatures.count,
      views: this.creatures.activeViews,
      enemies: this.enemies.enemies.length
    };
  }

  // ---- Saving ------------------------------------------------------------

  snapshot() {
    return {
      seed: this.seed,
      difficulty: this.difficulty,
      player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw },
      checkpoint: this.checkpoint,
      robot: this.robot.toJSON(),
      inventory: this.inventory.toJSON(),
      missions: this.missions.toJSON(),
      codex: { species: [...this.codex.species], points: [...this.codex.points] },
      collected: [...this.world.collected],
      rover: { x: this.rover.x, z: this.rover.z, yaw: this.rover.yaw, energy: this.rover.energy, hull: this.rover.hull },
      clock: { timeOfDay: this.environment.timeOfDay }
    };
  }

  save(auto = false) {
    if (!this.world) return false;
    this.autosaveTimer = AUTOSAVE_SECONDS;
    try {
      const savedAt = this.saves.write(this.snapshot());
      this.lastSaveText = new Date(savedAt).toLocaleTimeString('fr-FR');
      if (!auto) this.ui.toast('Partie sauvegardée.', 'good');
      return true;
    } catch (error) {
      console.error('[save]', error);
      this.ui.toast(`Sauvegarde impossible (la sauvegarde précédente est conservée) : ${error.message}`, 'danger');
      return false;
    }
  }

  // ---- Menus and settings ------------------------------------------------

  applySettings() {
    saveSettings(this.storage, this.settings);
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setVolume(this.settings.volume);
    this.applyQuality();
  }

  applyQuality() {
    const q = QUALITY_PRESETS[this.settings.quality];
    this.quality = q;
    this.resize();
    this.environment?.setShadowMap(q.shadowMap);
    if (this.world) this.world.setQuality({ viewRadius: q.viewRadius, vegDensity: q.vegDensity });
  }

  async onAction(name, payload) {
    switch (name) {
      case 'new-game':
        this.startGame({ seed: this.ui.seedInput, difficulty: this.ui.difficultyInput });
        return;
      case 'continue':
        this.startGame({ load: true });
        return;
      case 'open-settings':
        this.ui.openPanel('settings', this.panelData());
        return;
      case 'close':
        this.ui.closePanel();
        if (this.state === 'start') return;
        if (this.state === 'panel' || this.state === 'paused') this.state = 'playing';
        this.capturePointer();
        return;
      case 'resume':
        this.ui.closePanel();
        this.state = 'playing';
        this.capturePointer();
        return;
      case 'save':
        this.save(false);
        this.refreshPanel();
        return;
      case 'load':
        this.startGame({ load: true });
        return;
      case 'quit':
        this.save(true);
        this.ui.closePanel();
        this.state = 'start';
        this.releasePointer();
        this.ui.showStart(this.saves.hasSave);
        return;
      case 'open':
        this.openPanel(payload);
        return;
      case 'tab':
        this.ui.tab = payload;
        this.refreshPanel();
        return;
      case 'use':
        this.useConsumable();
        return;
      case 'craft':
        this.craft(payload);
        return;
      case 'equip': {
        const ok = this.inventory.equip(payload);
        this.ui.toast(ok ? 'Module installé.' : 'Impossible d\'installer ce module.', ok ? 'good' : 'warn');
        this.refreshPanel();
        return;
      }
      case 'rebind': {
        this.ui.setRebindHint('Appuyez sur une touche ou un bouton… (Échap pour annuler)');
        const code = await this.input.captureNextCode();
        if (code) {
          this.bindingOverrides[payload] = [code];
          this.bindings[payload] = [code];
          this.input.setBindings(this.bindings);
          this.settings.bindings = { ...this.bindingOverrides };
          saveSettings(this.storage, this.settings);
        }
        this.refreshPanel();
        return;
      }
      case 'reset-bindings':
        this.bindingOverrides = {};
        this.bindings = { ...this.content.controls.bindings };
        this.input.setBindings(this.bindings);
        this.settings.bindings = null;
        saveSettings(this.storage, this.settings);
        this.refreshPanel();
        return;
      case 'quality':
        this.settings.quality = payload;
        this.applySettings();
        this.refreshPanel();
        return;
      case 'difficulty':
        this.settings.difficulty = payload;
        this.applySettings();
        this.refreshPanel();
        return;
      case 'invert':
        this.settings.invertY = !this.settings.invertY;
        this.applySettings();
        this.refreshPanel();
        return;
      case 'sens':
        this.settings.sensitivity = clamp(this.settings.sensitivity + Number(payload), 1, 10);
        this.applySettings();
        this.refreshPanel();
        return;
      case 'fov':
        this.settings.fov = clamp(this.settings.fov + Number(payload), 50, 100);
        this.applySettings();
        this.refreshPanel();
        return;
      case 'volume':
        this.settings.volume = clamp(Math.round((this.settings.volume + Number(payload)) * 10) / 10, 0, 1);
        this.applySettings();
        this.audio.ensure();
        this.refreshPanel();
        return;
      default:
        return;
    }
  }
}

