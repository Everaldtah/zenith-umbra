// Map surfaces (desktop edition): CC0 PBR sets from Poly Haven (assetgen/fetch_cc0.py -> public/env/pbr) on the
// blockout materials, and the look Overwatch's environments get from their texture work, done in the shader:
//  - relief: the set's normal map + AO / roughness / metalness (ARM), its albedo recoloured to the map's painted palette
//    (or the painted texture kept, with the set's relief under it, where the painting is the design - facades, shoji)
//  - painted bevels: every box's top and corner edges catch the light as if rounded (the normal bends over the last few
//    centimetres and the edge is lifted a touch) - no hard 90-degree blockout corners
//  - grime: the foot of every wall standing on the ground darkens over its first metre (layered dirt, as OW's walls)
//  - cavity: the AO map darkens crevices under direct sunlight too (three applies it to ambient light only)
//  - macro variation: two octaves of world-space value noise vary the albedo over tens of metres, so the tiling of a
//    texture across a long wall or a whole plaza stops reading as a repeat
// (GLSL here uses float literals in every constructor: ANGLE's D3D11 backend - Chrome / Electron on Windows - rejects
// vec3(float, int, int) as ambiguous at draw time and the mesh silently doesn't draw)
// The box geometry carries two attributes MapScene writes: bevL (the vertex relative to its box's centre, metres) and
// bevH (the box's half extents, w = grime on/off); anything else carries a huge bevH so neither effect touches it.
import * as THREE from 'three';
import { BASE } from './Assets';

export type Slot = 'ground' | 'wall' | 'roof' | 'rock' | 'wood' | 'trim';
interface SetInfo { tile: number; metal: boolean; n: string; arm: string }
interface SlotInfo { set: string; c?: string }
export interface HdriInfo { file: string; src: string; sunPhi: number; sunElev: number; mood: number }
interface SurfaceManifest { sets: Record<string, SetInfo>; maps: Record<string, Partial<Record<Slot, SlotInfo>>>; hdri: Record<string, HdriInfo> }

const DIR = `${BASE}env/pbr/`;
/** dev only: ?classic draws the maps the old way (painted albedo, studio-room lighting, no grade) - A/B captures */
export const CLASSIC = !!(import.meta as any).env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('classic');
let manifest: SurfaceManifest | null = null;
let loading: Promise<SurfaceManifest | null> | null = null;

