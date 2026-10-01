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

type Kind = 'blade' | 'bow' | 'arrow' | 'card';
/** alt: an older published prop to fall back on while the manifest lacks `id` */
/** flip: the fit's bulk heuristic put the grip forward (a broad hooked cleaver with a thin ring pommel) - turn it round */
interface Item { id: string; kind: Kind; size: number; color: string; glow: string; pitch?: number; alt?: string; flip?: boolean }
/** chains: a blade on a chain in each fist (Enra) - the animator whips the swinging arm through its arc and flings the
 *  blade out on its chain (gunOrbit / chainExt), the throw arm shoots it straight out; CharacterView pays the chain out
 *  from each bracer to its pommel, joins the two over his shoulders, burns the blades (ChainBlades). bracer: a Tripo
 *  vambrace prop worn on each forearm where the chain is made fast */
export interface HeldSpec { L?: Item; R?: Item; chains?: boolean; bracer?: string }

export const HELD: Record<string, HeldSpec> = {
  raijin: { R: { id: 'prop_raijin_katana', kind: 'blade', size: 0.56, color: '#cfd6e2', glow: '#7fc8ff', pitch: -0.55 } },
  // Enra's Hellfire Chains (docs/research/kratos_blades_study.md): Kratos' Blades of Chaos with oni flair - a broad
  // forward-curved hooked cleaver in EACH fist, 0.75 m on a 2.05 m oni, its pommel a ring the chain runs from
  // (prop_enra_chainblade, Tripo; the older prop_enra_blade until it's published); chain-wrapped bracers on the forearms
  enra: {
    chains: true, bracer: 'prop_enra_bracer',
    L: { id: 'prop_enra_chainblade', alt: 'prop_enra_blade', flip: true, kind: 'blade', size: 0.37, color: '#3a2a2c', glow: '#ff5a1f', pitch: -0.2 },
    R: { id: 'prop_enra_chainblade', alt: 'prop_enra_blade', flip: true, kind: 'blade', size: 0.37, color: '#3a2a2c', glow: '#ff5a1f', pitch: -0.2 },
  },
  hayate: { R: { id: 'prop_hayate_nodachi', kind: 'blade', size: 0.62, color: '#e8efe9', glow: '#4fe3c1', pitch: -0.5 } },
  // the archers also hold the next arrow in the string hand (nocked on the string, drawn to the jaw, loosed, then a new
  // one drawn from the quiver over the right shoulder - Hanzo's cycle)
  yuzu: { L: { id: 'prop_yuzu_bow', kind: 'bow', size: 0.72, color: '#f2c14e', glow: '#ffd76a' }, R: { id: 'prop_yuzu_arrow', kind: 'arrow', size: 0.4, color: '#f7e2a8', glow: '#ffb347' } },
  seiran: { L: { id: 'prop_seiran_bow', kind: 'bow', size: 0.86, color: '#1d2433', glow: '#6fa8ff' }, R: { id: 'prop_seiran_arrow', kind: 'arrow', size: 0.42, color: '#dfe6f0', glow: '#6fa8ff' } },
  // Kaien's ofuda: a paper talisman pinched between the index and middle fingers of the throwing hand (gone for a beat
  // after each throw while the next one is drawn - CARD_GONE)
  kaien: { R: { id: 'prop_kaien_talisman', kind: 'card', size: 0.1, color: '#f2e6c4', glow: '#ffcf5a' } },
};

/** after a throw the talisman hand is empty until the next card is drawn from the sleeve (seconds after the throw) */
export const CARD_GONE: [number, number] = [0.04, 0.24];

export interface HeldProp { group: THREE.Group; kind: Kind }

