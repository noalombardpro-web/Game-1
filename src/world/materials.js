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

/** Loads a tiling colour texture from public/assets/textures. */
export function loadTexture(name, { srgb = true, repeat = true } = {}) {
  const texture = new THREE.TextureLoader().load(`${import.meta.env?.BASE_URL ?? '/'}assets/textures/${name}`);
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Mean colour (sRGB) of each terrain layer, measured from the image files: the shader divides by it
// so that the biome palette (vertex colour) keeps driving the average hue while the photo adds detail.
const LAYERS = [
  ['grass', 'grass.jpg', [0.324, 0.467, 0.107]],
  ['dirt', 'dirt.jpg', [0.575, 0.448, 0.269]],
  ['sand', 'sand.jpg', [0.737, 0.602, 0.4]],
  ['snow', 'snow.jpg', [0.854, 0.864, 0.877]],
  ['dry', 'dry.jpg', [0.826, 0.711, 0.472]],
  ['lava', 'lava.jpg', [0.612, 0.274, 0.02]],
  ['rock', 'rock.jpg', [0.65, 0.599, 0.518]]
];

/**
 * Terrain material: seven photographic layers (grass, dirt, sand, snow, dry earth, lava, rock) blended
 * per vertex by the `surfA`/`surfB` weights from the chunk generator, sampled at two scales to hide
 * tiling, tinted toward the biome colour, with emissive lava.
 */
export function createTerrainMaterial(detailTexture) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const uniforms = {
    uDetail: { value: detailTexture },
    uTint: { value: 0.55 },
    uMean: { value: LAYERS.map(([, , m]) => new THREE.Color().setRGB(m[0], m[1], m[2], THREE.SRGBColorSpace)) }
  };
  for (const [id, file] of LAYERS) uniforms[`uT_${id}`] = { value: loadTexture(file) };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 surfA;\nattribute vec4 surfB;\nvarying vec4 vSurfA;\nvarying vec4 vSurfB;\nvarying vec3 vTerrainPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfA = surfA;\nvSurfB = surfB;\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const samplers = LAYERS.map(([id]) => `uniform sampler2D uT_${id};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vSurfA;
varying vec4 vSurfB;
varying vec3 vTerrainPos;
uniform sampler2D uDetail;
uniform float uTint;
uniform vec3 uMean[7];
${samplers}
vec2 gTuv1;
vec2 gTuv2;
vec3 terrainLayer(sampler2D s) {
#ifdef TERRAIN_TWO_SCALE
  return mix(texture2D(s, gTuv1).rgb, texture2D(s, gTuv2).rgb, 0.35);
#else
  return texture2D(s, gTuv1).rgb;
#endif
}`)
      .replace('#include <map_fragment>', `
gTuv1 = vTerrainPos.xz / 5.0;
gTuv2 = mat2(0.8, -0.6, 0.6, 0.8) * vTerrainPos.xz / 17.0;
float wGrass = vSurfA.x, wDirt = vSurfA.y, wSand = vSurfA.z, wSnow = vSurfA.w;
float wDry = vSurfB.x, wLava = vSurfB.y, wRock = vSurfB.z;
vec3 texMix = vec3(0.0);
vec3 meanMix = vec3(0.0);
if (wGrass > 0.01) { texMix += wGrass * terrainLayer(uT_grass); meanMix += wGrass * uMean[0]; }
if (wDirt > 0.01) { texMix += wDirt * terrainLayer(uT_dirt); meanMix += wDirt * uMean[1]; }
if (wSand > 0.01) { texMix += wSand * terrainLayer(uT_sand); meanMix += wSand * uMean[2]; }
if (wSnow > 0.01) { texMix += wSnow * terrainLayer(uT_snow); meanMix += wSnow * uMean[3]; }
if (wDry > 0.01) { texMix += wDry * terrainLayer(uT_dry); meanMix += wDry * uMean[4]; }
vec3 lavaCol = vec3(0.0);
if (wLava > 0.01) { lavaCol = terrainLayer(uT_lava); texMix += wLava * lavaCol; meanMix += wLava * uMean[5]; }
if (wRock > 0.01) { texMix += wRock * terrainLayer(uT_rock); meanMix += wRock * uMean[6]; }
float wSum = max(0.001, wGrass + wDirt + wSand + wSnow + wDry + wLava + wRock);
texMix /= wSum;
meanMix /= wSum;
vec3 tint = clamp(vColor.rgb / max(meanMix, vec3(0.02)), 0.25, 2.5);
float macro = mix(0.82, 1.08, texture2D(uDetail, vTerrainPos.xz / 160.0).r);
diffuseColor.rgb *= texMix * mix(vec3(1.0), tint, uTint) * macro;
`)
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wLava * lavaCol * 2.5;');
  };
  material.customProgramCacheKey = () => `terrain-layers-v1-${material.defines?.TERRAIN_TWO_SCALE ? 2 : 1}`;
  setTerrainQuality(material, 'medium');
  return material;
}

/** Low quality samples each layer once; medium and high blend two scales to hide tiling. */
export function setTerrainQuality(material, quality) {
  const two = quality !== 'low';
  if (!!material.defines?.TERRAIN_TWO_SCALE === two) return;
  material.defines = { ...(material.defines ?? {}) };
  if (two) material.defines.TERRAIN_TWO_SCALE = 1;
  else delete material.defines.TERRAIN_TWO_SCALE;
  material.needsUpdate = true;
}
