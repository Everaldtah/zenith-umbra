// Visual for one actor: rigged GLB (or a same-skeleton mannequin while it loads / if missing), procedural animation,
// team rim light, stealth fade, shields, Solar Bulwark, death collapse.
import * as THREE from 'three';
import type { Actor } from '../game/Actor';
import { Animator } from './Animator';
import { heroModel } from './Assets';
import { buildHammer, type HammerProp } from './Hammer';

const BRIGHT_SUITS = new Set(['mirei']);
import { skinsFor, type Skin } from '../data/skins';

const rimChunk = `
  float zuRim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.5);
  totalEmissiveRadiance += zuRimColor * zuRim * zuRimStrength;
  // legendary / epic skins: flowing energy lines across the body
  if (zuPattern > 0.0) {
    float band = sin(zuWorld.y * 7.0 - zuTime * 3.0 + sin(zuWorld.x * 3.0 + zuWorld.z * 2.0) * 1.5);
    float line = smoothstep(0.93, 1.0, band) * zuPattern;
    totalEmissiveRadiance += zuPatternColor * (line * 1.6 + zuGlow * 0.35 * zuRim);
  }
`;
const skinChunk = `
  // skin recolour of the painted texture: hue rotate, saturation/value, tint
  {
    vec3 c = diffuseColor.rgb;
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
    float h = 0.0;
    if (d > 1e-4) { if (mx == c.r) h = mod((c.g - c.b) / d, 6.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0; h /= 6.0; }
    float s = mx > 0.0 ? d / mx : 0.0, v = mx;
    h = fract(h + zuHue); s = clamp(s * zuSat, 0.0, 1.0); v = clamp(v * zuVal, 0.0, 1.0);
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
    vec3 rgb = v - v * s * clamp(min(k, 4.0 - k), 0.0, 1.0);
    diffuseColor.rgb = mix(rgb, rgb * zuTint * 1.6, zuTintAmt);
  }
`;

export interface LookUniforms { [k: string]: { value: any } }
export function lookUniforms(rim: THREE.Color): LookUniforms {
  return {
    zuRimColor: { value: rim }, zuRimStrength: { value: 0 }, zuHue: { value: 0 }, zuSat: { value: 1 }, zuVal: { value: 1 },
    zuTint: { value: new THREE.Color('#ffffff') }, zuTintAmt: { value: 0 }, zuGlow: { value: 0 }, zuPattern: { value: 0 },
    zuPatternColor: { value: new THREE.Color('#ffffff') }, zuTime: { value: 0 },
  };
}
export function applySkin(u: LookUniforms, s: Skin) {
  u.zuHue.value = s.hue / 360; u.zuSat.value = s.sat; u.zuVal.value = s.val;
  u.zuTint.value.set(s.tint); u.zuTintAmt.value = s.tintAmt; u.zuGlow.value = s.glow;
  u.zuPattern.value = s.pattern; u.zuPatternColor.value.set(s.patternColor);
}

/** inject rim light + skin recolour into a (per-instance) standard material */
export function addLook(mat: THREE.Material, u: LookUniforms) {
  const m = mat as THREE.MeshStandardMaterial;
  if ((m as any).__look) return;
  (m as any).__look = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 zuWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nzuWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 zuRimColor; uniform float zuRimStrength; uniform float zuHue; uniform float zuSat; uniform float zuVal; uniform vec3 zuTint; uniform float zuTintAmt; uniform float zuGlow; uniform float zuPattern; uniform vec3 zuPatternColor; uniform float zuTime;\nvarying vec3 zuWorld;\n'
      + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + skinChunk).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + rimChunk);
  };
  m.customProgramCacheKey = () => 'zulook';
  m.needsUpdate = true;
}

// ---------------------------------------------------------------- fallback mannequin (same bone names as the Blender rig)
function mannequin(a: Actor): THREE.Object3D {
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
  private stealthed = false;
  onStep: ((a: Actor, side: number, heavy: boolean) => void) | null = null;

  constructor(public actor: Actor, public viewerTeam: string, skinId = 'classic') {
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
    // two-handed hammer heroes carry a real weapon: a model-space prop the animator poses along the swing path
    if (this.actor.def.primary.sweep && anim.ok) {
      this.hammer = buildHammer(anim.height);
      m.add(this.hammer.group);
      anim.prop = this.hammer.group; anim.hammerLen = this.hammer.len;
    }
    // materials: keep the concept colours, add rim + a hint of emission for readability in dark maps
    this.collectMats();
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

  update(dt: number, time: number, viewer: { team: string; sees: (a: Actor) => boolean }) {
    const a = this.actor;
    this.look.zuTime.value = time;
    this.group.position.set(a.pos.x, a.pos.y, a.pos.z);
    this.group.rotation.y = a.yaw;
    this.inner.scale.setScalar(a.scale);
    // death: tip over and sink
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
    const an = a.anim;
    this.anim.update({
      dt, time, vel: new THREE.Vector3(a.vel.x, a.vel.y, a.vel.z), yaw: a.yaw, pitch: a.pitch,
      grounded: a.grounded, flying: a.flying || a.def.frame === 'drone', frame: a.def.frame,
      attackAge: time - an.attackAt, attackKind: an.attackKind, castAge: time - an.castAt, castId: an.castId, hitAge: time - an.hitAt,
      landAge: time - an.landAt, jumpAge: time - an.jumpAt, stunned: a.has('stun', time), charging: a.charging, beam: a.beamOn || a.flameOn,
      barrier: a.barrier.up, rooted: a.has('root', time), scale: this.scaleFit * a.scale, pos: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z),
      melee: a.def.primary.kind === 'melee' || (a.anim.attackKind === 'secondary' && 'kind' in a.def.secondary && a.def.secondary.kind === 'melee'),
      hammer: !!this.hammer, swingSide: an.attackSide,
      angel: a.def.id === 'mirei', gliding: a.has('angelglide', time),
    });
    if (this.hammer) {
      // rocket thruster: roars through the swing, the sun cores flare on impact
      const age = time - an.attackAt, on = an.attackKind === 'primary' && age > 0.12 && age < 0.45;   // fires on the strike, not the wind-up
      const f = this.hammer.flame;
      f.visible = on;
      if (on) f.scale.set(1, 0.5 + 0.9 * Math.sin(Math.min(1, (age - 0.12) / 0.33) * Math.PI) + Math.random() * 0.15, 1);
      this.hammer.core.emissiveIntensity = 2.4 + (on ? 3 * Math.max(0, 1 - Math.abs(age - 0.29) / 0.15) : 0) + (a.has('titan', time) ? 1.5 : 0);
    }
    if (a.def.frame === 'drone') this.model.rotation.z = Math.sin(time * 2 + a.id) * 0.1;
  }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !this.real) m.geometry.dispose(); });
  }
}
