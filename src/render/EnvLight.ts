// Image-based lighting per map (desktop edition): a CC0 Poly Haven HDRI matched to the map's time of day and place
// (assetgen/fetch_cc0.py: clamped so the sun - the map's DirectionalLight - isn't counted twice, normalised to a mean
// luminance of 1), prefiltered with PMREM and turned so its bright side lies where the map's sun is. Heroes, props and
// the PBR surfaces all reflect the map's own sky and ground instead of a generic studio room.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { hdriFor, loadSurfaces, surfaceDir } from './Surfaces';

export interface MapEnv { texture: THREE.Texture; rotY: number; mood: number }

const cache = new Map<string, Promise<THREE.Texture | null>>();

/** the map's prefiltered environment and its turn (null: no HDRI shipped for it - keep the studio room) */
export async function mapEnvironment(renderer: THREE.WebGLRenderer, mapId: string, sunDir: [number, number, number]): Promise<MapEnv | null> {
  await loadSurfaces();
  const info = hdriFor(mapId);
  if (!info) return null;
  let p = cache.get(info.file);
  if (!p) {
    p = new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(surfaceDir + info.file).then(hdr => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(hdr);
      hdr.dispose(); pm.dispose();
      return rt.texture;
    }).catch(e => { console.warn('environment load failed', info.file, e); return null; });
    cache.set(info.file, p);
  }
  const texture = await p;
  if (!texture) return null;
  // the lookup direction is rotated by -rotY about +Y (three inverts environmentRotation): bring the map's sun bearing
  // onto the HDRI's (equirect column u -> atan2(z, x) = (u - 0.5) * 2pi)
  const sunPhi = Math.atan2(sunDir[2], sunDir[0]);
  return { texture, rotY: info.sunPhi - sunPhi, mood: info.mood };
}