/** Hayate's koi-scale shuriken, lying flat (its plane XZ, the normal +Y): the procedural star */
function shurikenMesh(L: number): THREE.Mesh {
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
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** a Tripo prop laid flat: its thinnest axis turned to +Y, its widest extent scaled to 2 x `radius`, centred */
function fitFlat(m: THREE.Object3D, radius: number): THREE.Object3D {
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const thin = [size.x, size.y, size.z].indexOf(Math.min(size.x, size.y, size.z));
  const wrap = new THREE.Group(), inner = new THREE.Group();
  inner.add(m); m.position.sub(c);
  inner.quaternion.setFromUnitVectors(axes[thin], new THREE.Vector3(0, 1, 0));
  inner.scale.setScalar(2 * radius / Math.max(1e-6, Math.max(size.x, size.y, size.z)));
  wrap.add(inner);
  return wrap;
}

/** thrown props (Hayate's shuriken, HeldProps' nodachi swap and every shuriken in flight): one fitted Tripo template per
 *  prop id, cloned per use; the procedural star until it is loaded */
const thrown = new Map<string, { tpl: THREE.Object3D | null; loading: Promise<void> | null }>();
function thrownTemplate(id: string, L: number, warm?: (o: THREE.Object3D) => Promise<void>) {
  let e = thrown.get(id);
  if (!e) { e = { tpl: null, loading: null }; thrown.set(id, e); }
  e.loading ??= (async () => {
    await loadManifest();
    if (!hasProp(id)) return;
    const m = await propModel(id);
    if (!m) return;
    const f = fitFlat(m, 0.045 * L);
    if (warm) await warm(f);
    e!.tpl = f;
  })();
  return e;
}
/** a thrown prop lying flat (normal +Y), the procedural star at once and the Tripo prop in its place once loaded */
export function thrownProp(id: string, L: number, warm?: (o: THREE.Object3D) => Promise<void>): THREE.Group {
  const g = new THREE.Group();
  const e = thrownTemplate(id, L, warm);
  const use = () => { if (!e.tpl) return; g.clear(); g.add(e.tpl.clone(true)); };
  if (e.tpl) use();
  else { g.add(shurikenMesh(L)); void e.loading!.then(() => { if (g.parent) use(); }); }
  return g;
}
/** the fitted thrown prop for the match preloader: a copy to upload and compile with the rest (null: no such prop) */
export async function thrownPropReady(id: string, L: number): Promise<THREE.Object3D | null> {
  const e = thrownTemplate(id, L);
  await e.loading;
  return e.tpl ? e.tpl.clone(true) : null;
}

/** Hayate's shuriken in his throwing hand whenever the nodachi is on his back (group.userData.swap): held edge-on
 *  between the fingers, the flat facing across the forearm (its normal +X), just past the fist */
function buildShuriken(L: number): THREE.Group {
  const g = thrownProp('prop_hayate_shuriken', L);
  g.rotation.z = -Math.PI / 2; g.position.set(0, 0.012 * L, 0.035 * L);
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

/** an arrow along +Z from its nock at the origin: a lacquered shaft, a steel head with a glowing edge, three vanes */
function buildArrow(L: number, it: Item, body: THREE.Group) {
  const len = it.size * L;
  const shaft = new THREE.MeshStandardMaterial({ color: '#2a2230', metalness: 0.3, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: it.color, metalness: 0.9, roughness: 0.25, emissive: new THREE.Color(it.glow), emissiveIntensity: 0.35 });
  const vane = new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.6, side: THREE.DoubleSide });
  put(body, new THREE.CylinderGeometry(0.0045 * L, 0.0045 * L, len, 6).rotateX(Math.PI / 2), shaft, 0, 0, len / 2);
  put(body, new THREE.ConeGeometry(0.011 * L, 0.05 * L, 4).rotateX(Math.PI / 2), steel, 0, 0, len + 0.022 * L);
  put(body, new THREE.CylinderGeometry(0.006 * L, 0.006 * L, 0.012 * L, 6).rotateX(Math.PI / 2), steel, 0, 0, 0.004 * L);   // nock
  for (let k = 0; k < 3; k++) {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.018 * L, 0.012 * L); s.lineTo(0.02 * L, 0.07 * L); s.lineTo(0, 0.08 * L); s.lineTo(0, 0);
    const m = put(body, new THREE.ShapeGeometry(s), vane, 0, 0, 0.015 * L);
    m.rotation.set(-Math.PI / 2, 0, k * Math.PI * 2 / 3, 'ZXY');
  }
}

