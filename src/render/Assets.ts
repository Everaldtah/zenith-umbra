// Asset loading: rigged hero GLBs (Draco + WebP), prop GLBs, textures. Quality tier picks the texture set.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/** a painted eye found on the model (assetgen/blender/eyes.py), model space: centre, facing, width / height, lid + lash sRGB */
export interface EyeInfo { p: number[]; n: number[]; w: number; h: number; skin: number[]; lash: number[] }
export interface ModelInfo { height: number; tris: number; bones: string[]; source?: string; colliders?: Record<string, number>; eyes?: EyeInfo[] }
export interface Manifest { models: Record<string, ModelInfo>; props: Record<string, { height: number }>; textures: string[]; }

const draco = new DRACOLoader();
draco.setDecoderPath(`${(import.meta as any).env?.BASE_URL ?? '/'}draco/`);
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
const texLoader = new THREE.TextureLoader();

let manifest: Manifest | null = null;
const cache = new Map<string, Promise<GLTF | null>>();
const texCache = new Map<string, THREE.Texture>();

export const BASE = (import.meta as any).env?.BASE_URL ?? '/';

export async function loadManifest(): Promise<Manifest> {
  if (manifest) return manifest;
  try {
    const r = await fetch(`${BASE}models/manifest.json`, { cache: 'no-cache' });
    manifest = r.ok ? await r.json() : null;
  } catch { manifest = null; }
  manifest ??= { models: {}, props: {}, textures: [] };
  return manifest;
}

export function hasModel(id: string) { return !!manifest?.models[id]; }
export function modelInfo(id: string): ModelInfo | undefined { return manifest?.models[id]; }
export function hasProp(id: string) { return !!manifest?.props[id]; }

function load(url: string): Promise<GLTF | null> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).catch(e => { console.warn('model load failed', url, e); return null; });
    cache.set(url, p);
  }
  return p;
}

/** a fresh, independently animatable copy of a hero model (skinned meshes rebound), or null */
export async function heroModel(id: string): Promise<THREE.Object3D | null> {
  await loadManifest();
  if (!hasModel(id)) return null;
  const g = await load(`${BASE}models/${id}.glb`);
  if (!g) return null;
  const c = SkeletonUtils.clone(g.scene);
  c.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; }
  });
  return c;
}

/** a rebound copy of a rigged effect model in public/models that has no manifest entry (the Koryu spirit dragons) */
export async function riggedModel(id: string): Promise<THREE.Object3D | null> {
  const g = await load(`${BASE}models/${id}.glb`);
  return g ? SkeletonUtils.clone(g.scene) : null;
}

export async function propModel(id: string): Promise<THREE.Object3D | null> {
  await loadManifest();
  if (!hasProp(id)) return null;
  const g = await load(`${BASE}models/${id}.glb`);
  if (!g) return null;
  const c = g.scene.clone(true);
  c.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return c;
}

export function texture(path: string, repeat = true, srgb = true): THREE.Texture {
  let t = texCache.get(path);
  if (!t) {
    t = texLoader.load(`${BASE}${path}`, undefined, undefined, () => { /* missing texture: material keeps its colour */ });
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 8;
    texCache.set(path, t);
  }
  return t;
}

/** a texture the asset manifest lists (call after loadManifest) */
export function hasTexture(path: string): boolean { return !!manifest?.textures.includes(path); }

export async function exists(path: string): Promise<boolean> {
  await loadManifest();
  return !!manifest?.textures.includes(path);
}
