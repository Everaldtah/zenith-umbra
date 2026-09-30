// Visual for one actor: rigged GLB (or a same-skeleton mannequin while it loads / if missing), procedural animation,
// team rim light, stealth fade, shields, Solar Bulwark, death collapse.
import * as THREE from 'three';
import type { Actor } from '../game/Actor';
import { Animator, REAP_SECS, REAP_STOP, type AnimState } from './Animator';
import { hasModel, hasProp, heroModel, loadManifest, modelInfo, propModel, type EyeInfo } from './Assets';
import { Eyelids, EyeGlow } from './Eyes';
import { animLib, animLibrary } from './ClipLibrary';
import { buildHammer, buildBlaster, buildChaingun, buildSonicAmp, buildMagSkate, fitGreatsword, type HammerProp, type ChaingunProp, type SkateProp } from './Hammer';
import { buildFang, buildGreatAxe, buildScattergun } from './TomoeProps';
import { HELD, buildHeld, heldVisible, ARROW_GONE, CARD_GONE } from './HeldProps';
import { buildChainLoop, updateChainLoop, type ChainLoop } from './ChainBlades';
import { Fingers, driveFingers } from './Fingers';
import { Ragdoll } from './Ragdoll';
import type { Level } from '../engine/Physics';

const BRIGHT_SUITS = new Set(['mirei']);
const _jp = new THREE.Vector3(), _m3 = new THREE.Matrix3(), _sv = new THREE.Vector3();
const _kq = new THREE.Quaternion(), _kv = new THREE.Vector3();
/** Tomoe's Crescent Warpath: turns of the body over the flight, and the glow of the heroes it cut through */
/** the greatsword a summoned giant swings (on the hammer path, its sweeps on the summon's own cadence - GIANT_SWING) */
export const GIANT_SWORD: Record<string, string> = { enra_effigy: 'prop_enra_susanoo_sword' };
const GIANT_SWING: Record<string, number> = { enra_effigy: EFFIGY_HIT.every };
/** the glow of the heroes Tomoe's Crescent Warpath cut through */
const TIDE_BLUE = '#3fa9ff';
/** speed (m/s) above which fast moves smear (Davis GDC17: stretch the mesh along its motion - automated smear frames) */
const SMEAR_FROM = 12;
import { skinsFor, type Skin } from '../data/skins';
import { FULL } from '../edition';
import { EFFIGY_HIT } from '../game/effigy';

const rimChunk = `
  float zuRim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.5);
  totalEmissiveRadiance += zuRimColor * zuRim * zuRimStrength;
  // legendary / epic skins: flowing energy lines across the body
  // epic / legendary: the recoloured accent trims glow
  totalEmissiveRadiance += zuDst2 * zuAccentW * zuGlow * 0.55;
  if (zuPattern > 0.0) {
    float band = sin(zuWorld.y * 7.0 - zuTime * 3.0 + sin(zuWorld.x * 3.0 + zuWorld.z * 2.0) * 1.5);
    float line = smoothstep(0.93, 1.0, band) * zuPattern;
    totalEmissiveRadiance += zuPatternColor * (line * 1.6 + zuGlow * 0.35 * zuRim);
  }
`;
const skinChunk = `
  // skin palette recolour: the costume's measured primary / accent hues -> the skin's colours, neutrals tinted; skin
  // tones (warm, moderately saturated) and near-greys keep the hero's own paint, so faces never change colour
  zuAccentW = 0.0;
  if (zuRemap > 0.5) {
    vec3 c = diffuseColor.rgb;
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
    float h = 0.0;
    if (d > 1e-4) { if (mx == c.r) h = mod((c.g - c.b) / d, 6.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0; h /= 6.0; }
    float s = mx > 0.0 ? d / mx : 0.0, v = mx;
    float skinTone = smoothstep(0.0, 0.03, h) * (1.0 - smoothstep(0.09, 0.13, h)) * smoothstep(0.12, 0.2, s) * (1.0 - smoothstep(0.55, 0.7, s)) * smoothstep(0.25, 0.4, v) * zuKeepSkin;
    float sat = smoothstep(0.12, 0.3, s);
    float d1 = abs(h - zuSrc1.x); d1 = min(d1, 1.0 - d1);
    float d2 = abs(h - zuSrc2.x); d2 = min(d2, 1.0 - d2);
    float w1 = exp(-pow(d1 / 0.075, 2.0)) * sat * (1.0 - skinTone);
    float w2 = exp(-pow(d2 / 0.075, 2.0)) * sat * (1.0 - skinTone) * (1.0 - w1);
    float wn = (1.0 - sat) * (1.0 - skinTone);
    // the head (hair, face) keeps its own colours: above the neck in the bind pose
    float head = smoothstep(zuHeadY - zuHeadBand, zuHeadY + zuHeadBand, zuBindY);
    w1 *= 1.0 - head; w2 *= 1.0 - head; wn *= 1.0 - head;
    vec3 r1 = zuDst1 * clamp(v / max(0.05, zuSrc1.y), 0.25, 1.6);
    vec3 r2 = zuDst2 * clamp(v / max(0.05, zuSrc2.y), 0.25, 1.6);
    vec3 outc = mix(c, r1, w1 * zuHas1);
    outc = mix(outc, r2, w2 * zuHas2);
    outc = mix(outc, c * zuNeutral, wn);
    zuAccentW = w2 * zuHas2;
    diffuseColor.rgb = outc;
  }
`;

export interface LookUniforms { [k: string]: { value: any } }
export function lookUniforms(rim: THREE.Color): LookUniforms {
  return {
    zuRimColor: { value: rim }, zuRimStrength: { value: 0 }, zuHue: { value: 0 }, zuSat: { value: 1 }, zuVal: { value: 1 },
    zuTint: { value: new THREE.Color('#ffffff') }, zuTintAmt: { value: 0 }, zuGlow: { value: 0 }, zuPattern: { value: 0 },
    zuPatternColor: { value: new THREE.Color('#ffffff') }, zuTime: { value: 0 },
    zuRemap: { value: 0 }, zuSrc1: { value: new THREE.Vector2(0, 0.5) }, zuSrc2: { value: new THREE.Vector2(0.5, 0.5) },
    zuDst1: { value: new THREE.Color('#ffffff') }, zuDst2: { value: new THREE.Color('#ffffff') }, zuNeutral: { value: new THREE.Color('#ffffff') },
    zuHas1: { value: 0 }, zuHas2: { value: 0 }, zuMetal: { value: 0 }, zuKeepSkin: { value: 1 }, zuHeadY: { value: 1e9 }, zuHeadBand: { value: 0.01 },
    zuSmear: { value: new THREE.Vector3() },
  };
}
export function applySkin(u: LookUniforms, s: Skin) {
  const on = !!(s.primary || s.accent || s.neutral.toLowerCase() !== '#ffffff');
  u.zuRemap.value = on ? 1 : 0;
  u.zuHas1.value = s.primary ? 1 : 0; u.zuHas2.value = s.accent ? 1 : 0;
  u.zuDst1.value.set(s.primary ?? '#ffffff').convertSRGBToLinear(); u.zuDst2.value.set(s.accent ?? '#ffffff').convertSRGBToLinear();
  u.zuNeutral.value.set(s.neutral).convertSRGBToLinear();
  u.zuMetal.value = s.metal; u.zuGlow.value = s.glow;
  u.zuPattern.value = s.pattern; u.zuPatternColor.value.set(s.patternColor);
}

/**
 * The costume's two dominant hues (and their mean brightness), measured from the base-colour texture so skins can
 * remap them: saturated texels only, skin tones excluded. Returns [hue, value] pairs in 0..1 (linear value).
 */
