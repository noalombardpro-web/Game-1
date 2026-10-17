// Shared materials and the wind uniform block used by vegetation shaders.
import * as THREE from 'three';

/** Uniforms shared by every wind-animated material. Updated once per frame. */
export function createWindUniforms() {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(1, 0) },
    uStrength: { value: 0.4 }
  };
}

/** Procedural 256px detail texture (multi-scale blotches) used to break up terrain colour. */
export function createDetailTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Neutral white base: the texture multiplies the vertex colour, so it must average ~1.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [count, radius, alpha] of [[260, 40, 0.10], [700, 14, 0.10], [2200, 4, 0.08]]) {
    for (let i = 0; i < count; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const v = rnd() > 0.5 ? 255 : 200;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(${v},${v},${v},${alpha})`);
      grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = grad;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          ctx.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
        }
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createTerrainMaterial(detailTexture) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detailTexture,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide
  });
}