/** the surface manifest (null when the folder isn't shipped - the web edition, or before fetch_cc0.py has run) */
export function loadSurfaces(): Promise<SurfaceManifest | null> {
  loading ??= fetch(`${DIR}manifest.json`, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(j => (manifest = j));
  return loading;
}
export function hdriFor(mapId: string): HdriInfo | null { return CLASSIC ? null : manifest?.hdri[mapId] ?? null; }
export const surfaceDir = DIR;

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
/** world UVs repeat every 6 m (MapScene TILE); a set's own tile size is a repeat on its textures */
const UV_TILE = 6;
function tex(file: string, tile: number, srgb: boolean): THREE.Texture {
  const key = `${file}@${tile}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(DIR + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(UV_TILE / tile, UV_TILE / tile);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    cache.set(key, t);
  }
  return t;
}

/** shared by every surface material: the strengths of the shader layers */
const U = {
  zuBevel: { value: 0.06 },          // bevel radius, metres
  zuEdgeLift: { value: 0.16 },       // albedo lift on the bevel (worn / painted highlight)
  zuGrime: { value: 0.38 },          // darkening at a wall's foot
  zuCavity: { value: 0.25 },         // AO map on the albedo
  zuMacro: { value: 0.16 },          // macro variation amplitude
};

const VERT_PARS = `
attribute vec3 bevL;
attribute vec4 bevH;
varying vec3 vBevL;
varying vec4 vBevH;
varying vec3 vZuW;
varying vec3 vZuN;`;
const VERT_MAIN = `
vBevL = bevL; vBevH = bevH;
vZuW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vZuN = normalize(mat3(modelMatrix) * objectNormal);`;

const FRAG_PARS = `
uniform float zuBevel; uniform float zuEdgeLift; uniform float zuGrime; uniform float zuCavity; uniform float zuMacro; uniform float zuRoughMin;
varying vec3 vBevL;
varying vec4 vBevH;
varying vec3 vZuW;
varying vec3 vZuN;
float zuHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float zuNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(zuHash(i), zuHash(i + vec2(1.0, 0.0)), f.x), mix(zuHash(i + vec2(0.0, 1.0)), zuHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float zuEdge; vec3 zuEdgeN;
void zuBevelEval(){
  vec3 n = normalize(vZuN), an = abs(n);
  zuEdge = 0.0; zuEdgeN = n;
  if (vBevH.x > 500.0) return;
  vec3 d = vBevH.xyz - abs(vBevL);
  // the face's own axis has no edge; neither has the bottom of a side face (it meets the floor or the box below)
  if (an.x >= an.y && an.x >= an.z) d.x = 1e4; else if (an.y >= an.z) d.y = 1e4; else d.z = 1e4;
  if (an.y < 0.5 && vBevL.y < 0.0) d.y = 1e4;
  float e = min(d.x, min(d.y, d.z));
  vec3 h = vBevH.xyz; float hm = min(min(d.x < 1e3 ? h.x : 1e4, d.y < 1e3 ? h.y : 1e4), d.z < 1e3 ? h.z : 1e4);
  float r = min(zuBevel, 0.35 * hm);
  if (r <= 0.0 || e >= r) return;
  vec3 dir = d.x <= d.y && d.x <= d.z ? vec3(sign(vBevL.x), 0.0, 0.0) : d.y <= d.z ? vec3(0.0, sign(vBevL.y), 0.0) : vec3(0.0, 0.0, sign(vBevL.z));
  float t = 1.0 - e / r;
  zuEdge = t;
  // a quarter-round: the normal turns toward the neighbouring face, 45 degrees at the very edge
  zuEdgeN = normalize(n + dir * (t / max(1.0 - t * 0.5, 0.5)) * 0.9);
}`;

// at the top of main: the bevel for this fragment
const FRAG_BEGIN = `
zuBevelEval();`;
// after the albedo map: macro variation, cavity, grime, edge lift
const FRAG_ALBEDO = `
{
  float mv = zuNoise(vZuW.xz * 0.045 + vZuW.y * 0.02) * 0.65 + zuNoise(vZuW.zx * 0.19 + 7.3) * 0.35;
  diffuseColor.rgb *= 1.0 + zuMacro * (mv * 2.0 - 1.0);
  #ifdef USE_AOMAP
    diffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, zuCavity);
  #endif
  if (vBevH.w > 0.5 && vBevH.x < 500.0) {
    float up = abs(normalize(vZuN).y);
    float fromFoot = vBevL.y + vBevH.y;
    float g = (1.0 - smoothstep(0.0, 1.15, fromFoot)) * (1.0 - smoothstep(0.4, 0.7, up));
    g *= 0.75 + 0.25 * zuNoise(vZuW.xz * 1.3 + vZuW.y);
    diffuseColor.rgb *= 1.0 - g * zuGrime;
  }
  diffuseColor.rgb *= 1.0 + zuEdge * zuEdgeLift;
}`;
// after normal_fragment_begin: the bevelled geometric normal (view space) under the normal map
// (the tangent frame was built on the flat normal: re-orthogonalised on the bent one, or the normal map would undo it)
const FRAG_NORMAL = `
if (zuEdge > 0.0) {
  normal = normalize((viewMatrix * vec4(zuEdgeN, 0.0)).xyz);
  #if defined( USE_NORMALMAP_TANGENTSPACE )
    vec3 zT = tbn[0] - dot(tbn[0], normal) * normal;
    vec3 zB = tbn[1] - dot(tbn[1], normal) * normal - dot(tbn[1], normalize(zT)) * normalize(zT);
    tbn = mat3(normalize(zT) * length(tbn[0]), normalize(zB) * length(tbn[1]), normal);
  #endif
}`;

/** patch a map material with the surface layers (idempotent; one program variant per base material type). roughMin: a
 *  floor under the set's roughness - photo-scanned stone is glossier than a stylised street should be, and at grazing
 *  angles it mirrored a blue-hour sky as a violet sheen */
export function surfaceShader(m: THREE.MeshStandardMaterial, roughMin = 0) {
  m.userData.zuRoughMin = { value: roughMin };
  if (m.userData.zuSurface) return;
  m.userData.zuSurface = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, { zuRoughMin: m.userData.zuRoughMin });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_BEGIN}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_ALBEDO}`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${FRAG_NORMAL}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, zuRoughMin);');
  };
  m.customProgramCacheKey = () => 'zu-surface-1';
  m.needsUpdate = true;
}