export function analysePalette(tex: THREE.Texture | null): [[number, number], [number, number]] | null {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || typeof document === 'undefined' || !img.width) return null;
  const N = 96, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true }); if (!g) return null;
  try { g.drawImage(img, 0, 0, N, N); } catch { return null; }
  const px = g.getImageData(0, 0, N, N).data;
  const B = 36, wsum = new Float32Array(B), vsum = new Float32Array(B);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255, a = px[i + 3];
    if (a < 128) continue;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn, s = mx > 0 ? d / mx : 0;
    if (s < 0.22 || mx < 0.12) continue;
    let h = mx === r ? ((gg - b) / d + 6) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h /= 6;
    if (h > 0.0 && h < 0.11 && s < 0.6 && mx > 0.3) continue;     // skin tones
    const k = Math.min(B - 1, Math.floor(h * B)), w = s * mx;
    wsum[k] += w; vsum[k] += w * Math.pow(mx, 2.2);
  }
  const smooth = (k: number) => wsum[(k + B - 1) % B] * 0.5 + wsum[k] + wsum[(k + 1) % B] * 0.5;
  let b1 = 0; for (let k = 1; k < B; k++) if (smooth(k) > smooth(b1)) b1 = k;
  let b2 = -1; for (let k = 0; k < B; k++) { const dd = Math.min(Math.abs(k - b1), B - Math.abs(k - b1)); if (dd >= 4 && (b2 < 0 || smooth(k) > smooth(b2))) b2 = k; }
  if (!wsum[b1]) return null;
  const hv = (k: number): [number, number] => [(k + 0.5) / B, wsum[k] ? vsum[k] / wsum[k] : 0.5];
  return [hv(b1), b2 >= 0 && wsum[b2] > wsum[b1] * 0.08 ? hv(b2) : hv((b1 + B / 2) % B)];
}

/** inject rim light + skin recolour into a (per-instance) standard material */
export function addLook(mat: THREE.Material, u: LookUniforms) {
  const m = mat as THREE.MeshStandardMaterial;
  if ((m as any).__look) return;
  (m as any).__look = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform vec3 zuSmear;\nvarying vec3 zuWorld; varying float zuBindY;\n' + sh.vertexShader
      // smear frames: surfaces facing away from the motion are dragged back along it (streaky, like drawn speed lines)
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n{ float zsl = length(zuSmear); if (zsl > 1e-4) { vec3 zsd = zuSmear / zsl; float zk = smoothstep(0.3, 0.95, dot(normalize(objectNormal), zsd)); transformed += zuSmear * zk * (0.75 + 0.25 * sin(position.y * 6.0 + position.x * 4.0)); } }')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nzuWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; zuBindY = position.y;');
    sh.fragmentShader = 'uniform vec3 zuRimColor; uniform float zuRimStrength; uniform float zuHue; uniform float zuSat; uniform float zuVal; uniform vec3 zuTint; uniform float zuTintAmt; uniform float zuGlow; uniform float zuPattern; uniform vec3 zuPatternColor; uniform float zuTime;\n'
      + 'uniform float zuRemap; uniform vec2 zuSrc1; uniform vec2 zuSrc2; uniform vec3 zuDst1; uniform vec3 zuDst2; uniform vec3 zuNeutral; uniform float zuHas1; uniform float zuHas2; uniform float zuMetal; uniform float zuKeepSkin; uniform float zuHeadY; uniform float zuHeadBand;\nvarying vec3 zuWorld; varying float zuBindY;\nfloat zuAccentW = 0.0;\n'
      + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + skinChunk).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + rimChunk)
        // metallic trims on legendary accents
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, zuMetal * zuAccentW); roughnessFactor = mix(roughnessFactor, 0.28, zuMetal * zuAccentW);');
  };
  m.customProgramCacheKey = () => 'zulook';
  m.needsUpdate = true;
}

// ---------------------------------------------------------------- fallback mannequin (same bone names as the Blender rig)
export function mannequin(a: Actor): THREE.Object3D {
  const d = a.def, H = d.height;
  const mech = d.frame === 'mech', robot = a.isRobot;
  const col = new THREE.Color(d.color), dark = new THREE.Color(a.team === 'zenith' ? '#f2f5ff' : '#1d1a24');
  const mat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.5, metalness: mech ? 0.6 : 0.2 });
  const acc = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.4 });
  const root = new THREE.Object3D(); root.name = 'root';
  const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => { const b = new THREE.Object3D(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const limb = (b: THREE.Object3D, len: number, r: number, m = mat, dir = -1) => {
    const g = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 8), m);
    g.position.y = dir * len / 2; g.castShadow = true; b.add(g); return g;
  };
  const w = mech ? 1.6 : 1;
  const hipsY = H * 0.5;
  const hips = bone('hips', root, 0, hipsY, 0);
  const spine = bone('spine', hips, 0, H * 0.06, 0);
  const chest = bone('chest', spine, 0, H * 0.12, 0);
  const neck = bone('neck', chest, 0, H * 0.16, 0);
  const head = bone('head', neck, 0, H * 0.04, 0);
  const torso = new THREE.Mesh(mech ? new THREE.BoxGeometry(H * 0.34, H * 0.26, H * 0.2) : new THREE.CapsuleGeometry(H * 0.09 * w, H * 0.14, 4, 10), mat);
  torso.position.y = H * 0.06; torso.castShadow = true; chest.add(torso);
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(H * 0.075 * w, H * 0.06, 4, 8), acc); belly.position.y = H * 0.03; spine.add(belly);
  const hd = new THREE.Mesh(mech ? new THREE.BoxGeometry(H * 0.1, H * 0.09, H * 0.1) : new THREE.SphereGeometry(H * 0.075, 14, 10), robot ? acc : mat);
  hd.position.y = H * 0.07; hd.castShadow = true; head.add(hd);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(H * 0.09, H * 0.02, H * 0.02), acc); visor.position.set(0, H * 0.075, H * (mech ? 0.05 : 0.065)); head.add(visor);
  if (mech) { const cockpit = new THREE.Mesh(new THREE.SphereGeometry(H * 0.055, 12, 8), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 })); cockpit.position.set(0, H * 0.07, H * 0.1); chest.add(cockpit); }
  for (const [s, L] of [[1, 'L'], [-1, 'R']] as [number, string][]) {
    const sh = bone(`shoulder_${L}`, chest, s * H * 0.04 * w, H * 0.13, 0);
    const ua = bone(`upperarm_${L}`, sh, s * H * 0.07 * w, 0, 0);
    ua.rotation.z = s * 0.55;                // A-pose
    const fa = bone(`forearm_${L}`, ua, 0, -H * 0.16, 0);
    bone(`hand_${L}`, fa, 0, -H * 0.15, 0);
    limb(ua, H * 0.16, H * 0.035 * w); limb(fa, H * 0.15, H * 0.03 * w, s < 0 ? acc : mat);
    if (mech) { const pad = new THREE.Mesh(new THREE.BoxGeometry(H * 0.12, H * 0.08, H * 0.12), acc); pad.position.y = H * 0.02; sh.add(pad); }
    const th = bone(`thigh_${L}`, hips, s * H * 0.055 * w, -H * 0.02, 0);
    const shn = bone(`shin_${L}`, th, 0, -H * 0.23, 0);
    const ft = bone(`foot_${L}`, shn, 0, -H * 0.225, 0);
    limb(th, H * 0.23, H * 0.045 * w); limb(shn, H * 0.225, H * 0.038 * w);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(H * 0.06 * w, H * 0.035, H * 0.12 * w), acc); boot.position.set(0, -H * 0.01, H * 0.03); boot.castShadow = true; ft.add(boot);
    if (d.frame === 'flyer') {
      const wing = bone(`wing_${L}`, chest, s * H * 0.04, H * 0.12, -H * 0.08);
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(s * H * 0.45, H * 0.25); shape.lineTo(s * H * 0.55, -H * 0.05); shape.lineTo(s * H * 0.25, -H * 0.2); shape.lineTo(0, 0);
      const wm = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      wing.add(wm);
    }
  }
  if (d.frame === 'drone') {
    root.clear();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 12), mat); body.position.y = 0.5; root.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), acc); eye.position.set(0, 0.5, 0.38); root.add(eye);
    for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 16), acc); r.rotation.x = Math.PI / 2; r.position.set(Math.cos(i * Math.PI / 2 + 0.78) * 0.55, 0.62, Math.sin(i * Math.PI / 2 + 0.78) * 0.55); root.add(r); }
  }
  return root;
}

