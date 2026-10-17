// Procedural visuals for the space layer: planets with atmospheres, station, asteroid field,
// wreck, alien structure, star field. Textures are painted on a canvas when one is available
// (browser); in other environments flat colours are used.
import * as THREE from 'three';
import { createNoise2D, createFbm } from '../core/noise.js';
import { createRng } from '../core/rng.js';
import { clamp, smoothstep } from '../core/math.js';

function paintTexture(kind, seed, w = 512, h = 256) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const noise = createFbm(createNoise2D(seed), 5);
  const clouds = createFbm(createNoise2D(seed ^ 0x77), 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const lat = (y / h - 0.5) * Math.PI;
      const nx = Math.cos(lat) * Math.cos(lon) * 2.2;
      const ny = Math.sin(lat) * 2.2;
      const nz = Math.cos(lat) * Math.sin(lon) * 2.2;
      const v = noise(nx + nz * 0.7, ny + nz * 0.3);
      let r;
      let g;
      let b;
      if (kind === 'genesis') {
        const land = v > 0.02;
        const polar = smoothstep(0.7, 0.92, Math.abs(Math.sin(lat)));
        if (land) { r = 70 + v * 90; g = 110 + v * 70; b = 60; if (v > 0.35) { r = 130; g = 120; b = 105; } } else { r = 24; g = 70 + v * 60; b = 130 + v * 80; }
        r += (240 - r) * polar; g += (245 - g) * polar; b += (250 - b) * polar;
        const c = clamp(clouds(nx * 1.4 + 3, ny * 1.4 - 2) * 1.8, 0, 1);
        r += (255 - r) * c * 0.7; g += (255 - g) * c * 0.7; b += (255 - b) * c * 0.7;
      } else if (kind === 'cryos') {
        const crack = Math.abs(noise(nx * 2.4, ny * 2.4 + nz)) < 0.03 ? 1 : 0;
        r = 200 + v * 40; g = 225 + v * 25; b = 245;
        if (crack) { r = 90; g = 150; b = 200; }
        const band = Math.sin(lat * 6 + v * 4) * 0.5 + 0.5;
        r -= band * 18; g -= band * 8;
      } else {
        const crater = Math.abs(noise(nx * 3, ny * 3 + nz * 2)) < 0.05 ? 0.6 : 1;
        r = g = b = (130 + v * 70) * crater;
      }
      const i = (y * w + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPlanet(kind, radius, seed) {
  const group = new THREE.Group();
  const map = paintTexture(kind, seed);
  const color = { genesis: '#4d86c4', cryos: '#cfe6f5', moon: '#9a9a9a' }[kind];
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 40),
    new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : color, roughness: kind === 'cryos' ? 0.35 : 0.9, metalness: 0 })
  );
  body.userData.spin = true;
  group.add(body);
  if (kind !== 'moon') {
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.06, 48, 32),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { glow: { value: new THREE.Color(kind === 'genesis' ? '#5aa8ff' : '#bfefff') } },
        vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vN; uniform vec3 glow; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(glow, 1.0) * clamp(i, 0.0, 1.0); }'
      })
    );
    group.add(glow);
  }
  return group;
}

export function createStation() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: '#cfd5db', metalness: 0.6, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b3038', metalness: 0.4, roughness: 0.6 });
  const glow = new THREE.MeshStandardMaterial({ color: '#7fe9ff', emissive: '#2fd8ff', emissiveIntensity: 2.4 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(110, 12, 12, 48), hull);
  ring.userData.spin = true;
  g.add(ring);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 220, 14), hull));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(4, 100, 4), dark);
    spoke.position.set(Math.cos(a) * 55, 0, Math.sin(a) * 55);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = -a;
    g.add(spoke);
  }
  // Docking bay: a lit gantry at the end of the central spine.
  const bay = new THREE.Mesh(new THREE.TorusGeometry(26, 3, 8, 24), glow);
  bay.position.set(0, 124, 0);
  bay.rotation.x = Math.PI / 2;
  g.add(bay);
  for (const x of [-70, 70]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(80, 2, 36), new THREE.MeshStandardMaterial({ color: '#1b3557', metalness: 0.7, roughness: 0.3 }));
    panel.position.set(x * 1.9, 0, 0);
    g.add(panel);
  }
  return g;
}

export function createAsteroidField(count, spread, seed) {
  const rng = createRng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const f = 0.75 + rng() * 0.5;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#8a8178', roughness: 0.95, flatShading: true }), count);
  const rocks = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const r = spread * Math.cbrt(rng());
    const s = Math.sqrt(1 - u * u);
    const radius = 5 + Math.pow(rng(), 2.2) * 55;
    const rock = { x: Math.cos(phi) * s * r, y: u * r * 0.45, z: Math.sin(phi) * s * r, radius, hp: radius * 3, alive: true, item: rng() < 0.08 ? 'rare_crystal' : rng() < 0.45 ? 'mineral_silicate' : 'ore_metal', spin: (rng() - 0.5) * 0.2 };
    rocks.push(rock);
    dummy.position.set(rock.x, rock.y, rock.z);
    dummy.scale.set(radius, radius * (0.7 + rng() * 0.4), radius);
    dummy.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return { mesh, rocks };
}

export function createWreck() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: '#4a525c', metalness: 0.7, roughness: 0.5 });
  const burnt = new THREE.MeshStandardMaterial({ color: '#2a2320', metalness: 0.4, roughness: 0.9 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 90), hull);
  a.rotation.set(0.2, 0.4, 0.5);
  g.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(18, 10, 50), burnt);
  b.position.set(18, -8, 60);
  b.rotation.set(-0.3, 0.2, 1.0);
  g.add(b);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(70, 1.5, 22), hull);
  wing.position.set(-36, 2, -10);
  wing.rotation.set(0.3, 0.1, 0.4);
  g.add(wing);
  const light = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff5d5d', emissive: '#ff3030', emissiveIntensity: 2 }));
  light.position.set(0, 9, 30);
  light.userData.blink = true;
  g.add(light);
  return g;
}

export function createAnomaly() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: '#2b2438', metalness: 0.5, roughness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: '#c060ff', emissive: '#b66bff', emissiveIntensity: 2.4 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(110, 7, 10, 48), stone);
  g.add(ring);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(70, 3, 8, 40), glow);
  inner.userData.spin = true;
  g.add(inner);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(24, 0), glow);
  core.userData.spin = true;
  g.add(core);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(5, 60, 5), stone);
    spike.position.set(Math.cos(a) * 112, Math.sin(a) * 112, 0);
    spike.rotation.z = a - Math.PI / 2;
    g.add(spike);
  }
  return g;
}

export function createStarfield(seed) {
  const rng = createRng(seed);
  const n = 3500;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const R = 400000;
    positions.set([Math.cos(phi) * s * R, u * R, Math.sin(phi) * s * R], i * 3);
    const t = rng();
    colors.set([0.7 + 0.3 * t, 0.75 + 0.2 * rng(), 1 - 0.3 * t], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false }));
  stars.frustumCulled = false;
  // Nebula: a few large additive sprites.
  const group = new THREE.Group();
  group.add(stars);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    const colorsNeb = ['#6a3fd0', '#2f7fd8', '#d03f9a', '#2fd0b0'];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: colorsNeb[i % 4], transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const sprite = new THREE.Sprite(mat);
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      sprite.position.set(Math.cos(phi) * s * 300000, u * 300000, Math.sin(phi) * s * 300000);
      sprite.scale.setScalar(160000 + rng() * 120000);
      group.add(sprite);
    }
  }
  return group;
}
