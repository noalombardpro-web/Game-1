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
import { VehicleManager } from '../vehicles/vehicle.js';
import { BaseManager, canPlace } from '../bases/bases.js';
import { Effects, Bubbles } from '../entities/effects.js';
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
const PANEL_KEYS = { inventory: 'inventory', map: 'map', journal: 'journal', codex: 'codex', build: 'build' };
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
      /** Nearest location of a biome id around the player, searched on an expanding ring (test helper). */
      findBiome: (id, maxR = 9000) => {
        const px = this.player.pos.x;
        const pz = this.player.pos.z;
        for (let r = 0; r <= maxR; r += 150) {
          const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 150));
          for (let k = 0; k < steps; k++) {
            const a = (k / steps) * Math.PI * 2;
            const x = px + Math.cos(a) * r;
            const z = pz + Math.sin(a) * r;
            if (this.biomeAt(x, z).id === id) return { x, z, h: this.terrain.height(x, z) };
          }
        }
        return null;
      },
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
      mounted: this.mounted ? { id: this.mounted.id, type: this.mounted.typeId } : null,
      structures: this.bases.list.map((s) => ({ id: s.id, type: s.typeId, x: s.x, z: s.z, level: s.level, powered: s.powered, stored: s.stored })),
      vehicles: this.vehicles.list.map((v) => ({ id: v.id, type: v.typeId, x: v.x, y: v.y, z: v.z, speed: v.speed, energy: v.energy, hull: v.hull, seated: v.seated })),
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
    this.bubbles = new Bubbles(this.scene);
    this.playerTarget = { isPlayer: true, x: 0, z: 0, alive: true };

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
      damagePlayer: (amount) => this.damagePlayer(amount),
      foodAt: (x, z) => this.foodAt(x, z)
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
    this.codex = { species: new Set(data?.codex?.species ?? []), points: new Set(data?.codex?.points ?? []), visited: new Set(data?.codex?.visited ?? []) };
    this.buildMode = null;
    this.selectedStructure = null;

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

    this.vehicles = new VehicleManager(this.scene, this.world, this.content.vehicles);
    this.mounted = null;
    if (data?.vehicles?.length) this.vehicles.restore(data.vehicles);
    else this.vehicles.add('rover', spawn.x + 5, spawn.z + 4, 0);
    this.bases = new BaseManager({ scene: this.scene, world: this.world, data: this.content.structures });
    this.bases.restore(data?.structures);
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
      if (this.buildMode) {
        this.cancelBuild();
      } else if (this.ui.panel) {
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
      points: this.discoveredPoints(),
      allPoints: this.points,
      structures: this.bases ? this.bases.list : [],
      structureDefs: this.content.structures,
      structure: this.selectedStructure,
      station: this.bases ? this.bases.bestStation(this.player.pos.x, this.player.pos.z) : 'hand',
      settings: this.settings,
      bindings: this.bindings,
      hasSave: this.saves.hasSave,
      lastSave: this.lastSaveText,
      player: { x: this.player?.pos.x ?? 0, z: this.player?.pos.z ?? 0 },
      creatures: this.creatures ? this.creatures.near(this.player.pos.x, this.player.pos.z, 300).map((c) => ({ x: c.x, z: c.z, predator: c.isPredator })) : [],
      enemies: this.enemies ? this.enemies.near(this.player.pos.x, this.player.pos.z, 500) : [],
      vehicles: this.vehicles ? this.vehicles.list.map((v) => ({ x: v.x, z: v.z, kind: v.kind })) : [],
      objectiveTarget: this.objectiveTarget(),
      biomeAt: (x, z) => this.biomeColorAt(x, z)
    };
  }

  // ---- Simulation --------------------------------------------------------

  simulate(dt) {
    const player = this.player;
    const look = this.input.consumeLook();
    this.rig.applyLook(look, true);
    const fx = this.inventory.effects;
    Object.assign(player.modifiers, {
      sprintBonus: fx.sprintBonus, damageReduction: fx.damageReduction, diveDepth: fx.diveDepth, swimBonus: fx.swimBonus, jumpBonus: fx.jumpBonus
    });
    this.playerTarget.x = player.pos.x;
    this.playerTarget.z = player.pos.z;
    this.weaponCooldown -= dt;
    this.shotNoise = Math.max(0, this.shotNoise - dt);
    this.autosaveTimer -= dt;

    if (this.input.pressed('camera')) this.rig.toggleMode();
    if (this.input.pressed('dismantle')) this.dismantleNearest();
    if (this.buildMode) this.updateBuild();
    if (this.input.pressed('interact')) this.interact();
    if (this.input.pressed('scan')) this.scan();
    if (this.input.pressed('use')) this.useConsumable();
    if (this.input.isDown('fire')) this.fire();

    const mounted = this.mounted;
    const env = { windX: this.weather.wind.x, windZ: this.weather.wind.y, windStrength: this.weather.windStrength, storm: this.weather.current.storm };
    this.inventory.externalCapacity = mounted?.cfg.capacityBonus ?? 0;
    this.vehicles.update(dt, this.input, mounted, env);
    if (mounted) {
      if (this.input.pressed('lamp')) mounted.setLights(!mounted.lightsOn);
      player.pos.set(mounted.x, mounted.y, mounted.z);
      player.model.root.visible = false;
      player.model.place(mounted.x, mounted.y, mounted.z, mounted.yaw);
      player.noise = Math.abs(mounted.speed) > 1 ? 0.8 : 0.3;
      if (mounted.disabled && !this.disabledWarned) {
        this.disabledWarned = true;
        this.ui.toast(`${mounted.name} hors service : descendez et réparez-le (U avec un kit de réparation).`, 'danger');
      }
    } else {
      this.disabledWarned = false;
      player.model.root.visible = true;
      player.update(dt, this.input, this.rig.yaw, (x, z) => this.biomeAt(x, z).id);
    }
    for (const event of player.takeEvents()) this.onPlayerEvent(event);

    const biome = this.biomeAt(player.pos.x, player.pos.z);
    const daylight = this.environment.daylight;
    // Survival modules reduce both the thermal drain and how far the components drift from 18 degC.
    const thermal = this.inventory.effects.thermalFactor;
    const rawTarget = thermalTarget(biome.id, daylight, player.pos.y);
    this.robot.tick(dt, { target: 18 + (rawTarget - 18) * (0.4 + 0.6 * thermal), thermalFactor: thermal });
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
    const cameraDepth = Math.max(0, WATER_LEVEL - this.rig.camera.position.y);
    this.environment.waterDepth = cameraDepth;
    this.environment.update(dt, player.pos, this.weather, true);
    if (cameraDepth > 0) this.weatherFx.hide();
    else this.weatherFx.update(dt, this.rig.camera.position, this.weather);
    this.bubbles.update(dt, this.rig.camera.position, cameraDepth, WATER_LEVEL);
    this.audio.setUnderwater(cameraDepth);
    this.windUniforms.uTime.value += dt;
    this.windUniforms.uWind.value.set(this.weather.wind.x * 0.5, this.weather.wind.y * 0.5);
    this.windUniforms.uStrength.value = 0.35 + this.weather.windStrength * 0.25;

    const playerState = {
      x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw,
      noise: Math.max(player.noise, this.shotNoise), alive: this.robot.integrity > 0, crouched: player.crouched
    };
    this.creatures.update(dt, playerState, daylight, this.scene, this.weather.severity);
    this.enemies.update(dt, playerState);
    for (const loot of this.enemies.drainLoot()) this.grant(loot.item, loot.count);

    this.bases.update({
      dt, player: { x: player.pos.x, z: player.pos.z, robot: this.robot }, vehicles: this.vehicles, mounted,
      enemies: this.enemies, creatures: this.creatures, effects: this.effects
    });
    this.updateObjectives();
    this.effects.update(dt);

    this.audio.update(dt, {
      wind: this.weather.windStrength * 0.6,
      rain: this.weather.current.rain,
      engine: mounted ? mounted.engineLoad : 0,
      tension: this.enemies.enemies.some((e) => e.fsm.current === 'combat' || e.fsm.current === 'alert') ? 1 : 0,
      alarm: this.enemies.enemies.some((e) => e.fsm.current === 'alert' && e.alive)
    });

    const target = mounted
      ? { x: mounted.x, y: mounted.y, z: mounted.z, height: mounted.cfg.camera.height, distance: mounted.cfg.camera.distance, forceThird: mounted.typeId !== 'drone' }
      : { x: player.pos.x, y: player.pos.y, z: player.pos.z, height: player.crouched ? 1.0 : 1.5 };
    this.rig.update(dt, target, (x, z) => this.world.heightAt(x, z));

    if (this.autosaveTimer <= 0) this.save(true);
  }

  onPlayerEvent(event) {
    if (event.type === 'step') this.audio.playStep(event.surface, event.sprint);
    else if (event.type === 'jump') this.audio.playJump();
    else if (event.type === 'land') this.audio.playLand(event.drop);
    else if (event.type === 'fall-damage') this.ui.toast(`Chute : intégrité −${event.amount.toFixed(0)}`, 'danger');
    else if (event.type === 'splash') {
      this.audio.playSplash(event.speed / 4 + 0.4);
      this.effects.burst({ x: this.player.pos.x, y: WATER_LEVEL, z: this.player.pos.z }, '#cfefff', 1.4, 0.5);
    } else if (event.type === 'pressure') {
      this.ui.toast(`Pression excessive à ${event.depth.toFixed(0)} m (limite ${event.limit.toFixed(0)} m) : remontez ou installez un équipement de plongée.`, 'danger');
    }
  }

  damagePlayer(amount) {
    if (this.robot.destroyed) return;
    const taken = this.robot.damage(amount, 1 - this.inventory.effects.damageReduction);
    this.ui.flashDamage(taken * 3);
    this.audio.playHit();
    if (this.robot.destroyed) this.onRobotDestroyed();
  }

  onRobotDestroyed() {
    if (this.mounted) this.dismount(true);
    this.robot.integrity = 45;
    this.robot.energy = Math.max(this.robot.energy, 35);
    this.player.spawnAt(this.checkpoint.x, this.checkpoint.z);
    this.ui.toast('Robot réactivé au dernier point sûr. Intégrité partielle.', 'danger');
  }

  // ---- Player actions ----------------------------------------------------

  interact() {
    const p = this.player.pos;
    if (this.mounted) {
      this.dismount();
      return;
    }
    const vehicle = this.vehicles.nearest(p.x, p.z, 5);
    if (vehicle) {
      this.mount(vehicle);
      return;
    }
    const structure = this.bases.nearest(p.x, p.z, 3);
    if (structure) {
      this.selectedStructure = structure;
      this.openPanel('structure');
      return;
    }
    let nearest = null;
    const reach = INTERACT_RANGE + this.inventory.effects.collectRange;
    let best = reach;
    for (const node of this.world.nodesNear(p.x, p.z)) {
      const d = dist2d(p.x, p.z, node.x, node.z);
      if (d < best) { best = d; nearest = node; }
    }
    if (nearest) {
      this.player.playAction('collect', 0.8);
      const tip = this.player.toolTipPosition(new THREE.Vector3());
      this.effects.beam(tip, { x: nearest.x, y: nearest.y + 0.6, z: nearest.z }, '#ffd166', 0.3);
      this.robot.wear(0.6 * this.inventory.effects.toolWear);
      if (Math.random() > this.robot.toolEfficiency) {
        this.ui.toast('Outil usé : la collecte a échoué. Réparez vos outils.', 'warn');
        return;
      }
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

  mount(vehicle) {
    if (vehicle.disabled) {
      this.ui.toast(`${vehicle.name} hors service : réparez-le avec un kit de réparation (U).`, 'warn');
      return;
    }
    this.mounted = vehicle;
    vehicle.seated = true;
    this.rig.yaw = vehicle.yaw;
    this.ui.toast(`${vehicle.name} — ${vehicle.cfg.hint}`, 'info');
    this.audio.playChime();
  }

  dismount(force = false) {
    const vehicle = this.mounted;
    if (!vehicle) return;
    const exit = vehicle.canExit();
    if (!exit.ok && !force) {
      this.ui.toast(exit.reason, 'warn');
      return;
    }
    const at = vehicle.dismountPosition();
    vehicle.seated = false;
    vehicle.speed *= 0.2;
    this.mounted = null;
    this.player.yaw = vehicle.yaw;
    this.player.spawnAt(at.x, at.z);
    this.player.model.root.visible = true;
  }

  /** Fires the robot's plasma weapon (auto-fire while held, with a cooldown). */
  fire() {
    if (this.buildMode || this.weaponCooldown > 0 || this.robot.destroyed) return;
    if (this.robot.tool <= 0) {
      this.ui.toast('Arme hors service : réparez vos outils.', 'danger');
      this.weaponCooldown = 1;
      return;
    }
    if (!this.robot.spend(1)) return;
    this.robot.wear(0.35 * this.inventory.effects.toolWear);
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
      if (c.takeDamage(WEAPON.creature * this.robot.toolEfficiency, this.playerTarget)) {
        this.grant('bio_sample', 1 + this.inventory.effects.lootBonus);
        this.ui.toast(`${c.species.name} neutralisé : matériau biologique récupéré.`, 'good');
      }
    } else if (this.enemies.hit(hit.obj, WEAPON.enemy * this.robot.toolEfficiency)) {
      this.ui.toast(`${hit.obj.name} détruit.`, 'good');
      this.grant('ore_metal', 1);
    }
  }

  useConsumable() {
    const p = this.player.pos;
    const needsRobot = this.robot.energy < 60 || this.robot.integrity < 70 || this.robot.tool < 55;
    const vehicle = this.mounted ?? this.vehicles.nearest(p.x, p.z, 7);
    if (!needsRobot && vehicle && this.serviceVehicle(vehicle)) return;
    const result = this.inventory.useConsumable(this.robot);
    this.ui.toast(result.message, result.ok ? 'good' : 'warn');
    this.refreshPanel();
  }

  /** Repairs or recharges a vehicle with a kit or a cell from the inventory. */
  serviceVehicle(vehicle) {
    const fx = this.inventory.effects;
    if (vehicle.hull < vehicle.cfg.hull * 0.9 && this.inventory.remove('repair_kit', 1)) {
      const restored = vehicle.repair(vehicle.cfg.hull * 0.5 * (1 + fx.repairBonus));
      this.player.playAction('repair', 0.9);
      this.effects.beam(this.player.toolTipPosition(new THREE.Vector3()), { x: vehicle.x, y: vehicle.y + 1, z: vehicle.z }, '#ff8a3d', 0.4);
      this.ui.toast(`${vehicle.name} réparé : +${Math.round(restored)} de coque.`, 'good');
      this.audio.playChime();
      this.refreshPanel();
      return true;
    }
    if (vehicle.energy < vehicle.cfg.energy * 0.7 && this.inventory.remove('energy_cell', 1)) {
      const added = vehicle.recharge(vehicle.cfg.energy * 0.5);
      this.ui.toast(`${vehicle.name} rechargé : +${Math.round(added)} d'énergie.`, 'good');
      this.audio.playChime();
      this.refreshPanel();
      return true;
    }
    return false;
  }

  craft(recipeId) {
    const recipe = this.content.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const p = this.player.pos;
    const result = this.inventory.craft(recipe, this.bases.bestStation(p.x, p.z));
    this.ui.toast(result.message, result.ok ? 'good' : 'warn');
    if (result.ok) this.audio.playChime();
    this.refreshPanel();
  }

  /** Scanner: identifies the closest target along the view ray and records it in the codex. */
  scan() {
    const origin = this.rig.camera.position.clone();
    const dir = this.rig.forward();
    const range = SCAN_RANGE * (1 + this.inventory.effects.scanRangeBonus);
    this.player.playAction('scan', 0.8);
    this.robot.wear(0.5 * this.inventory.effects.toolWear);
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
    for (const v of this.vehicles.list) {
      if (v !== this.mounted) consider(raySphere(origin, dir, { x: v.x, y: v.y + 1, z: v.z }, v.cfg.radius * 1.2), 'vehicle', v);
    }

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
    } else if (kind === 'vehicle') {
      this.ui.showScan({
        title: obj.name, body: obj.cfg.hint,
        stats: [['Énergie', `${Math.round((obj.energy / obj.cfg.energy) * 100)} %`], ['Coque', `${Math.round((obj.hull / obj.cfg.hull) * 100)} %`], ['Vitesse max.', `${Math.round(obj.cfg.maxSpeed * 3.6)} km/h`]]
      });
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
    for (const poi of this.points) {
      if (!this.codex.visited.has(poi.id) && dist2d(this.player.pos.x, this.player.pos.z, poi.x, poi.z) < 90) {
        this.codex.visited.add(poi.id);
        this.ui.toast(`Lieu découvert : ${poi.name}`, 'good');
        this.addLog(`Découverte : ${poi.name}`);
      }
    }
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

  /** Places the player knows about: visited, scanned, or within the range of a communication tower. */
  discoveredPoints() {
    const p = this.player?.pos;
    return this.points.filter((poi) => this.codex.visited.has(poi.id) || this.codex.points.has(poi.id)
      || (this.bases?.hasComm && p && dist2d(p.x, p.z, poi.x, poi.z) < 2000));
  }

  objectiveTarget() {
    const step = this.missions?.step;
    if (!step || !step.poi) return null;
    return this.points.find((p) => p.id === step.poi) ?? null;
  }

  // ---- Queries -----------------------------------------------------------

  /** Forage value of a spot for herbivores: summed density of edible vegetation in its biome. */
  foodAt(x, z) {
    const biome = this.biomeAt(x, z);
    return biome.vegetation.reduce((sum, v) => sum + (['grass', 'fern', 'shrub'].includes(v.kind) ? v.perM2 : 0), 0);
  }

  biomeAt(x, z) {
    const sample = this.terrain.sample(x, z);
    const index = this.terrain.classify(sample);
    return this.content.biomes[index];
  }

  biomeColorAt(x, z) {
    const sample = this.terrain.sample(x, z);
    if (sample.h < WATER_LEVEL) return '#1f6f80';
    return this.content.biomes[this.terrain.classify(sample)].ground;
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
    const radarRange = this.bases.hasComm ? 220 : 80;
    const aiming = this.enemies.enemies.some((e) => e.alive && e.fsm.current === 'combat');
    let prompt = null;
    if (!this.mounted) {
      const near = this.vehicles.nearest(p.x, p.z, 5);
      const structure = this.bases.nearest(p.x, p.z, 3);
      if (near) prompt = `[E] Monter : ${near.name}${near.disabled ? ' (hors service)' : ''}`;
      else if (structure) prompt = `[E] Utiliser : ${structure.def.name}${structure.powered ? '' : ' (hors tension)'}`;
      else {
        const node = this.world.nodesNear(p.x, p.z).find((n) => dist2d(p.x, p.z, n.x, n.z) < INTERACT_RANGE);
        if (node) prompt = `[E] Collecter : ${this.content.itemsById[node.item].name}`;
        const wreck = this.points.find((poi) => poi.type === 'wreck' && dist2d(p.x, p.z, poi.x, poi.z) < 8);
        if (!node && wreck && !this.world.collected.has(containerId(wreck))) prompt = '[E] Ouvrir le conteneur scellé';
      }
    } else {
      prompt = `[E] Descendre : ${this.mounted.name}`;
    }
    if (this.buildMode) {
      const def = this.content.structures.structures[this.buildMode.type];
      prompt = `${def.name} — ${this.buildMode.valid ? 'clic gauche : poser' : this.buildMode.reason}`;
    }
    const objectiveText = this.missions.finished
      ? 'Missions principales terminées — exploration libre'
      : `${this.missions.mission.title} — ${step?.text ?? ''}`;
    const markers = [];
    const pointsForCompass = target ? [target] : [];
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
      vehicle: this.mounted ? {
        name: this.mounted.name, kmh: this.mounted.kmh,
        energy: (this.mounted.energy / this.mounted.cfg.energy) * 100, hull: (this.mounted.hull / this.mounted.cfg.hull) * 100,
        altitude: this.mounted.kind === 'air' ? this.mounted.altitude : null,
        depth: this.mounted.kind === 'sub' ? this.mounted.depth : null
      } : null,
      markers,
      radarRange,
      radar: {
        creatures: this.creatures.near(p.x, p.z, radarRange).map((c) => ({ x: c.x, z: c.z, predator: c.isPredator })),
        enemies: this.enemies.near(p.x, p.z, radarRange).map((e) => ({ x: e.x, z: e.z })),
        points: this.discoveredPoints().filter((poi) => dist2d(p.x, p.z, poi.x, poi.z) < radarRange * 1.8).map((poi) => ({ x: poi.x, z: poi.z }))
      },
      objectiveTarget: target,
      player: { x: p.x, z: p.z },
      yaw: this.rig.yaw,
      tool: this.robot.tool,
      depth: this.player.swimming ? { value: this.player.depthBelowSurface, limit: this.player.diveLimit } : null,
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
      codex: { species: [...this.codex.species], points: [...this.codex.points], visited: [...this.codex.visited] },
      structures: this.bases.toJSON(),
      collected: [...this.world.collected],
      vehicles: this.vehicles.toJSON(),
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

  // ---- Bases and building -----------------------------------------------

  startBuild(typeId) {
    this.ui.closePanel();
    if (this.state === 'panel') this.state = 'playing';
    this.buildMode = { type: typeId, yaw: this.rig.yaw, valid: false, x: 0, z: 0 };
    this.bases.setGhost(typeId);
    this.capturePointer();
    this.ui.toast(`Construction : ${this.content.structures.structures[typeId].name}. Clic gauche pour poser, Z/X pivoter, Échap annuler.`, 'info');
  }

  cancelBuild() {
    this.buildMode = null;
    this.bases.setGhost(null);
  }

  updateBuild() {
    const b = this.buildMode;
    const origin = this.rig.camera.position;
    const dir = this.rig.forward();
    const t = rayTerrain(this.world, origin, dir, 45, 0.5);
    let x = origin.x + dir.x * t;
    let z = origin.z + dir.z * t;
    const p = this.player.pos;
    const d = dist2d(x, z, p.x, p.z);
    if (d > 26) { x = p.x + ((x - p.x) / d) * 26; z = p.z + ((z - p.z) / d) * 26; }
    if (this.input.pressed('rotate_left')) b.yaw += Math.PI / 8;
    if (this.input.pressed('rotate_right')) b.yaw -= Math.PI / 8;
    const def = this.content.structures.structures[b.type];
    const check = canPlace(this.world, this.bases.list, this.content.structures.structures, b.type, x, z);
    const affordable = this.bases.affordable(this.inventory, def.cost);
    b.valid = check.ok && affordable;
    b.reason = !check.ok ? check.reason : !affordable ? 'Ressources insuffisantes.' : '';
    this.bases.moveGhost(x, z, b.yaw, b.valid);
    if (this.input.pressed('fire')) {
      if (!b.valid) {
        this.ui.toast(b.reason, 'warn');
      } else {
        const result = this.bases.place(this.inventory, b.type, x, z, b.yaw);
        if (result.ok) {
          this.audio.playChime();
          this.effects.burst({ x, y: this.world.heightAt(x, z) + 1, z }, '#9bd1ff', 2.4, 0.5);
          this.ui.toast(`${def.name} construit.`, 'good');
          if (!this.bases.affordable(this.inventory, def.cost)) this.cancelBuild();
        } else {
          this.ui.toast(result.reason, 'warn');
        }
      }
    }
  }

  dismantleNearest() {
    const p = this.player.pos;
    const s = this.bases.nearest(p.x, p.z, 8);
    if (s) this.dismantle(s);
  }

  dismantle(structure) {
    if (!structure) return;
    const { refund, lost } = this.bases.dismantle(this.inventory, structure);
    this.selectedStructure = null;
    this.ui.closePanel();
    if (this.state === 'panel') this.state = 'playing';
    this.ui.toast(`Structure démontée${lost ? ` (${lost} unités perdues faute de place)` : ''}.`, 'info');
    this.capturePointer();
    return refund;
  }

  rest() {
    const s = this.selectedStructure;
    if (!s || !s.powered) {
      this.ui.toast('Le module n’est pas alimenté.', 'warn');
      return;
    }
    this.robot.repair(100);
    this.robot.recharge(100);
    this.robot.repairTools(100);
    this.environment.setTime(this.environment.timeOfDay + 4 / 24);
    this.save(false);
    this.ui.toast('Repos terminé : intégrité, énergie et outils restaurés. Partie sauvegardée.', 'good');
  }

  /** Moves items between the inventory and the selected storage. */
  transfer(direction, payload) {
    const s = this.selectedStructure;
    if (!s || s.typeId !== 'storage') return;
    const [id, amountText] = payload.split(':');
    if (direction === 'deposit') {
      const want = amountText === 'all' ? this.inventory.count(id) : Math.min(Number(amountText), this.inventory.count(id));
      const room = Math.max(0, s.capacity - s.stored);
      const n = Math.min(want, room);
      if (n > 0 && this.inventory.remove(id, n)) s.storage[id] = (s.storage[id] ?? 0) + n;
      else if (want > 0) this.ui.toast('Entrepôt plein.', 'warn');
    } else {
      const have = s.storage[id] ?? 0;
      const got = this.inventory.add(id, Math.min(Number(amountText), have));
      if (got > 0) {
        s.storage[id] -= got;
        if (s.storage[id] <= 0) delete s.storage[id];
      } else {
        this.ui.toast('Inventaire plein.', 'warn');
      }
    }
    this.refreshPanel();
  }

  buildVehicle(typeId) {
    const s = this.selectedStructure;
    const cfg = this.content.vehicles[typeId];
    if (!s || s.typeId !== 'garage' || !cfg?.cost || !s.powered) return;
    if (!this.bases.affordable(this.inventory, cfg.cost)) {
      this.ui.toast('Ressources insuffisantes.', 'warn');
      return;
    }
    this.bases.spend(this.inventory, cfg.cost);
    const d = s.def.radius + cfg.radius + 1.5;
    const x = s.x + Math.sin(s.yaw) * d;
    const z = s.z + Math.cos(s.yaw) * d;
    this.vehicles.add(typeId, x, z, s.yaw);
    this.audio.playChime();
    this.ui.toast(`${cfg.name} construit devant le garage.`, 'good');
    this.refreshPanel();
  }

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
      case 'select-structure':
        this.startBuild(payload);
        return;
      case 'rest':
        this.rest();
        return;
      case 'open-craft':
        this.ui.tab = 'craft';
        this.openPanel('inventory');
        return;
      case 'upgrade': {
        const r = this.bases.upgrade(this.inventory, this.selectedStructure);
        this.ui.toast(r.ok ? 'Structure améliorée.' : r.reason, r.ok ? 'good' : 'warn');
        this.refreshPanel();
        return;
      }
      case 'dismantle-structure':
        this.dismantle(this.selectedStructure);
        return;
      case 'deposit':
      case 'withdraw':
        this.transfer(name, payload);
        return;
      case 'build-vehicle':
        this.buildVehicle(payload);
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

