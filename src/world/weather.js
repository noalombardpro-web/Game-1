// Weather state machine. Each biome lists the weather it can produce (data/biomes.json);
// transitions are smoothed so that the atmosphere changes gradually.
import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { createRng } from '../core/rng.js';

export const WEATHER = {
  clear: { cloud: 0.12, rain: 0, snow: 0, sand: 0, fog: 0.0008, wind: 0.25, storm: false, color: '#b9d3e6', duration: [90, 180] },
  cloudy: { cloud: 0.6, rain: 0, snow: 0, sand: 0, fog: 0.0011, wind: 0.5, storm: false, color: '#a9b7c2', duration: [70, 150] },
  rain: { cloud: 0.9, rain: 1, snow: 0, sand: 0, fog: 0.0018, wind: 0.8, storm: false, color: '#8ea0ae', duration: [60, 120] },
  storm: { cloud: 1, rain: 1, snow: 0, sand: 0, fog: 0.0024, wind: 1.7, storm: true, color: '#56606b', duration: [40, 80] },
  fog: { cloud: 0.7, rain: 0, snow: 0, sand: 0, fog: 0.0048, wind: 0.2, storm: false, color: '#c6cfd6', duration: [60, 120] },
  snow: { cloud: 0.9, rain: 0, snow: 1, sand: 0, fog: 0.0024, wind: 0.9, storm: false, color: '#dfe7ef', duration: [70, 140] },
  ashfall: { cloud: 0.8, rain: 0, snow: 0, sand: 1, fog: 0.0045, wind: 1.0, storm: false, color: '#4a4440', duration: [60, 120] },
  sandstorm: { cloud: 0.5, rain: 0, snow: 0, sand: 1, fog: 0.0060, wind: 2.2, storm: false, color: '#c9a471', duration: [45, 90] }
};

const BLEND_SECONDS = 10;

export class Weather {
  constructor(seed, biomesById) {
    this.rng = createRng(seed ^ 0x51ed);
    this.biomesById = biomesById;
    this.kind = 'clear';
    this.current = { ...WEATHER.clear };
    this.timer = 60;
    this.biomeId = 'meadow';
    this.lightning = 0;
    this.lightningTimer = 4;
    this.windAngle = 0.4;
    this.windDir = new THREE.Vector2(1, 0);
    this.windStrength = 0.3;
    this.wind = new THREE.Vector2(1, 0);
    this.events = [];
    this.fogColor = new THREE.Color(WEATHER.clear.color);
  }

  /** Picks the next weather from the list allowed by the biome the player is in. */
  choose(biomeId) {
    const options = this.biomesById[biomeId]?.weather ?? ['clear'];
    const next = options[Math.floor(this.rng() * options.length)];
    return WEATHER[next] ? next : 'clear';
  }

  update(dt, biomeId) {
    this.biomeId = biomeId;
    this.timer -= dt;
    if (this.timer <= 0) {
      const next = this.choose(biomeId);
      const [min, max] = WEATHER[next].duration;
      this.timer = min + (max - min) * this.rng();
      if (next !== this.kind) this.events.push({ type: 'weather', kind: next });
      this.kind = next;
    }

    const target = WEATHER[this.kind];
    const k = 1 - Math.exp(-dt / (BLEND_SECONDS / 3));
    for (const key of ['cloud', 'rain', 'snow', 'sand', 'fog', 'wind']) {
      this.current[key] = lerp(this.current[key], target[key], k);
    }
    this.current.storm = target.storm;
    this.fogColor.lerp(new THREE.Color(target.color), k);

    // Wind slowly turns and gusts.
    this.windAngle += dt * 0.03;
    const gust = 0.75 + 0.25 * Math.sin(this.windAngle * 9) * Math.cos(this.windAngle * 3.1);
    this.windStrength = clamp(this.current.wind * gust, 0, 3);
    this.windDir.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    this.wind.copy(this.windDir).multiplyScalar(this.windStrength);

    // Lightning during storms.
    if (this.current.storm) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightning = 1;
        this.lightningTimer = 3 + this.rng() * 6;
        this.events.push({ type: 'thunder', delay: 0.6 + this.rng() * 2.5 });
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 3);
  }

  takeEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 0..1: how dangerous the current weather is for animals (storms, sand, heavy rain or snow). */
  get severity() {
    const c = this.current;
    return Math.max(c.storm ? 1 : 0, c.sand > 0.5 ? 0.9 : 0, c.rain > 0.7 ? 0.6 : 0, c.snow > 0.8 ? 0.6 : 0);
  }

  get label() {
    return {
      clear: 'Ciel dégagé', cloudy: 'Nuageux', rain: 'Pluie', storm: 'Orage',
      fog: 'Brouillard', snow: 'Neige', sandstorm: 'Tempête de sable', ashfall: 'Chute de cendres'
    }[this.kind];
  }
}

