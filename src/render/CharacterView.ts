// Visual for one actor: rigged GLB (or a same-skeleton mannequin while it loads / if missing), procedural animation,
// team rim light, stealth fade, shields, Solar Bulwark, death collapse.
import * as THREE from 'three';
import type { Actor } from '../game/Actor';
import { Animator, type AnimState } from './Animator';
import { heroModel } from './Assets';
import { animLib, animLibrary } from './ClipLibrary';
import { buildHammer, buildBlaster, type HammerProp } from './Hammer';

const BRIGHT_SUITS = new Set(['mirei']);
const _jp = new THREE.Vector3();
import { skinsFor, type Skin } from '../data/skins';

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
    sh.vertexShader = 'varying vec3 zuWorld; varying float zuBindY;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nzuWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; zuBindY = position.y;');
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

export class CharacterView {
  group = new THREE.Group();            // world transform (position + yaw)
  inner = new THREE.Group();            // death tilt / squash
  model: THREE.Object3D;
  anim: Animator;
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
  /** the hero this view was built for: the World swaps defs (mech <-> pilot), and the view is rebuilt then */
  defId: string;
  jets: THREE.Mesh[] = [];
  private stealthed = false;
  onStep: ((a: Actor, side: number, heavy: boolean) => void) | null = null;

  constructor(public actor: Actor, public viewerTeam: string, skinId = 'classic') {
    this.defId = actor.def.id;
    this.rimColor = new THREE.Color(actor.team === viewerTeam ? '#5cc8ff' : '#ff3b5c');
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
    this.loadReal();
  }

  setSkin(id: string) {
    const s = skinsFor(this.actor.def.id, this.actor.def.team).find(x => x.id === id);
    if (s) { this.skin = s; applySkin(this.look, s); }
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
  }

  private fitMannequin() { this.scaleFit = 1; this.model.scale.setScalar(1); }

  private async loadReal() {
    const id = this.actor.def.id;
    const m = await heroModel(id);
    if (!m) return;
    // normalise: feet on the ground, height = hero height (the rig script already faces +Z)
    const box = new THREE.Box3().setFromObject(m);
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
    this.scaleFit = s;
    this.real = true;
    this.hookStep();
    this.attachClips();
    // two-handed hammer heroes carry a real weapon: a model-space prop the animator poses along the swing path
    if (this.actor.def.primary.sweep && anim.ok) {
      this.hammer = buildHammer(anim.height);
      m.add(this.hammer.group);
      anim.prop = this.hammer.group; anim.hammerLen = this.hammer.len;
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

  /** gameplay state -> animation state */
  private animState(dt: number, time: number): AnimState {
    const a = this.actor, an = a.anim;
    const p = a.def.primary;
    return {
      dt, time, vel: new THREE.Vector3(a.vel.x, a.vel.y, a.vel.z), yaw: a.yaw, pitch: a.pitch,
      grounded: a.grounded, flying: a.flying || a.def.frame === 'drone', frame: a.def.frame,
      attackAge: time - an.attackAt, attackKind: an.attackKind, castAge: time - an.castAt, castId: an.castId, hitAge: time - an.hitAt,
      landAge: time - an.landAt, jumpAge: time - an.jumpAt, stunned: a.has('stun', time), charging: a.charging, beam: a.beamOn || a.flameOn,
      barrier: a.barrier.up, rooted: a.has('root', time), scale: this.scaleFit * a.scale, pos: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z),
      melee: a.def.primary.kind === 'melee' || (a.anim.attackKind === 'secondary' && 'kind' in a.def.secondary && a.def.secondary.kind === 'melee'),
      hammer: !!this.hammer, swingSide: an.attackSide,
      move: a.forced?.kind === 'dawncharge' ? 'dawncharge' : an.castId === 'shatter' && time - an.castAt < 0.8 ? 'shatter' : a.flying && a.def.jets ? 'jets' : '',
      angel: a.def.id === 'mirei', gliding: a.has('angelglide', time),
      reloadLeft: Math.max(0, (a.reloadUntil ?? 0) - time), reloadDur: 'reload' in p ? p.reload : undefined,
      attackTime: an.attackKind === 'primary' ? 1 / Math.max(0.1, p.rate) : 'rate' in a.def.secondary ? 1 / Math.max(0.1, a.def.secondary.rate) : 0.6,
    };
  }

  update(dt: number, time: number, viewer: { team: string; sees: (a: Actor) => boolean }) {
    const a = this.actor;
    this.look.zuTime.value = time;
    this.group.position.set(a.pos.x, a.pos.y, a.pos.z);
    this.group.rotation.y = a.yaw;
    this.inner.scale.setScalar(a.scale);
    // death: a death clip when the library has one (the body crumples, then sinks), else tip over and sink
    if (!a.alive && this.anim.clipDeath) {
      const age = time - a.deathAt;
      this.inner.rotation.x = 0;
      this.inner.position.y = -Math.max(0, age - 2.4) * 0.8;
      this.group.visible = age < 3.8;
      this.rim.value = 0;
      if (this.hammer) this.hammer.flame.visible = false;
      for (const j of this.jets) j.visible = false;
      this.anim.update({ ...this.animState(dt, time), vel: new THREE.Vector3(), dead: true, deathAge: age, grounded: true, flying: false });
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
    this.inner.rotation.x = 0; this.inner.position.y = 0;
    // stealth: allies see a ghost, enemies a faint shimmer (or nothing)
    const stealth = a.has('stealth', time);
    const seen = viewer.sees(a);
    const alpha = stealth ? (a.team === viewer.team ? 0.35 : seen ? 0.25 : 0.04) : 1;
    if (stealth !== this.stealthed) {
      this.stealthed = stealth;
      for (const m of this.mats) { m.transparent = stealth; m.depthWrite = !stealth; m.needsUpdate = true; }
    }
    if (stealth) for (const m of this.mats) m.opacity = alpha;
    const marked = a.has('revealed', time) || a.has('marked', time);
    this.rim.value = a.team === viewer.team ? 0.25 : (marked ? 1.6 : 0.7);
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
    const an = a.anim;
    if (this.hammer) {
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

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !this.real) m.geometry.dispose(); });
  }
}