/** the bevel / grime attributes of a box (MapScene, before merging); `grime` only for boxes standing on the ground */
export function boxAttrs(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, grime: boolean) {
  const p = g.attributes.position, n = p.count;
  const L = new Float32Array(n * 3), H = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    L[i * 3] = p.getX(i) - cx; L[i * 3 + 1] = p.getY(i) - cy; L[i * 3 + 2] = p.getZ(i) - cz;
    H[i * 4] = hx; H[i * 4 + 1] = hy; H[i * 4 + 2] = hz; H[i * 4 + 3] = grime ? 1 : 0;
  }
  g.setAttribute('bevL', new THREE.BufferAttribute(L, 3));
  g.setAttribute('bevH', new THREE.BufferAttribute(H, 4));
}
/** geometry with no box behind it (ramps, floors, cliff skirts): no bevel, no grime */
export function noBoxAttrs(g: THREE.BufferGeometry) {
  const n = g.attributes.position.count;
  const H = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { H[i * 4] = 1e4; H[i * 4 + 1] = 1e4; H[i * 4 + 2] = 1e4; }
  g.setAttribute('bevL', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('bevH', new THREE.BufferAttribute(H, 4));
}

/** roughness floors by slot (glazed roof tiles may shine; streets and walls stay matte enough to read their colour) */
const ROUGH_MIN: Partial<Record<Slot, number>> = { ground: 0.72, wall: 0.6, rock: 0.75, wood: 0.55, trim: 0.45, roof: 0.4 };

/**
 * Upgrade a map's materials in place with its surface sets. Slots with a recoloured photo albedo take it (colour to
 * white - the palette is baked in - except the ground, whose shade MapScene sets); painted slots keep their texture
 * and take the set's relief at half strength. Returns false when the map has no surfaces (nothing changed).
 */
export function applySurfaces(mapId: string, mats: Partial<Record<Slot | string, THREE.Material>>): boolean {
  const map = manifest?.maps[mapId];
  if (!manifest || !map || CLASSIC) return false;
  for (const [slot, info] of Object.entries(map) as [Slot, SlotInfo][]) {
    const m = mats[slot] as THREE.MeshStandardMaterial | undefined, set = manifest.sets[info.set];
    if (!m || !set) continue;
    const painted = !info.c;
    if (!painted) {
      m.map = tex(info.c!, set.tile, true);
      if (slot !== 'ground') m.color.set('#ffffff');
    }
    m.normalMap = tex(set.n, set.tile, false);
    m.normalScale.setScalar(painted ? 0.45 : 1);
    const arm = tex(set.arm, set.tile, false);
    m.aoMap = arm; m.aoMapIntensity = painted ? 0.5 : 0.8;
    m.roughnessMap = arm;
    // ARM green is the roughness; a painted slot keeps some of its own sheen
    m.roughness = painted ? Math.min(1, m.roughness + 0.2) : 1;
    if (set.metal && !painted) { m.metalnessMap = arm; m.metalness = 1; } else if (!set.metal) m.metalness = Math.min(m.metalness, 0.05);
    surfaceShader(m, set.metal && !painted ? 0.3 : ROUGH_MIN[slot] ?? 0.5);
  }
  return true;
}