/** Precipitation particles (rain streaks, snow flakes, sand grains) around the camera. */
export class WeatherParticles {
  constructor(scene) {
    this.box = { x: 70, y: 40, z: 70 };
    this.rainCount = 1400;
    this.snowCount = 1400;
    this.sandCount = 1800;

    const rainGeo = new THREE.BufferGeometry();
    this.rainBase = new Float32Array(this.rainCount * 6);
    this.rainPos = new Float32Array(this.rainCount * 6);
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#b8d4ff', transparent: true, opacity: 0.45, depthWrite: false }));

    const snowGeo = new THREE.BufferGeometry();
    this.snowPos = new Float32Array(this.snowCount * 3);
    snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));

    const sandGeo = new THREE.BufferGeometry();
    this.sandPos = new Float32Array(this.sandCount * 3);
    sandGeo.setAttribute('position', new THREE.BufferAttribute(this.sandPos, 3));
    this.sand = new THREE.Points(sandGeo, new THREE.PointsMaterial({ color: '#d7b77e', size: 0.09, transparent: true, opacity: 0.7, depthWrite: false }));

    for (const obj of [this.rain, this.snow, this.sand]) {
      obj.frustumCulled = false;
      obj.visible = false;
      scene.add(obj);
    }
    const rng = createRng(4242);
    const seedBox = (arr, count) => {
      for (let i = 0; i < count; i++) {
        arr[i * 3] = (rng() - 0.5) * this.box.x * 2;
        arr[i * 3 + 1] = rng() * this.box.y;
        arr[i * 3 + 2] = (rng() - 0.5) * this.box.z * 2;
      }
    };
    seedBox(this.snowPos, this.snowCount);
    seedBox(this.sandPos, this.sandCount);
    for (let i = 0; i < this.rainCount; i++) {
      const x = (rng() - 0.5) * this.box.x * 2;
      const y = rng() * this.box.y;
      const z = (rng() - 0.5) * this.box.z * 2;
      this.rainBase.set([x, y, z, x, y, z], i * 6);
    }
    this.rng = rng;
  }

  /** Hides every particle system (used while the camera is underwater). */
  hide() {
    this.rain.visible = this.snow.visible = this.sand.visible = false;
  }

  /** Moves the particles with the wind and wraps them inside the box around the camera. */
  update(dt, center, weather) {
    const rainAmount = weather.current.rain;
    const snowAmount = weather.current.snow;
    const sandAmount = weather.current.sand;
    this.rain.visible = rainAmount > 0.05;
    this.snow.visible = snowAmount > 0.05;
    this.sand.visible = sandAmount > 0.05;
    const wx = weather.wind.x;
    const wz = weather.wind.y;
    const { x: bx, y: by, z: bz } = this.box;

    if (this.rain.visible) {
      const speed = 22;
      const streak = 0.9;
      for (let i = 0; i < this.rainCount; i++) {
        const o = i * 6;
        let x = this.rainBase[o];
        let y = this.rainBase[o + 1];
        let z = this.rainBase[o + 2];
        y -= speed * dt;
        if (y < 0) { y += by; x = (this.rng() - 0.5) * bx * 2; z = (this.rng() - 0.5) * bz * 2; }
        x += wx * dt * 2;
        z += wz * dt * 2;
        this.rainBase[o] = x; this.rainBase[o + 1] = y; this.rainBase[o + 2] = z;
        const ox = center.x + wrap(x, bx);
        const oz = center.z + wrap(z, bz);
        const oy = center.y - 2 + y;
        this.rainPos[o] = ox; this.rainPos[o + 1] = oy; this.rainPos[o + 2] = oz;
        this.rainPos[o + 3] = ox - wx * 0.05; this.rainPos[o + 4] = oy + streak; this.rainPos[o + 5] = oz - wz * 0.05;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.25 + 0.4 * rainAmount;
    }
    if (this.snow.visible) {
      moveCloud(this.snowPos, this.snowCount, dt, 1.6, wx * 0.7, wz * 0.7, bx, by, bz);
      this.snow.position.copy(center);
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.material.opacity = 0.5 + 0.4 * snowAmount;
    }
    if (this.sand.visible) {
      moveCloud(this.sandPos, this.sandCount, dt, -0.4, wx * 2.2, wz * 2.2, bx, by, bz);
      this.sand.position.copy(center);
      this.sand.geometry.attributes.position.needsUpdate = true;
      this.sand.material.opacity = 0.3 + 0.5 * sandAmount;
    }
  }
}

function wrap(value, half) {
  const span = half * 2;
  return ((((value + half) % span) + span) % span) - half;
}

/** Moves box-local particles (snow, sand) with the wind; they wrap around the box. */
function moveCloud(arr, count, dt, fall, wx, wz, bx, by, bz) {
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    arr[o] += wx * dt;
    arr[o + 1] += fall * dt;
    arr[o + 2] += wz * dt;
    if (arr[o + 1] < 0) arr[o + 1] += by;
    if (arr[o + 1] > by) arr[o + 1] -= by;
    arr[o] = wrap(arr[o], bx);
    arr[o + 2] = wrap(arr[o + 2], bz);
  }
}
