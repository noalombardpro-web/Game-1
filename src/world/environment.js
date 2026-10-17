// Sky, sun and moon, day/night cycle, fog and clouds.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp } from '../core/math.js';
import { createRng } from '../core/rng.js';

export const DAY_LENGTH_SECONDS = 1200;
const SKY_RADIUS = 2600;

function fogColorFor(sunElevation) {
  const day = new THREE.Color('#b8cfe0');
  const dusk = new THREE.Color('#e7a27b');
  const night = new THREE.Color('#0b1224');
  if (sunElevation >= 0.25) return day;
  if (sunElevation >= 0) return dusk.clone().lerp(day, sunElevation / 0.25);
  return night.clone().lerp(dusk, clamp(1 + sunElevation * 4, 0, 1) * 0.6);
}

export class Environment {
  /**
   * @param scene    three.js scene
   * @param renderer WebGLRenderer (for shadow settings)
   * @param quality  { shadowMap, viewRadius }
   */
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.timeOfDay = 0.32;
    this.flash = 0;
    this.cloudCover = 0.2;

    this.sky = new Sky();
    this.sky.scale.setScalar(SKY_RADIUS);
    scene.add(this.sky);
    this.skyUniforms = this.sky.material.uniforms;

    this.sun = new THREE.DirectionalLight('#fff3dd', 3);
    this.sun.castShadow = quality.shadowMap > 0;
    this.sun.shadow.mapSize.set(quality.shadowMap || 512, quality.shadowMap || 512);
    const s = this.sun.shadow.camera;
    s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 1; s.far = 500;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight('#9bb8ff', 0);
    scene.add(this.moon);
    scene.add(this.moon.target);

    this.hemi = new THREE.HemisphereLight('#cfe3ff', '#4a3f2e', 0.6);
    scene.add(this.hemi);

    this.stars = this.createStars();
    scene.add(this.stars);

    this.clouds = this.createClouds();
    scene.add(this.clouds);

    scene.fog = new THREE.FogExp2('#b8cfe0', 0.0008);
    this.sunDirection = new THREE.Vector3();
    this.setTime(this.timeOfDay);
  }

  createStars() {
    const count = 1500;
    const rng = createRng(777);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      positions.set([r * Math.cos(phi) * SKY_RADIUS * 0.95, Math.abs(u) * SKY_RADIUS * 0.95, r * Math.sin(phi) * SKY_RADIUS * 0.95], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: '#dfe8ff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  createClouds() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const group = new THREE.Group();
    const rng = createRng(31337);
    this.cloudSprites = [];
    for (let i = 0; i < 40; i++) {
      const material = new THREE.SpriteMaterial({ map: texture, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      const angle = rng() * Math.PI * 2;
      const radius = 80 + rng() * 800;
      sprite.position.set(Math.cos(angle) * radius, 170 + rng() * 60, Math.sin(angle) * radius);
      const size = 120 + rng() * 160;
      sprite.scale.set(size, size * 0.35, 1);
      group.add(sprite);
      this.cloudSprites.push({ sprite, base: rng() * 0.6 + 0.4, angle, radius });
    }
    return group;
  }

  /** Sets the time of day: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  setTime(t) {
    this.timeOfDay = ((t % 1) + 1) % 1;
    const sinElev = Math.sin((this.timeOfDay - 0.25) * Math.PI * 2);
    const cosElev = Math.sqrt(Math.max(0, 1 - sinElev * sinElev));
    const azimuth = this.timeOfDay * Math.PI * 2;
    this.sunElevation = sinElev;
    this.sunDirection.set(cosElev * Math.cos(azimuth), sinElev, cosElev * Math.sin(azimuth));
    this.skyUniforms.sunPosition.value.copy(this.sunDirection);
  }

  /** The daylight level in 0..1 used by fauna (activity and sleep). */
  get daylight() {
    return clamp(this.sunElevation * 2.5 + 0.35, 0, 1);
  }

  /**
   * @param dt       seconds
   * @param focus    camera or player position
   * @param weather  Weather instance
   * @param advance  when true, time of day moves forward
   */
  update(dt, focus, weather, advance = true) {
    if (advance) this.setTime(this.timeOfDay + dt / DAY_LENGTH_SECONDS);
    const e = this.sunElevation;
    const cover = weather.current.cloud;
    this.cloudCover = cover;
    const dayness = clamp(e * 3 + 0.2, 0, 1);

    // Sky turbidity grows with weather and dust.
    this.skyUniforms.turbidity.value = lerp(2, 9, cover * 0.6 + weather.current.sand * 0.4);
    this.skyUniforms.rayleigh.value = lerp(0.6, 2.2, dayness) * (1 - cover * 0.4);
    this.skyUniforms.mieCoefficient.value = 0.004 + cover * 0.02 + weather.current.sand * 0.05;

    const sunColor = new THREE.Color('#ffb276').lerp(new THREE.Color('#fff3dd'), clamp(e * 4, 0, 1));
    const flash = this.flash;
    this.sun.color.copy(sunColor);
    this.sun.intensity = (clamp(e * 3, 0, 1) * 3.2 * (1 - cover * 0.55)) + flash * 4;
    this.sun.position.copy(focus).addScaledVector(this.sunDirection, 220);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();

    const moonAmount = clamp(-e * 2.5, 0, 1) * (1 - cover * 0.6);
    this.moon.intensity = moonAmount * 0.35;
    this.moon.position.copy(focus).add(new THREE.Vector3(-this.sunDirection.x, Math.abs(this.sunDirection.y) + 0.2, -this.sunDirection.z).normalize().multiplyScalar(220));
    this.moon.target.position.copy(focus);
    this.moon.target.updateMatrixWorld();

    this.hemi.intensity = lerp(0.18, 0.75, dayness) * (1 - cover * 0.25) + flash * 1.5;
    this.hemi.color.copy(new THREE.Color('#9fbfe6').lerp(new THREE.Color('#dbe9ff'), dayness));

    const starsOpacity = clamp(-e * 3, 0, 1) * (1 - cover);
    this.stars.material.opacity = starsOpacity;
    this.stars.position.copy(focus);

    const fog = this.scene.fog;
    const storm = weather.current.storm;
    const weatherColor = new THREE.Color(weather.fogColor);
    const base = fogColorFor(e);
    fog.color.copy(base).lerp(weatherColor, clamp(cover * 0.5 + weather.current.sand * 0.6 + weather.current.fog * 60, 0, 0.95));
    fog.density = weather.current.fog * (storm ? 1.1 : 1);
    this.renderer.setClearColor(fog.color, 1);

    this.sky.position.copy(focus);
    this.clouds.position.set(focus.x, 0, focus.z);
    for (const cloud of this.cloudSprites) {
      cloud.angle += dt * 0.002 * (0.5 + weather.windStrength * 0.4);
      cloud.sprite.material.opacity = clamp((cover - 0.2 + cloud.base * 0.3) * 0.9, 0, 0.85) * (0.6 + dayness * 0.4);
      cloud.sprite.position.x = Math.cos(cloud.angle) * cloud.radius;
      cloud.sprite.position.z = Math.sin(cloud.angle) * cloud.radius;
    }
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  /** Triggers a lightning flash (brightens the scene for a fraction of a second). */
  lightningFlash() {
    this.flash = 1;
  }

  /** Sets the shadow map resolution (0 disables shadows). */
  setShadowMap(size) {
    this.sun.castShadow = size > 0;
    if (size > 0) this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }
}
