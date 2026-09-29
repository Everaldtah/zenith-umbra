// Hand-held weapons for the heroes whose Tripo models come with empty hands: Raijin's katana, Yuzu's and Seiran's bows,
// Hayate's nodachi (drawn from his back for Mirror Water, Current Dash, quick melee and Dragon Gate - sheathed otherwise,
// the way a cyborg-ninja keeps the blade for the moments that matter). Each is built procedurally first and upgraded in
// place to the Tripo prop (public/models/prop_<hero>_*.glb) when the manifest has it.
//
// Frame: the animator lays anim.guns along the forearms (origin in the fist, +Z along the forearm / toward the aim in
// first person, +Y up across it). A blade leaves the fist along +Z pitched up; a bow stands across it on Y, grip in the fist.
import * as THREE from 'three';
import { hasProp, loadManifest, propModel } from './Assets';
import { fitProp } from './TomoeProps';

type Kind = 'blade' | 'bow';
interface Item { id: string; kind: Kind; size: number; color: string; glow: string; pitch?: number }
export interface HeldSpec { L?: Item; R?: Item }

export const HELD: Record<string, HeldSpec> = {
  raijin: { R: { id: 'prop_raijin_katana', kind: 'blade', size: 0.56, color: '#cfd6e2', glow: '#7fc8ff', pitch: -0.55 } },
  hayate: { R: { id: 'prop_hayate_nodachi', kind: 'blade', size: 0.62, color: '#e8efe9', glow: '#4fe3c1', pitch: -0.5 } },
  yuzu: { L: { id: 'prop_yuzu_bow', kind: 'bow', size: 0.72, color: '#f2c14e', glow: '#ffd76a' } },
  seiran: { L: { id: 'prop_seiran_bow', kind: 'bow', size: 0.86, color: '#1d2433', glow: '#6fa8ff' } },
};

export interface HeldProp { group: THREE.Group; kind: Kind }

/** Hayate's koi-scale shuriken: in his throwing hand whenever the nodachi is on his back (group.userData.swap) */
function buildShuriken(L: number): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape(), r = 0.045 * L, ri = 0.012 * L;
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + Math.PI / 8, rr = k % 2 ? ri : r;
    if (k) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.holes.push(new THREE.Path().absarc(0, 0, ri * 0.45, 0, Math.PI * 2, true));
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.003 * L, bevelEnabled: true, bevelThickness: 0.001 * L, bevelSize: 0.0015 * L, bevelSegments: 1 });
  geo.translate(0, 0, -0.0015 * L);
  const steel = new THREE.MeshStandardMaterial({ color: '#dfe7e3', metalness: 0.85, roughness: 0.25, emissive: new THREE.Color('#4fe3c1'), emissiveIntensity: 0.25 });
  const m = new THREE.Mesh(geo, steel); m.castShadow = true;
  // held edge-on between the fingers, the flat facing across the forearm (YZ plane), just past the fist
  m.rotation.y = Math.PI / 2; m.position.set(0, 0.012 * L, 0.035 * L);
  g.add(m);
  return g;
}

const put = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o;
};