/** friendly / enemy outline colours (Settings > Accessibility) */
export const UI_COLORS = { ally: '#5cc8ff', enemy: '#ff3b5c' };

export class CharacterView {
  group = new THREE.Group();            // world transform (position + yaw)
  inner = new THREE.Group();            // death tilt / squash
  model: THREE.Object3D;
  anim: Animator;
  /** finger curls (Tripo rigs): the hands close around each hero's weapon */
  fingers: Fingers | null = null;
  rimColor: THREE.Color;
  look: LookUniforms;
  get rim() { return this.look.zuRimStrength; }
  skin: Skin;
  mats: THREE.Material[] = [];
  real = false;
  shieldMesh: THREE.Mesh;
  barrierMesh: THREE.Mesh | null = null;
  scaleFit = 1;
  hammer: HammerProp | null = null;
  /** Tomoe's axe slung on her back between swings */
  backAxe: THREE.Object3D | null = null;
  /** the hero this view was built for: the World swaps defs (mech <-> pilot), and the view is rebuilt then */
  defId: string;
  jets: THREE.Mesh[] = [];
  /** twin chaingun props [left, right] (heroes with dualGuns) */
  guns: ChaingunProp[] = [];
  /** first-person viewmodels don't smear (the camera rides the motion) */
  noSmear = false;
  private downYaw: number | null = null;
  private tideMarked = false;
  /** called back from the dead ('reborn'): the golden translucent figure until the guard ends, then solid with a ring */
  private reborn = false;
  private rebornSnap: { m: THREE.MeshStandardMaterial; color: number; emissive: number; ei: number; tr: boolean; op: number; dw: boolean }[] = [];
  onRebornSolid?: (a: Actor) => void;
  /** a hologram (a summoned effigy, HeroDef.holo): tinted, emissive and translucent, rising in and fading out */
  private get holo() { return this.actor.def.holo; }
  private spinA = [0, 0];
  private stealthed = false;
  onStep: ((a: Actor, side: number, heavy: boolean) => void) | null = null;

  /** close-up views load the high-detail model; the first-person viewmodel its own hand model ('fp': arms only) */
  readonly hd: boolean | 'fp';