/** a paper talisman along +Z past the fingertips, its face up (+Y): cream paper, a red seal, a glowing border */
function buildCard(L: number, it: Item, body: THREE.Group) {
  const len = it.size * L, w = len * 0.36;
  const paper = new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.85, side: THREE.DoubleSide, emissive: new THREE.Color(it.glow), emissiveIntensity: 0.12 });
  const ink = new THREE.MeshStandardMaterial({ color: '#b3202a', roughness: 0.6, side: THREE.DoubleSide });
  put(body, new THREE.BoxGeometry(w, 0.0015 * L, len), paper, 0, 0.02 * L, len * 0.5);
  put(body, new THREE.BoxGeometry(w * 0.55, 0.0018 * L, len * 0.55), ink, 0, 0.02 * L, len * 0.55);
}

export function buildHeld(modelHeight: number, it: Item): HeldProp {
  const g = new THREE.Group(), body = new THREE.Group(), L = modelHeight;
  g.add(body);
  g.userData.body = body;
  if (it.id === 'prop_hayate_nodachi') { const sh = buildShuriken(L); g.add(sh); g.userData.swap = sh; }
  if (it.kind === 'blade') { buildBlade(L, it, body); body.rotation.x = it.pitch ?? -0.5; }
  else if (it.kind === 'arrow') { buildArrow(L, it, body); g.userData.arrow = true; return { group: g, kind: it.kind }; }
  else if (it.kind === 'card') { buildCard(L, it, body); g.userData.card = true; }
  else buildBow(L, it, body);
  void (async () => {
    await loadManifest();
    const id = hasProp(it.id) ? it.id : it.alt && hasProp(it.alt) ? it.alt : null;
    if (!id) return;
    const m = await propModel(id);
    if (!m) return;
    const len = it.size * L;
    // fitProp lays the long axis on +Z (the thin grip end back) and centres it; a blade then slides forward so the
    // grip sits in the fist, a bow is stood up across the forearm (long axis on Y) with its middle in the fist
    const fitted = fitProp(m, 'blade', len);
    const wrap = new THREE.Group(); wrap.add(fitted);
    // (the fallback prop fits the right way round on its own)
    if (it.flip && id === it.id) { const inner = new THREE.Group(); inner.add(fitted); inner.rotation.y = Math.PI; fitted.position.set(0, 0, 0); wrap.add(inner); if (it.kind === 'blade') inner.position.z += len * 0.38; }
    else if (it.kind === 'blade') fitted.position.z += len * 0.38;
    // the card: fitted like a blade (length on +Z, width on +Y), rolled flat so its face is up, out past the fingertips
    else if (it.kind === 'card') { fitted.position.z += len * 0.5; wrap.rotation.z = Math.PI / 2; wrap.position.y = 0.02 * L; }   // up at the fingers
    else wrap.rotation.x = -Math.PI / 2;
    body.clear(); body.position.set(0, 0, 0);
    body.add(wrap);
  })();
  return { group: g, kind: it.kind };
}

/** after a shot the string hand is empty until it brings the next arrow from the quiver (seconds after the shot) */
export const ARROW_GONE: [number, number] = [0.03, 0.42];

/** Hayate keeps the nodachi sheathed on his back except while he deflects, dashes, cuts or runs the Dragon Gate */
export function heldVisible(heroId: string, side: 0 | 1, a: { has(s: string, t: number): boolean; anim: { castId?: string; castAt: number; attackAt: number; attackKind?: string } }, t: number) {
  if (heroId !== 'hayate' || side !== 1) return true;
  const cast = t - a.anim.castAt, atk = t - a.anim.attackAt;
  return a.has('dragonblade', t) || a.has('parry', t) || a.has('deflect', t) || a.has('phased', t) && a.anim.castId === 'dragongate'
    || a.anim.castId === 'currentdash' && cast < 0.45 || a.anim.castId === 'dragongate' && cast < 1.4
    || (a.anim.attackKind === 'punch' || a.anim.attackKind === 'secondary' && a.has('phased', t)) && atk < 0.5;
}