function buildBlade(L: number, it: Item, body: THREE.Group) {
  const len = it.size * L, steel = new THREE.MeshStandardMaterial({ color: it.color, metalness: 0.9, roughness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1b2233', metalness: 0.3, roughness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.85, roughness: 0.3 });
  const edge = new THREE.MeshStandardMaterial({ color: it.glow, emissive: new THREE.Color(it.glow), emissiveIntensity: 1.6, roughness: 0.3 });
  const grip = len * 0.24, blade = len - grip;
  put(body, new THREE.CylinderGeometry(0.011 * L, 0.012 * L, grip, 8).rotateX(Math.PI / 2), dark, 0, 0, grip * 0.2);      // tsuka
  put(body, new THREE.CylinderGeometry(0.03 * L, 0.03 * L, 0.006 * L, 12).rotateX(Math.PI / 2), gold, 0, 0, grip * 0.7);   // tsuba
  // a gently curved single-edged blade: a thin tapered box bent along its length (edge up, +Y)
  const geo = new THREE.BoxGeometry(0.004 * L, 0.02 * L, blade, 1, 1, 16);
  const pa = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    const z = pa.getZ(i) / blade + 0.5, taper = 1 - 0.55 * z * z;
    pa.setY(i, pa.getY(i) * taper + 0.05 * blade * z * z);
    if (z > 0.97) pa.setY(i, pa.getY(i) * 0.3);
  }
  geo.computeVertexNormals();
  put(body, geo, steel, 0, 0, grip * 0.7 + blade / 2);
  const e = put(body, new THREE.BoxGeometry(0.0045 * L, 0.003 * L, blade * 0.92), edge, 0, 0.011 * L, grip * 0.7 + blade * 0.47);
  e.rotation.x = -0.05;
}

function buildBow(L: number, it: Item, body: THREE.Group) {
  const len = it.size * L, wood = new THREE.MeshStandardMaterial({ color: it.color, metalness: 0.55, roughness: 0.35 });
  const glow = new THREE.MeshStandardMaterial({ color: it.glow, emissive: new THREE.Color(it.glow), emissiveIntensity: 1.8, roughness: 0.3 });
  const grip = new THREE.MeshStandardMaterial({ color: '#2a2220', roughness: 0.7 });
  // recurve limbs: an arc through the fist bowing forward (+Z), tips flicking back; the string straight behind on -Z
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const s = i / 24 * 2 - 1, y = s * len / 2;
    pts.push(new THREE.Vector3(0, y, 0.09 * len * (1 - s * s) - 0.05 * len * Math.pow(Math.abs(s), 6)));
  }
  put(body, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.009 * L, 6), wood);
  put(body, new THREE.CylinderGeometry(0.014 * L, 0.014 * L, 0.09 * L, 8), grip, 0, 0, 0.09 * len);
  const tipZ = pts[0].z;
  const s = put(body, new THREE.CylinderGeometry(0.0015 * L, 0.0015 * L, len * 0.985, 4), glow, 0, 0, tipZ);
  s.userData.string = true;
  body.position.z = -0.09 * len;                                   // the grip (the arc's apex) sits in the fist
}

export function buildHeld(modelHeight: number, it: Item): HeldProp {
  const g = new THREE.Group(), body = new THREE.Group(), L = modelHeight;
  g.add(body);
  g.userData.body = body;
  if (it.id === 'prop_hayate_nodachi') { const sh = buildShuriken(L); g.add(sh); g.userData.swap = sh; }
  if (it.kind === 'blade') { buildBlade(L, it, body); body.rotation.x = it.pitch ?? -0.5; }
  else buildBow(L, it, body);
  void (async () => {
    await loadManifest();
    if (!hasProp(it.id)) return;
    const m = await propModel(it.id);
    if (!m) return;
    const len = it.size * L;
    // fitProp lays the long axis on +Z (the thin grip end back) and centres it; a blade then slides forward so the
    // grip sits in the fist, a bow is stood up across the forearm (long axis on Y) with its middle in the fist
    const fitted = fitProp(m, 'blade', len);
    const wrap = new THREE.Group(); wrap.add(fitted);
    if (it.kind === 'blade') fitted.position.z += len * 0.38;
    else wrap.rotation.x = -Math.PI / 2;
    body.clear(); body.position.set(0, 0, 0);
    body.add(wrap);
  })();
  return { group: g, kind: it.kind };
}

/** Hayate keeps the nodachi sheathed on his back except while he deflects, dashes, cuts or runs the Dragon Gate */
export function heldVisible(heroId: string, side: 0 | 1, a: { has(s: string, t: number): boolean; anim: { castId?: string; castAt: number; attackAt: number; attackKind?: string } }, t: number) {
  if (heroId !== 'hayate' || side !== 1) return true;
  const cast = t - a.anim.castAt, atk = t - a.anim.attackAt;
  return a.has('dragonblade', t) || a.has('parry', t) || a.has('phased', t) && a.anim.castId === 'dragongate'
    || a.anim.castId === 'currentdash' && cast < 0.45 || a.anim.castId === 'dragongate' && cast < 1.4
    || (a.anim.attackKind === 'punch' || a.anim.attackKind === 'secondary' && a.has('phased', t)) && atk < 0.5;
}