  constructor(public actor: Actor, public viewerTeam: string, skinId = 'classic', opts: { hd?: boolean | 'fp' } = {}) {
    this.hd = opts.hd ?? false;
    this.defId = actor.def.id;
    this.rimColor = new THREE.Color(actor.team === viewerTeam ? UI_COLORS.ally : UI_COLORS.enemy);
    this.look = lookUniforms(this.rimColor);
    const skins = skinsFor(actor.def.id, actor.def.team);
    this.skin = skins.find(s => s.id === skinId) ?? skins[0];
    applySkin(this.look, this.skin);
    this.group.add(this.inner);
    this.model = mannequin(actor);
    this.inner.add(this.model);
    this.anim = new Animator(this.model);
    this.hookStep();
    this.attachClips();
    this.attachGuns(this.anim, this.model);
    this.collectMats();
    const sg = new THREE.SphereGeometry(1, 24, 16);
    this.shieldMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: actor.def.glow, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);
    if (actor.barrier.max) {
      const g = new THREE.CylinderGeometry(3.2, 3.2, 3.8, 24, 1, true, -0.72, 1.44);
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { t: { value: 0 }, c: { value: new THREE.Color(actor.def.glow) }, hp: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `uniform float t; uniform vec3 c; uniform float hp; varying vec2 vUv;
          float hex(vec2 p){ p.x*=1.1547; p.y+=mod(floor(p.x),2.0)*0.5; p=abs(fract(p)-0.5); return abs(max(p.x*1.5+p.y,p.y*2.0)-1.0); }
          void main(){ vec2 p=vUv*vec2(14.0,8.0); float h=smoothstep(0.0,0.12,hex(p)); float edge=smoothstep(0.35,0.5,abs(vUv.x-0.5))+smoothstep(0.85,1.0,vUv.y)+smoothstep(0.1,0.0,vUv.y);
            float a=(0.18+ (1.0-h)*0.55 + edge*0.5)*(0.6+0.4*sin(t*3.0+vUv.y*10.0)); gl_FragColor=vec4(mix(vec3(1.0,0.3,0.2),c,hp)*a, a*0.9); }`,
      });
      this.barrierMesh = new THREE.Mesh(g, m);
      this.barrierMesh.position.set(0, 1.9, -1.5);
      this.barrierMesh.visible = false;
      this.group.add(this.barrierMesh);
    }
    this.fitMannequin();
    // a summoned hologram waits for its own model rather than showing the mannequin for a frame (a program compiled for
    // nothing, mid-match)
    if (this.holo) this.model.visible = false;
    this.loadReal();
  }

  setSkin(id: string) {
    const s = skinsFor(this.actor.def.id, this.actor.def.team).find(x => x.id === id);
    if (!s) return;
    this.skin = s; applySkin(this.look, s);
    if (this.modelIdFor(s) !== this.loadedModel) void this.loadReal();          // a model skin swaps the whole body
  }

  /** the model this skin wears: its own (model skins, when published) or the hero's */
  private modelIdFor(s: Skin) {
    const d = this.actor.def;
    return d.model && hasModel(d.model) ? d.model : s.model && hasModel(s.model) ? s.model : d.id;   // (a summon wears its own form)
  }
  private loadedModel = '';
  private loadSeq = 0;

  lids: Eyelids | null = null;
  eyeGlow: EyeGlow | null = null;
  /** the map the ragdolls collide with (set by the match; the Hero Viewer has none - a flat floor) */
  static level: Level | null = null;
  /** set by the match once its preload has run: warms a model that loads mid-match before it's shown */
  static warm: ((o: THREE.Object3D) => Promise<void>) | null = null;
  /** a ragdoll's hard landing (the match plays the thud) */
  onBodyFall?: (a: Actor, at: THREE.Vector3, speed: number) => void;
  /** a heavy strike landed (Crescent Reaping's cleave): the match kicks the camera for the player, shakes it nearby */
  onImpact?: (a: Actor) => void;
  /** Overwatch-style death: the body goes limp and is thrown by the killing blow (desktop edition, humanoid rigs) */
  private ragdoll: Ragdoll | null = null;
  private ragdollDone = false;
  private boneSnap: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[] | null = null;
  private hammerParent: THREE.Object3D | null = null;
  /** twin chainguns: model-space props the animator lays along the forearms each frame */
  skates: SkateProp[] = [];
  /** the hero holds a HeldProps blade / bow (anim.guns) */
  private heldHero = false;
  /** Enra's chains, one loop per held blade (HeldSpec.chains): from the bracer to the pommel, in the guns' root */
  private chainLoops: ChainLoop[] = [];
  private attachGuns(anim: Animator, root: THREE.Object3D) {
    for (const g of this.guns) g.group.parent?.remove(g.group);
    for (const s of this.skates) s.group.parent?.remove(s.group);
    for (const c of this.chainLoops) c.group.parent?.remove(c.group);
    this.guns = []; this.skates = []; this.chainLoops = []; anim.feet = null; this.heldHero = false; anim.gunUpright = [false, false];
    if (this.actor.def.id === 'tomoe' && anim.ok) {
      // Tomoe: the Crownfire Scattergun on the right forearm, the Crescent Fang in the left fist
      const fang = buildFang(anim.height), gun = buildScattergun(anim.height);
      this.guns = [{ group: fang, spin: new THREE.Group(), flash: new THREE.Mesh(), core: gun.core, len: 0 }, gun];
      root.add(fang); root.add(gun.group);
      anim.guns = [fang, gun.group];
      return;
    }
    if (this.actor.def.id === 'hibiki' && anim.ok) {
      // Hibiki: the Subwoofer Blaster on the right forearm (an empty mount on the left), mag-skates on both feet
      const mount = new THREE.Group(), amp = buildSonicAmp(anim.height);
      this.guns = [{ group: mount, spin: new THREE.Group(), flash: new THREE.Mesh(), core: amp.core, len: 0 }, amp];
      root.add(mount); root.add(amp.group);
      anim.guns = [mount, amp.group];
      this.skates = [buildMagSkate(anim.height), buildMagSkate(anim.height)];
      for (const s of this.skates) root.add(s.group);
      anim.feet = [this.skates[0].group, this.skates[1].group];
      return;
    }
    const held = HELD[this.actor.def.id];
    if (held && anim.ok) {
      // a blade or a bow in the fist (an empty mount on the other side), laid along the forearm by the animator
      const mk = (it: typeof held.L) => it ? buildHeld(anim.height, it).group : new THREE.Group();
      const gl = mk(held.L), gr = mk(held.R);
      this.guns = [gl, gr].map(group => ({ group, spin: new THREE.Group(), flash: new THREE.Mesh(), core: new THREE.MeshStandardMaterial(), len: 0 }));
      root.add(gl); root.add(gr);
      anim.guns = [gl, gr];
      anim.gunUpright = [held.L?.kind === 'bow', held.R?.kind === 'bow'];
      anim.arrowSlot = [held.L?.kind === 'arrow', held.R?.kind === 'arrow'];
      this.heldHero = true;
      if (held.chains) {
        this.chainLoops = [held.L, held.R].map(it => { const c = buildChainLoop(anim.height); c.group.visible = !!it; root.add(c.group); return c; });
      }
      return;
    }
    if (!this.actor.def.dualGuns || !anim.ok) { anim.guns = null; return; }
    this.guns = [buildChaingun(anim.height, 'L'), buildChaingun(anim.height, 'R')];
    for (const g of this.guns) g.group.scale.setScalar(1.25);          // concept-sized: they're half as long as he is tall
    for (const g of this.guns) root.add(g.group);
    anim.guns = [this.guns[0].group, this.guns[1].group];
  }

  /** barrels spin with each gun's spin-up, the muzzles flash on their own rounds, the cores glow hotter while firing */
  updateGuns(dt: number, time: number) {
    if (!this.guns.length) return;
    const a = this.actor;
    if (this.heldHero) {
      const hide: [boolean, boolean] = [false, false];
      for (let i = 0; i < 2; i++) {
        const g = this.guns[i].group;
        if (g.userData.arrow) {
          // the nocked arrow: gone from loose until the next one comes out of the quiver; in third person it shows only
          // while the bow is up (drawn, or nocking between shots)
          const since = time - a.anim.attackAt, shot = a.anim.attackKind === 'primary' || a.anim.attackKind === 'secondary';
          const gone = shot && since > ARROW_GONE[0] && since < ARROW_GONE[1];
          hide[i] = gone || (!this.noSmear && this.anim.drawW < 0.45);
          continue;
        }
        if (g.userData.card) {
          // the talisman leaves the fingers on each throw; the next one is drawn a beat later
          const since = time - a.anim.attackAt, thrown = a.anim.attackKind === 'primary' || a.anim.attackKind === 'secondary';
          hide[i] = thrown && since > CARD_GONE[0] && since < CARD_GONE[1];
          continue;
        }
        const vis = heldVisible(a.def.id, i as 0 | 1, a, time);
        // a hand with a stand-in (Hayate: the shuriken while the nodachi is sheathed) never goes empty
        if (g.userData.swap) { (g.userData.body as THREE.Object3D).visible = vis; (g.userData.swap as THREE.Object3D).visible = !vis; }
        // Dragon Gate Blade: the drawn nodachi burns with the koi-dragon's violet for the whole 15 s
        if (g.userData.body) {
          const k = a.has('dragonblade', time) ? 0.9 + 0.35 * Math.sin(time * 9) : 0;
          if (k !== g.userData.glowK) {
            g.userData.glowK = k;
            (g.userData.body as THREE.Object3D).traverse(o => {
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
              if (!m || !('emissive' in m)) return;
              m.userData.e0 ??= [m.emissive.getHex(), m.emissiveIntensity];          // its own glow, restored after
              if (k > 0) { m.emissive.set('#b36bff'); m.emissiveIntensity = k; } else { m.emissive.setHex(m.userData.e0[0]); m.emissiveIntensity = m.userData.e0[1]; }
            });
          }
        }
        else hide[i] = !vis;
      }
      this.anim.gunHide = hide;
      // the chains: from a bracer a third of the way up the forearm to the pommel just behind the fist (the held blade's
      // frame: origin in the fist, +Z along the forearm), the loop hanging a fifth of his height at rest
      for (let i = 0; i < this.chainLoops.length; i++) {
        const c = this.chainLoops[i], g = this.guns[i]?.group, it = i === 0 ? HELD[a.def.id]?.L : HELD[a.def.id]?.R;
        if (!g || !it) { c.group.visible = false; continue; }
        c.group.visible = g.visible && !hide[i];
        if (!c.group.visible) { c.prev = null; continue; }
        const L = this.anim.height, len = it.size * L;
        const bracer = new THREE.Vector3(0, 0.012 * L, -0.17 * L).applyQuaternion(g.quaternion).add(g.position);
        const pommel = new THREE.Vector3(0, 0, -0.12 * len).applyQuaternion(g.quaternion).add(g.position);
        updateChainLoop(c, bracer, pommel, 0.19 * L, dt);
      }
      return;
    }
    if (a.def.id === 'tomoe') {
      // the axe replaces both guns while it's out; the Fang leaves her hand when thrown; the crown muzzle flashes per blast
      const axe = this.axeOut(time), age = time - a.anim.attackAt;
      this.anim.gunHide = [axe || !!a.sv.fang, axe];
      this.guns[0].group.visible = this.guns[0].group.visible && !this.anim.gunHide[0];
      this.guns[1].group.visible = this.guns[1].group.visible && !axe;
      const g = this.guns[1];
      g.flash.visible = g.group.visible && age < 0.06 && a.anim.attackKind === 'primary' && a.alive;
      if (g.flash.visible) { g.flash.scale.setScalar(0.8 + Math.random() * 0.5); g.flash.rotation.z = Math.random() * Math.PI; }
      if (this.backAxe) this.backAxe.visible = !axe;
      return;
    }
    if (a.def.id === 'hibiki') {
      // the woofer pumps on each round of the burst; the equaliser and wheels glow the colour of the track
      const g = this.guns[1], age = time - a.anim.attackAt;
      g.spin.position.z = g.len - 0.032 * this.anim.height + (age < 0.06 ? 0.01 * this.anim.height * (1 - age / 0.06) : 0);
      g.flash.visible = age < 0.05 && a.alive && a.anim.attackKind !== 'punch';
      if (g.flash.visible) g.flash.scale.setScalar(0.8 + age * 12);
      const col = a.sv.track ? '#ffd23f' : '#39d6ff', amp = a.has('amp', time) ? 1.6 : 1;
      g.core.emissive.set(col); g.core.emissiveIntensity = 2.2 * amp;
      const roll = Math.hypot(a.vel.x, a.vel.z) * dt / (0.016 * this.anim.height);
      const groove = 1 + Math.min(2.5, ((a.sv.rhythm ?? 1) - 1) * 0.15);          // the Groove brightens the wheels
      for (const s of this.skates) { s.glow.emissive.set(col); s.glow.emissiveIntensity = (a.has('grinding', time) ? 3.2 : 2) * amp * groove; for (const w of s.wheels) w.rotation.x += roll; }
      return;
    }
    for (let i = 0; i < 2; i++) {
      const g = this.guns[i], spin = (i === 0 ? a.sv.spin1 : a.sv.spin2) ?? 0, age = time - (i === 0 ? a.anim.fireL : a.anim.fireR);
      this.spinA[i] += dt * spin * 38 * (i === 0 ? 1 : -1);
      g.spin.rotation.z = this.spinA[i];
      g.flash.visible = age < 0.045 && a.alive;
      if (g.flash.visible) { g.flash.rotation.z = Math.random() * Math.PI; g.flash.scale.setScalar(0.7 + Math.random() * 0.6); }
      g.core.emissiveIntensity = 2.2 + spin * 2.5 + (a.has('dohyo', time) ? 1.5 : 0);
    }
  }

  /** Quaternius UAL / Mixamo clip library (public/anim): drives the body wherever it has a clip */
  private attachClips() {
    if (animLib) { this.anim.useClips(animLib, this.actor.id, this.defId); return; }
    const anim = this.anim;
    animLibrary().then(l => { if (l && this.anim === anim) anim.useClips(l, this.actor.id, this.defId); });
  }

  private hookStep() { this.anim.onStep = (side, heavy) => this.onStep?.(this.actor, side, heavy); }

  private collectMats() {
    this.mats = [];
    this.model.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const list = Array.isArray(m.material) ? m.material : [m.material];
        // per-instance materials: clones of the same hero must not share rim / skin uniforms
        const own = list.map(mt => (mt as any).__owner === this ? mt : Object.assign(mt.clone(), { __owner: this }));
        m.material = Array.isArray(m.material) ? own : own[0];
        for (const mt of own) { if ((mt as THREE.MeshStandardMaterial).isMeshStandardMaterial) addLook(mt, this.look); this.mats.push(mt); }
      }
    });
    if (this.holo) this.hologram(this.holo);
  }

  /** a summoned effigy's look: the body lit from within in its colour, translucent, rim-lit - a solid enough hologram to
   *  read as a giant figure (Enra's crimson oni, Raijin's Susanoo) */
  private hologram(col: string) {
    const c = new THREE.Color(col);
    for (const mt of this.mats) {
      const m = mt as THREE.MeshStandardMaterial;
      if (!m.isMeshStandardMaterial) continue;
      m.color.copy(c).lerp(new THREE.Color('#ffffff'), 0.3);
      m.emissive.copy(c); m.emissiveIntensity = 0.85; m.roughness = 0.6; m.metalness = 0;
      m.transparent = true; m.opacity = 0.82; m.depthWrite = true; m.needsUpdate = true;
    }
    this.rimColor.copy(c).lerp(new THREE.Color('#ffffff'), 0.4);
  }

  private fitMannequin() { this.scaleFit = 1; this.model.scale.setScalar(1); }

  private async loadReal() {
    const id = this.actor.def.id;
    const seq = ++this.loadSeq;
    await loadManifest();
    const mid = this.modelIdFor(this.skin);
    const m = await heroModel(mid, this.hd);
    if (!m || seq !== this.loadSeq) return;                  // a newer load (skin change) superseded this one
    // a giant's greatsword comes in with the body (so the hologram look and the shader warm-up cover it)
    const sword = GIANT_SWORD[id] && hasProp(GIANT_SWORD[id]) ? await propModel(GIANT_SWORD[id]) : null;
    if (seq !== this.loadSeq) return;
    if (this.real) {
      // swapping models (a model skin): drop the old body's props before the new one takes them over
      this.hammer?.group.parent?.remove(this.hammer.group); this.hammer = null;
      this.backAxe?.parent?.remove(this.backAxe); this.backAxe = null;
      for (const j of this.jets) j.parent?.remove(j);
      this.jets = [];
    }
    this.loadedModel = mid;
    // normalise: feet on the ground, height = hero height (the rig script already faces +Z)
    const box = new THREE.Box3().setFromObject(m);
    const fb = m.userData.fullBody as { minY: number; maxY: number } | undefined;      // an arms-only hand model
    if (fb) { box.min.y = fb.minY; box.max.y = fb.maxY; }
    const h = box.max.y - box.min.y || 1;
    const wrap = new THREE.Group();
    wrap.add(m);
    m.position.y = -box.min.y;
    const s = this.actor.def.height / h;
    wrap.scale.setScalar(s);
    const anim = new Animator(m);
    if (!anim.ok && this.actor.def.frame !== 'drone' && !this.actor.isRobot) { console.warn('rig missing bones for', id); }
    this.inner.remove(this.model);
    this.inner.add(wrap);
    this.model = wrap;
    this.anim = anim;
    this.fingers = FULL ? Fingers.build(m) : null;          // (the web demo keeps its plain hands)
    this.scaleFit = s;
    this.real = true;
    this.hookStep();
    this.attachClips();
    // two-handed hammer heroes carry a real weapon: a model-space prop the animator poses along the swing path (a sweep
    // hero with held blades - Enra's Hellfire Chains - swings those instead, HeldProps / Animator)
    if (this.actor.def.primary.sweep && anim.ok && !HELD[id]) {
      this.hammer = buildHammer(anim.height);
      m.add(this.hammer.group);
      anim.prop = this.hammer.group; anim.hammerLen = this.hammer.len;
    }
    // a summoned giant's greatsword (Enra's Susanoo): two-handed on the hammer path, swung on the effigy's sweep tick
    if (sword && anim.ok) {
      this.hammer = fitGreatsword(sword, anim.height);
      m.add(this.hammer.group);
      anim.prop = this.hammer.group; anim.hammerLen = this.hammer.len;
    }
    // Tomoe: the great axe is posed on the hammer path while she swings it (Crescent Reaping, Tide of Blades) and rides
    // slung across her back the rest of the time
    if (id === 'tomoe' && anim.ok) {
      this.hammer = buildGreatAxe(anim.height);
      m.add(this.hammer.group);
      anim.prop = this.hammer.group; anim.hammerLen = this.hammer.len;
      const back = buildGreatAxe(anim.height);
      m.add(back.group); anim.back = back.group; this.backAxe = back.group;
    }
    // a pilot's sidearm rides in the right hand, barrel along the forearm (so it points where the arm aims)
    if (this.actor.def.gunProp && anim.ok && anim.bones.hand_R && anim.rest.hand_R) {
      const gun = buildBlaster(anim.height), r = anim.rest.hand_R;
      const Z = r.dir.clone().normalize(), up = Math.abs(Z.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const Xb = new THREE.Vector3().crossVectors(up, Z).normalize(), Yb = new THREE.Vector3().crossVectors(Z, Xb);
      const Qg = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xb, Yb, Z));
      const inv = r.q.clone().invert();
      gun.quaternion.copy(inv).multiply(Qg);
      gun.position.copy(Z.clone().multiplyScalar(anim.height * 0.06).add(Yb.clone().multiplyScalar(-anim.height * 0.035)).applyQuaternion(inv));
      gun.scale.setScalar(1.5);
      anim.bones.hand_R.add(gun);
    }
    this.attachGuns(anim, m);
    // foot thrusters (flight): additive flame cones placed under the feet while flying
    if (this.actor.def.jets && anim.ok) {
      for (let i = 0; i < 2; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1, 14, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        f.geometry.translate(0, -0.5, 0); f.rotation.x = Math.PI;          // base at the sole, tip pointing down
        f.visible = false; this.group.add(f); this.jets.push(f);
      }
    }
    // materials: keep the concept colours, add rim + a hint of emission for readability in dark maps
    this.collectMats();
    // mid-match arrivals (a hero swap, a pilot ejecting, a new wave, a summoned giant): textures uploaded and shaders
    // compiled before the body shows, so it never pops in half-ready or hitches the frame it first draws (Preload.ts) -
    // after the materials are set up, so the programs compiled are the ones drawn (a hologram's translucent variant)
    if (CharacterView.warm) { wrap.visible = false; void CharacterView.warm(wrap).finally(() => { if (this.model === wrap) wrap.visible = true; }); }
    // physics: the body colliders the hair / cloth solver pushes against, measured from this mesh by the rigger;
    // blinking: lids over the painted eyes the rigger found on the face
    const info = modelInfo(mid);
    anim.setBody(id, info?.colliders as Animator['colliders'] | undefined);
    this.lids?.dispose(); this.lids = null;
    this.eyeGlow?.dispose(); this.eyeGlow = null;
    if (info?.eyes?.length === 2 && anim.bones.head) this.lids = new Eyelids(m, anim.bones.head, info.eyes, BRIGHT_SUITS.has(id) ? 0.04 : 0.16);
    // masked heroes: the sockets glow in the hero's colour instead (manifest glowEyes, from blender/eyes.py)
    const glow = (info as { glowEyes?: EyeInfo[] } | undefined)?.glowEyes;
    if (glow?.length === 2 && anim.bones.head && FULL) this.eyeGlow = new EyeGlow(m, anim.bones.head, glow, this.actor.def.glow);
    // the costume's own hues, for skin palette remaps
    const map = (this.mats.find(mt => (mt as THREE.MeshStandardMaterial).map) as THREE.MeshStandardMaterial | undefined)?.map ?? null;
    const pal = analysePalette(map);
    if (pal) { this.look.zuSrc1.value.set(pal[0][0], pal[0][1]); this.look.zuSrc2.value.set(pal[1][0], pal[1][1]); }
    // bind-pose neck line (mesh space): skins recolour the costume, never the hair or face (mechs: the whole frame)
    if (this.actor.def.frame !== 'mech') {
      let y0 = Infinity, y1 = -Infinity;
      m.traverse(o => { const g = (o as THREE.Mesh).geometry; if ((o as THREE.Mesh).isMesh && g) { g.computeBoundingBox(); y0 = Math.min(y0, g.boundingBox!.min.y); y1 = Math.max(y1, g.boundingBox!.max.y); } });
      // the chin sits about halfway between the neck and head joints (tall hair makes a bounding-box ratio useless)
      const nk = anim.rest.neck?.p.y, hd = anim.rest.head?.p.y;
      if (Number.isFinite(y0)) {
        this.look.zuHeadY.value = nk !== undefined && hd !== undefined ? nk + (hd - nk) * 0.35 : y0 + (y1 - y0) * 0.8;
        this.look.zuHeadBand.value = (y1 - y0) * 0.012;
      }
    }
    for (const mt of this.mats) {
      const sm = mt as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) {
        // generated PBR maps carry noisy per-pixel metalness: it mirrors the environment in white/black blotches on
        // cloth and skin. Keep metal only on mechs (and even then subdued); everything is opaque.
        const mech = this.actor.def.frame === 'mech';
        // the generated metal/roughness texture is noise: uniform values per body type read far cleaner (cel-style)
        sm.metalnessMap = null; sm.roughnessMap = null;
        sm.metalness = mech ? 0.35 : 0.04;
        sm.roughness = mech ? 0.42 : 0.72;
        sm.transparent = false; sm.opacity = 1; sm.alphaTest = 0; sm.depthWrite = true; sm.alphaMap = null;
        // baked normal / AO maps from image-to-3D light in patches without proper tangents (Draco drops them)
        sm.normalMap = null; sm.aoMap = null; sm.bumpMap = null;
        // stray COLOR_0 vertex colours from the voxel reconstruction would tint the texture in blotches
        sm.vertexColors = false;
        // reconstructed surfaces can carry inverted faces; draw both sides so they never read as holes
        sm.side = THREE.DoubleSide;
        sm.envMapIntensity = 0.6;
        // a hint of self-light keeps dark heroes readable; near-white suits (Mirei) would bloom flat, so they get far less
        if (sm.map && !sm.emissiveMap) { sm.emissive = new THREE.Color(0xffffff); sm.emissiveMap = sm.map; sm.emissiveIntensity = BRIGHT_SUITS.has(this.actor.def.id) ? 0.04 : 0.16; }
        if (BRIGHT_SUITS.has(this.actor.def.id)) { sm.roughness = 0.55; sm.envMapIntensity = 0.45; }
        sm.needsUpdate = true;
      }
    }
  }

  /** model-space direction to whoever hit us last (x = the character's left, z = front) */
  /** Hayate's Mirror Water: the last turned shot (age, and the way it came from in model space) */
  private deflectState(time: number): { age: number; x: number; y: number; z: number } | undefined {
    const a = this.actor, age = time - a.anim.deflectAt;
    if (age > 0.3) return undefined;
    const d = a.anim.deflectDir, cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    return { age, x: d.x * cy - d.z * sy, y: d.y, z: d.x * sy + d.z * cy };
  }

  private hitDir(): [number, number] | undefined {
    const a = this.actor, b = a.lastHitBy;
    if (!b) return undefined;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, l = Math.hypot(dx, dz);
    if (l < 1e-3) return undefined;
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    return [(dx * cy - dz * sy) / l, (dx * sy + dz * cy) / l];
  }

  /** Tomoe has the great axe in her hands (a Crescent Reaping in flight, or the Crescent Warpath charge) */
  axeOut(time: number) {
    const a = this.actor, an = a.anim;
    return a.def.id === 'tomoe' && (a.forced?.kind === 'tide' || (an.castId === 'reaping' && time - an.castAt < REAP_SECS + REAP_STOP));
  }

  /** gameplay state -> animation state */
  private animState(dt: number, time: number): AnimState {
    const a = this.actor, an = a.anim;
    const p = a.def.primary;
    return {
      dt, time, vel: new THREE.Vector3(a.vel.x, a.vel.y, a.vel.z), yaw: a.yaw, pitch: a.pitch,
      // a swoop skimming the floor is still flight (no running gait at 20 m/s)
      grounded: a.grounded && !a.has('swoop', time), flying: a.flying || a.def.frame === 'drone', frame: a.def.frame,
      attackAge: time - an.attackAt, attackKind: an.attackKind, castAge: time - an.castAt, castId: an.castId, hitAge: time - an.hitAt,
      landAge: time - an.landAt, jumpAge: time - an.jumpAt, stunned: a.has('stun', time), charging: a.charging, parry: a.has('parry', time) || a.has('deflect', time), climb: a.has('wallclimb', time),
      deflect: this.deflectState(time),
      skyward: a.def.id === 'susanoo' && (a.sv.phase ?? 0) === 0,
      rebirth: a.def.id === 'mirei' && a.sv.rebirthAt !== undefined && time - a.sv.rebirthAt < 2.4 ? time - a.sv.rebirthAt : undefined,
      rising: a.has('rising', time) && a.sv.rebornAt !== undefined ? time - a.sv.rebornAt : undefined, charge: a.charge, beam: a.beamOn || a.flameOn,
      barrier: a.barrier.up, rooted: a.has('root', time), scale: this.scaleFit * a.scale, pos: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z),
      melee: a.def.primary.kind === 'melee' || (a.anim.attackKind === 'secondary' && 'kind' in a.def.secondary && a.def.secondary.kind === 'melee'),
      hammer: !!this.hammer && (a.def.id !== 'tomoe' || this.axeOut(time)), swingSide: an.attackSide, swingSecs: GIANT_SWING[a.def.id],
      move: a.forced?.kind === 'dawncharge' ? 'dawncharge' : an.castId === 'shatter' && time - an.castAt < 0.8 ? 'shatter'
        : a.forced?.kind === 'tide' ? 'tide' : an.castId === 'reaping' && time - an.castAt < REAP_SECS + REAP_STOP ? 'reaping' : a.flying && a.def.jets ? 'jets' : '',
      angel: a.def.id === 'mirei', gliding: a.has('angelglide', time),
      hero: a.def.id,
      hitDir: this.hitDir(), knocked: !!a.forced && (a.forced.kind === 'knock' || a.forced.kind === 'pull'),
      swoop: a.has('swoop', time) ? a.sv.swoopProg ?? 0 : -1, swoopFlare: a.has('swoopflare', time) ? 0.4 - (a.st.swoopflare - time) : 9,
      superjump: a.has('superjump', time), slingshot: a.has('slingshot', time), rush: a.has('tachiai', time),
      leap: a.has('stompair', time), knockdown: a.has('knockdown', time) ? Math.max(0, a.st.knockdown - time) : 0,
      tide: a.forced?.kind === 'tide' ? { age: Math.max(0, time - (a.sv.tideT0 ?? a.anim.castAt)) } : undefined,
      skate: a.def.id === 'hibiki', grind: a.has('grinding', time) ? (a.sv.grindSide ?? 1) : 0,
      dual: a.def.dualGuns ? { fireL: time - a.anim.fireL, fireR: time - a.anim.fireR } : undefined,
      reloadLeft: Math.max(0, (a.reloadUntil ?? 0) - time), reloadDur: 'reload' in p ? p.reload : undefined,
      attackTime: an.attackKind === 'primary' ? 1 / Math.max(0.1, p.rate) : 'rate' in a.def.secondary ? 1 / Math.max(0.1, a.def.secondary.rate) : 0.6,
    };
  }

  private ragdollable() {
    const a = this.actor, b = this.anim.bones;
    return FULL && this.anim.ok && a.def.frame !== 'mech' && a.def.frame !== 'drone' && !a.isBoss && !this.holo   // (a hologram fades, it doesn't fall)
      && ['hips', 'chest', 'head', 'upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']
        .every(n => b[n as keyof typeof b]);
  }

  /** runs the ragdoll while the hero is dead; false when this hero doesn't ragdoll (then the older deaths play) */
  private deathRagdoll(dt: number, time: number): boolean {
    const a = this.actor, age = time - a.deathAt;
    if (!this.ragdoll && !this.ragdollDone) {
      this.ragdollDone = true;
      if (!this.ragdollable() || age > 0.5) return false;
      this.group.updateMatrixWorld(true);
      const bones = this.anim.bones as Record<string, THREE.Object3D | undefined>;
      this.boneSnap = Object.values(bones).filter((o): o is THREE.Object3D => !!o).map(o => ({ o, p: o.position.clone(), q: o.quaternion.clone() }));
      // the killing blow: away from the killer, a little up, harder for a bigger hit (Overwatch's ragdolls fly)
      const fling = new THREE.Vector3();
      const k = a.lastHitBy && time - a.lastHitAt < 1 ? a.lastHitBy : null;
      if (k) {
        fling.set(a.pos.x - k.pos.x, 0, a.pos.z - k.pos.z);
        if (fling.lengthSq() < 1e-6) fling.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
        fling.normalize().setY(0.45).normalize().multiplyScalar(Math.min(9, 2.5 + (a.sv.lastHitDmg ?? 30) * 0.03));
      }
      const v = new THREE.Vector3(a.vel.x, a.vel.y, a.vel.z);
      this.ragdoll = new Ragdoll(bones, a.height * a.scale, v, fling, CharacterView.level, a.pos.y);
      this.ragdoll.onImpact = (at, speed) => this.onBodyFall?.(a, at, speed);
      this.hammerParent = this.hammer?.group.parent ?? null;
      this.hammer?.group.parent?.remove(this.hammer.group);
      if (this.backAxe) this.backAxe.visible = false;
      for (const j of this.jets) j.visible = false;
    }
    if (!this.ragdoll) return false;
    this.rim.value = 0;
    this.group.visible = age < 3.8;
    this.ragdoll.step(dt);
    // sinking into the floor before the respawn: the whole body lowers (a sleeping ragdoll costs nothing)
    this.inner.position.y = -Math.max(0, age - 2.6) * 0.6;
    if (!this.ragdoll.asleep) this.anim.placeGunsFromBones();
    this.lids?.update(time, a.anim.hitAt, true);
    this.eyeGlow?.update(time, a.anim.castAt, a.anim.hitAt, true);
    return true;
  }

  /** back to life: the skeleton the ragdoll threw around returns to its bind pose (the animator takes it from there) */
  private endRagdoll() {
    for (const s of this.boneSnap ?? []) { s.o.position.copy(s.p); s.o.quaternion.copy(s.q); }
    this.boneSnap = null; this.ragdoll = null; this.ragdollDone = false;
    if (this.hammer && !this.hammer.group.parent && this.hammerParent) this.hammerParent.add(this.hammer.group);
    this.hammerParent = null;
  }

  update(dt: number, time: number, viewer: { team: string; sees: (a: Actor) => boolean }) {
    const a = this.actor;
    this.look.zuTime.value = time;
    this.group.position.set(a.pos.x, a.pos.y, a.pos.z);
    this.group.rotation.y = a.yaw;
    this.inner.scale.setScalar(a.scale); this.inner.quaternion.identity(); this.inner.position.set(0, 0, 0);
    this.look.zuSmear.value.set(0, 0, 0);
    // fingers are local curls on the hands: independent of the body's pose source (procedural, clip, ragdoll)
    driveFingers(this.fingers, a, time, dt, { drawW: this.anim.drawW });
    // death: a ragdoll thrown by the killing blow (desktop), else a death clip when the library has one (the body
    // crumples, then sinks), else tip over and sink
    if (!a.alive && this.holo) {
      // a summon dismissed: the hologram fades out where it stands
      const k = Math.min(1, (time - a.deathAt) / 0.45);
      for (const m of this.mats) m.opacity = 0.82 * (1 - k);
      this.group.visible = k < 1;
      this.rim.value = 0;
      return;
    }
    if (!a.alive && this.deathRagdoll(dt, time)) return;
    if (a.alive && (this.ragdoll || this.ragdollDone)) this.endRagdoll();
    if (!a.alive && this.anim.clipDeath) {
      const age = time - a.deathAt;
      this.inner.rotation.x = 0;
      this.inner.position.y = -Math.max(0, age - 2.4) * 0.8;
      this.group.visible = age < 3.8;
      this.rim.value = 0;
      if (this.hammer) this.hammer.flame.visible = false;
      for (const j of this.jets) j.visible = false;
      this.anim.update({ ...this.animState(dt, time), vel: new THREE.Vector3(), dead: true, deathAge: age, grounded: true, flying: false });
      this.lids?.update(time, a.anim.hitAt, true);
      this.eyeGlow?.update(time, a.anim.castAt, a.anim.hitAt, true);
      return;
    }
    if (!a.alive) {
      const k = Math.min(1, (time - a.deathAt) / (a.def.frame === 'mech' ? 1.1 : 0.7));
      this.inner.rotation.x = -k * k * Math.PI / 2 * 0.95;
      this.inner.position.y = -Math.max(0, time - a.deathAt - 1.5) * 0.8;
      this.group.visible = time - a.deathAt < 3.5;
      this.rim.value = 0;
      return;
    }
    this.group.visible = true;
    // stealth: allies see a ghost, enemies a faint shimmer (or nothing)
    const stealth = a.has('stealth', time);
    const seen = viewer.sees(a);
    const alpha = stealth ? (a.team === viewer.team ? 0.35 : seen ? 0.25 : 0.04) : 1;
    if (stealth !== this.stealthed && !this.holo && !this.reborn) {
      this.stealthed = stealth;
      for (const m of this.mats) { m.transparent = stealth; m.depthWrite = !stealth; m.needsUpdate = true; }
    }
    if (stealth && !this.holo) for (const m of this.mats) m.opacity = alpha;
    // a teammate Mirei called back: a golden translucent figure for the guard, then solid (Overwatch's Resurrect)
    const reborn = a.has('reborn', time) && !this.holo;
    if (reborn !== this.reborn) {
      this.reborn = reborn;
      if (reborn) {
        this.rebornSnap = [];
        const gold = new THREE.Color('#ffe9a8');
        for (const mt of this.mats) {
          const m = mt as THREE.MeshStandardMaterial;
          if (!m.isMeshStandardMaterial) continue;
          this.rebornSnap.push({ m, color: m.color.getHex(), emissive: m.emissive.getHex(), ei: m.emissiveIntensity, tr: m.transparent, op: m.opacity, dw: m.depthWrite });
          m.color.copy(gold); m.emissive.copy(gold); m.emissiveIntensity = 0.7; m.transparent = true; m.opacity = 0.6; m.depthWrite = true; m.needsUpdate = true;
        }
      } else {
        for (const r of this.rebornSnap) { r.m.color.setHex(r.color); r.m.emissive.setHex(r.emissive); r.m.emissiveIntensity = r.ei; r.m.transparent = r.tr; r.m.opacity = r.op; r.m.depthWrite = r.dw; r.m.needsUpdate = true; }
        this.rebornSnap = [];
        this.onRebornSolid?.(a);
      }
    }
    if (reborn) this.rim.value = 1.4 + 0.4 * Math.sin(time * 6);
    if (this.holo) {
      // rising out of the ground over the rise window, then a slow pulse of the glow
      const rise = a.sv.riseUntil !== undefined && time < a.sv.riseUntil ? Math.max(0, (time - (a.sv.riseAt ?? time)) / Math.max(0.01, a.sv.riseUntil - (a.sv.riseAt ?? time))) : 1;
      const k = rise * rise * (3 - 2 * rise);
      for (const m of this.mats) m.opacity = 0.82 * Math.min(1, 0.2 + k);
      this.inner.position.y -= (1 - k) * a.height * 0.9;
      this.rim.value = 1.6 + 0.6 * Math.sin(time * 4);
    }
    const marked = a.has('revealed', time) || a.has('marked', time);
    if (!this.holo && !reborn) this.rim.value = a.team === viewer.team ? 0.25 : (marked ? 1.6 : 0.7);
    // cut by the Crescent Warpath ('tidemark'): the hero glows blue while weakened - for both teams
    const tided = a.has('tidemark', time);
    if (tided !== this.tideMarked) { this.tideMarked = tided; this.rimColor.set(tided ? TIDE_BLUE : a.team === viewer.team ? UI_COLORS.ally : UI_COLORS.enemy); }
    if (tided) this.rim.value = 2.1 + 0.5 * Math.sin(time * 5);
    if (a.has('spawnprot', time)) this.rim.value = 1.2 + Math.sin(time * 20) * 0.5;
    // shields bubble
    const sh = a.shieldAmt;
    this.shieldMesh.visible = sh > 1 || a.has('parry', time) || a.has('undying', time);
    if (this.shieldMesh.visible) {
      const r = a.height * 0.62;
      this.shieldMesh.scale.set(r * 0.8, r, r * 0.8);
      this.shieldMesh.position.y = a.height * 0.5;
      const m = this.shieldMesh.material as THREE.MeshBasicMaterial;
      m.color.set(a.has('parry', time) ? '#8ad8ff' : a.shields.some(s => s.kind === 'void') ? '#ff2244' : a.has('undying', time) ? '#ffe28a' : '#bfe8ff');
      m.opacity = 0.12 + 0.06 * Math.sin(time * 8);
    }
    if (this.barrierMesh) {
      this.barrierMesh.visible = a.barrier.up;
      const bm = this.barrierMesh.material as THREE.ShaderMaterial;
      bm.uniforms.t.value = time; bm.uniforms.hp.value = a.barrier.hp / a.barrier.max;
      // arc centred so its face sits 1.7m in front; grows with Tenkai-Oh's giant form
      this.barrierMesh.scale.setScalar(a.scale);
      this.barrierMesh.position.set(0, 1.9 * a.scale, (1.7 - 3.2) * a.scale);
    }
    // animation
    this.anim.update(this.animState(dt, time));
    if (this.anim.impact) this.onImpact?.(a);
    this.lids?.update(time, a.anim.hitAt, false);
    this.eyeGlow?.update(time, a.anim.castAt, a.anim.hitAt, false);
    // performance layer: squash & stretch (about the feet) and the whole-body tilt (about the hips)
    const an2 = this.anim, piv = a.height * 0.55;
    this.inner.scale.set(a.scale * an2.sqXZ, a.scale * an2.sqY, a.scale * an2.sqXZ);
    this.inner.quaternion.setFromEuler(new THREE.Euler(an2.tilt.pitch, 0, an2.tilt.roll, 'XZY'));
    _jp.set(0, piv, 0).applyQuaternion(this.inner.quaternion);
    this.inner.position.set(-_jp.x, piv - _jp.y, -_jp.z);
    // knocked flat: the whole body laid down about the feet along the push, its back on the ground; the body keeps the
    // facing it fell with (the aim may turn, a body on the floor doesn't spin)
    if (an2.down > 0) {
      if (this.downYaw === null) this.downYaw = a.yaw;
      let dy = this.downYaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.group.rotation.y = a.yaw + dy * Math.min(1, an2.down * 3);
      const th = an2.down * 1.5, d = an2.downDir;
      _kq.setFromAxisAngle(_kv.set(d.z, 0, -d.x).normalize(), th);          // up x the push
      this.inner.quaternion.premultiply(_kq);
      this.inner.position.applyQuaternion(_kq);
      this.inner.position.y += Math.sin(th) * a.height * a.scale * 0.09;
    } else this.downYaw = null;
    this.smear(time);
    this.updateGuns(dt, time);
    const an = a.anim;
    if (this.hammer && a.def.id !== 'tomoe' && !this.hammer.sword) {
      // rocket thruster: roars through the swing, the sun cores flare on impact
      const age = time - an.attackAt, on = an.attackKind === 'primary' && age > 0.12 && age < 0.45;   // fires on the strike, not the wind-up
      const f = this.hammer.flame;
      f.visible = on;
      if (on) f.scale.set(1, 0.5 + 0.9 * Math.sin(Math.min(1, (age - 0.12) / 0.33) * Math.PI) + Math.random() * 0.15, 1);
      this.hammer.core.emissiveIntensity = 2.4 + (on ? 3 * Math.max(0, 1 - Math.abs(age - 0.29) / 0.15) : 0) + (a.has('titan', time) ? 1.5 : 0);
    }
    if (a.def.frame === 'drone') this.model.rotation.z = Math.sin(time * 2 + a.id) * 0.1;
    if (this.jets.length) {
      const on = a.flying && !!a.def.jets;
      for (let i = 0; i < 2; i++) {
        const f = this.jets[i], b = this.anim.bones[i === 0 ? 'foot_L' : 'foot_R'];
        f.visible = on && !!b;
        if (!f.visible || !b) continue;
        b.getWorldPosition(_jp); this.group.worldToLocal(_jp);
        f.position.copy(_jp);
        const k = a.scale * (0.9 + Math.random() * 0.25) * (a.input.jumpHeld ? 1.5 : 1);
        f.scale.set(a.scale, k * 1.1, a.scale);
      }
    }
  }

  /** smear frames on fast moves: the trailing surfaces are dragged back along the velocity (mesh space) */
  private smear(time: number) {
    const a = this.actor, u = this.look.zuSmear.value as THREE.Vector3;
    const sp = Math.hypot(a.vel.x, a.vel.y, a.vel.z);
    // (a burst effect for dashes: sustained speed - Hibiki deep in the Groove - would streak the whole body)
    if (!FULL || this.noSmear || sp < SMEAR_FROM || !a.alive || a.has('rhythm', time)) { u.set(0, 0, 0); return; }
    let mesh: THREE.Object3D | null = null;
    this.model.traverse(o => { if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o; });
    if (!mesh) { u.set(0, 0, 0); return; }
    const amt = Math.min(0.28, (sp - SMEAR_FROM) / 14 * 0.28);          // metres of drag at the trailing edge (subtle: a hint, not a tear)
    _sv.set(-a.vel.x, -a.vel.y, -a.vel.z).multiplyScalar(amt / sp);
    // world -> mesh local (rotation and scale only)
    (mesh as THREE.Object3D).updateWorldMatrix(true, false);
    _m3.setFromMatrix4((mesh as THREE.Object3D).matrixWorld).invert();
    u.copy(_sv.applyMatrix3(_m3));
  }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !this.real) m.geometry.dispose(); });
  }
}
