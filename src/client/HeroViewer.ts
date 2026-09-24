// Hero viewer: studio-lit 3D turntable for every hero, villain, pilot and campaign colossus, with animation
// states (treadmill locomotion so the foot IK and spring physics can be inspected) and the skins locker.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HEROES, HERO, TEAM_NAME, isAbility, type HeroDef } from '../data/heroes';
import { BOSSES, ENEMIES } from '../campaign/data';
import { Actor } from '../game/Actor';
import { CharacterView } from '../render/CharacterView';
import { loadManifest, BASE } from '../render/Assets';
import { skinsFor, equipSkin, equippedSkin } from '../data/skins';
import { SWING_TIME } from '../render/Animator';
import { TITAN_SCALE } from '../game/World';
import { sfx } from '../audio/Sfx';

const EXTRA: HeroDef[] = [
  { ...HERO.tenkai, id: 'haruto', name: 'Haruto Daimon', title: "Tenkai-Oh's pilot", frame: 'human', height: 1.75, radius: 0.4, lore: HERO.tenkai.pilot!.bio, pilot: undefined },
  { ...HERO.gorgoth, id: 'vorn', name: 'Warlord Vorn', title: "Gorgoth's pilot", frame: 'human', height: 1.85, radius: 0.4, lore: HERO.gorgoth.pilot!.bio, pilot: undefined },
  { ...BOSSES.qelvaris, lore: "The Umbra Syndicate's alien scientist - builder of the space colossi in Operation Starfall." },
  ...(['boss_ironmaw', 'boss_reaper', 'boss_leviathan', 'boss_phoenix', 'boss_genesis'] as const).map(id => ({ ...BOSSES[id], lore: `Campaign colossus. Weak point: ${BOSSES[id].weak}.` })),
  ...Object.values(ENEMIES).map(e => ({ ...e, lore: `${e.title}: one of the Star-Forger's mass-produced robots in Operation Starfall.` })),
];
const ALL: Record<string, HeroDef> = Object.fromEntries([...HEROES, ...EXTRA].map(h => [h.id, h]));
type AnimMode = 'idle' | 'walk' | 'run' | 'attack' | 'alt' | 'melee' | 'cast' | 'ult' | 'jump' | 'fly' | 'hit';

export class HeroViewer {
  root: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
  view: CharacterView | null = null;
  actor: Actor | null = null;
  id = 'tenkai';
  mode: AnimMode = 'idle';
  yaw = 0.5; tilt = 0.12; zoom = 1; auto = true;
  private raf = 0; private t = 0; private last = performance.now();
  private drag: { x: number; y: number } | null = null;
  private tmpV = new THREE.Vector3();
  private stage: HTMLElement;
  // framing box of the posed model (model-local): drones / colossi are much wider than their nominal height
  private fit: { model: THREE.Object3D | null; minY: number; maxY: number; rad: number; age: number } = { model: null, minY: 0, maxY: 1, rad: 0.5, age: 0 };

  constructor(host: HTMLElement, private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'viewer';
    this.root.innerHTML = `
      <div class="vlist">
        <h3 class="zenith">${TEAM_NAME.zenith.toUpperCase()}</h3><div class="vrow">${HEROES.filter(h => h.team === 'zenith').map(h => this.chip(h)).join('')}</div>
        <h3 class="umbra">${TEAM_NAME.umbra.toUpperCase()}</h3><div class="vrow">${HEROES.filter(h => h.team === 'umbra').map(h => this.chip(h)).join('')}</div>
        <h3>PILOTS &amp; CAMPAIGN</h3><div class="vrow">${EXTRA.map(h => this.chip(h)).join('')}</div>
      </div>
      <div class="vstage"><div class="vname"></div>
        <div class="vanims">${(['idle', 'walk', 'run', 'attack', 'alt', 'melee', 'cast', 'ult', 'jump', 'fly', 'hit'] as AnimMode[]).map(m => `<button data-a="${m}">${m === 'alt' ? 'ALT' : m === 'melee' ? 'MELEE (C)' : m.toUpperCase()}</button>`).join('')}<button class="spin">⟳ AUTO</button></div>
        <div class="vhint">Drag to rotate · wheel to zoom · double-click to reset</div></div>
      <div class="vside"><div class="vskins"></div><div class="vinfo"></div><button class="vback">BACK</button></div>`;
    host.append(this.root);
    this.stage = this.root.querySelector('.vstage') as HTMLElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.stage.prepend(this.renderer.domElement);
    this.buildStudio();
    this.bind();
    loadManifest().then(() => this.select(this.id));
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  private chip(h: HeroDef) {
    return `<button class="vchip" data-h="${h.id}" style="--c:${h.color}"><img src="${BASE}img/portrait_${h.id.replace(/^boss_/, 'boss_')}.webp" onerror="this.src='${BASE}img/key_${h.id}.webp';this.onerror=null"><span>${h.name}</span></button>`;
  }

  private buildStudio() {
    const s = this.scene;
    s.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.7;
    s.add(new THREE.HemisphereLight('#dfe8ff', '#20242e', 1.1));
    const key = new THREE.DirectionalLight('#fff4e6', 2.6); key.position.set(3, 6, 4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -12, right: 12, top: 20, bottom: -2, near: 0.5, far: 60 });
    const rim = new THREE.DirectionalLight('#7fb8ff', 2.2); rim.position.set(-4, 5, -5);
    const fill = new THREE.DirectionalLight('#ffd2e6', 0.7); fill.position.set(-5, 2, 4);
    s.add(key, key.target, rim, fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.66, 96), new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; ring.name = 'ring'; s.add(ring);
  }

  private bind() {
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY }; this.auto = false; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      if (!this.drag) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.01; this.tilt = Math.max(-0.25, Math.min(0.9, this.tilt + (e.clientY - this.drag.y) * 0.005));
      this.drag = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointerup', () => { this.drag = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.max(0.3, Math.min(2.2, this.zoom * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
    c.addEventListener('dblclick', () => { this.yaw = 0.5; this.tilt = 0.12; this.zoom = 1; this.auto = true; });
    this.root.querySelectorAll<HTMLElement>('.vchip').forEach(b => b.onclick = () => { sfx.play('ui_click'); this.select(b.dataset.h!); });
    this.root.querySelectorAll<HTMLElement>('[data-a]').forEach(b => b.onclick = () => { this.setMode(b.dataset.a as AnimMode); });
    (this.root.querySelector('.spin') as HTMLElement).onclick = () => { this.auto = !this.auto; };
    (this.root.querySelector('.vback') as HTMLElement).onclick = () => this.close();
  }

  private setMode(m: AnimMode) {
    this.mode = m; this.t = 0;
    if (this.actor) { this.actor.scale = 1; this.actor.clear('titan'); }
    this.root.querySelectorAll<HTMLElement>('[data-a]').forEach(b => b.classList.toggle('on', b.dataset.a === m));
  }

  select(id: string) {
    this.id = id;
    const def = ALL[id];
    if (this.view) { this.scene.remove(this.view.group); this.view.dispose(); }
    const a = new Actor(def, def.team);
    a.isPlayer = true; a.grounded = true;
    this.actor = a;
    this.view = new CharacterView(a, def.team, equippedSkin(id));
    this.scene.add(this.view.group);
    this.root.querySelectorAll<HTMLElement>('.vchip').forEach(b => b.classList.toggle('sel', b.dataset.h === id));
    (this.root.querySelector('.vname') as HTMLElement).innerHTML = `<b style="color:${def.color}">${def.name}</b><small>${def.title}</small>`;
    (this.root.querySelector('.vring') as HTMLElement | null);
    const ring = this.scene.getObjectByName('ring') as THREE.Mesh; ring.scale.setScalar(Math.max(1, def.radius * 1.6));
    this.renderSkins(); this.renderInfo(def);
    this.setMode('idle');
  }

  private renderSkins() {
    const def = ALL[this.id], wrap = this.root.querySelector('.vskins') as HTMLElement;
    if (!HERO[this.id]) { wrap.innerHTML = '<h4>SKINS</h4><p class="dim">Skins are available for the ten playable heroes.</p>'; return; }
    const eq = equippedSkin(this.id);
    const cur = this.view!.skin.id;
    wrap.innerHTML = `<h4>SKINS</h4>` + skinsFor(this.id, def.team).map(s => `<button class="skin r-${s.rarity.toLowerCase()} ${s.id === cur ? 'sel' : ''}" data-s="${s.id}"><i style="background:linear-gradient(135deg, ${s.tintAmt ? s.tint : def.color}, ${s.pattern ? s.patternColor : '#222'})"></i><span>${s.name}<small>${s.rarity}${s.id === eq ? ' · EQUIPPED' : ''}</small></span></button>`).join('')
      + `<button class="primary equip">EQUIP SELECTED</button>`;
    wrap.querySelectorAll<HTMLElement>('.skin').forEach(b => b.onclick = () => { this.view!.setSkin(b.dataset.s!); sfx.play('ui_click'); this.renderSkins(); });
    (wrap.querySelector('.equip') as HTMLElement).onclick = () => { equipSkin(this.id, this.view!.skin.id); sfx.play('capture'); this.renderSkins(); };
  }

  private renderInfo(d: HeroDef) {
    const info = this.root.querySelector('.vinfo') as HTMLElement;
    const S = d.secondary;
    const row = (k: string, n: string, t: string, c?: string) => `<div class="vab"><kbd>${k}</kbd><div><b>${n}</b><p>${t}</p>${c ? `<p class="ctr">⚔ ${c}</p>` : ''}</div></div>`;
    info.innerHTML = `<p class="vmeta">${HERO[d.id] ? `${TEAM_NAME[d.team]} · ${d.role.toUpperCase()} · ${d.hp + d.armor} HP${d.frame === 'mech' ? ' · MECHA' : ''}${d.frame === 'flyer' ? ' · FLYER' : ''}` : 'Non-playable'}</p><p class="lore">${d.lore}</p>`
      + (HERO[d.id] ? row('RMB', isAbility(S) ? S.name : S.heal ? 'Healing' : 'Alt fire', isAbility(S) ? S.desc : `${S.damage}`, isAbility(S) ? S.counter : undefined)
        + row('SHIFT', d.ability1.name, d.ability1.desc, d.ability1.counter) + row('E', d.ability2.name, d.ability2.desc, d.ability2.counter) + row('Q', d.ult.name, d.ult.desc) : '');
  }

  private frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (this.renderer.domElement.width !== Math.floor(w * this.renderer.getPixelRatio())) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    const a = this.actor, v = this.view;
    if (!a || !v) return;
    this.t += dt;
    if (this.auto) this.yaw += dt * 0.35;
    // drive the actor state for the chosen animation (treadmill: the actor walks, the stage keeps it centred)
    const m = this.mode, T = this.t;
    const speed = m === 'walk' ? a.def.speed * 0.45 : m === 'run' || m === 'fly' ? a.def.speed : 0;
    a.yaw = 0; a.input.yaw = 0; a.pitch = 0;
    a.vel = { x: 0, y: 0, z: speed };
    a.pos.z += speed * dt;
    a.grounded = m !== 'jump' && m !== 'fly'; a.flying = m === 'fly' && (a.def.frame === 'flyer' || a.def.frame === 'drone');
    if (m === 'jump') { const p = (T % 1.2) / 1.2; a.pos.y = Math.sin(p * Math.PI) * 1.4; a.vel.y = Math.cos(p * Math.PI) * 6; a.grounded = p > 0.97; if (p < 0.05) a.anim.jumpAt = T; if (p > 0.97) a.anim.landAt = T; }
    else if (m === 'fly') { a.pos.y = 1.2 + Math.sin(T * 1.5) * 0.2; a.vel.y = Math.cos(T * 1.5) * 0.3; }
    else a.pos.y = 0;
    const swingEvery = a.def.primary.sweep ? SWING_TIME + 0.1 : 0.6;
    if (m === 'attack' && T % swingEvery < dt) { a.anim.attackAt = T; a.anim.attackKind = 'primary'; a.anim.attackSide = -a.anim.attackSide; }
    if (m === 'melee' && T % 0.9 < dt) { a.anim.attackAt = T; a.anim.attackKind = 'punch'; }
    if (m === 'ult') {
      // Tenkai-Oh previews the giant form; everyone else plays their ult cast
      if (a.def.ult.id === 'colossus') { a.set('titan', T, 9999); a.scale += (TITAN_SCALE - a.scale) * Math.min(1, dt * 2.6); }
      else if (T % 1.6 < dt) { a.anim.castAt = T; a.anim.castId = a.def.ult.id; }
    }
    if (m === 'alt' && T % 1.1 < dt) { a.anim.attackAt = T; a.anim.attackKind = 'secondary'; }
    if (m === 'cast' && T % 1.4 < dt) a.anim.castAt = T;
    if (m === 'hit' && T % 0.8 < dt) a.anim.hitAt = T;
    a.charging = false; a.beamOn = false;
    v.update(dt, T, { team: a.team, sees: () => true });
    v.group.position.set(0, a.pos.y, 0);         // keep the model on the turntable
    v.group.rotation.y = 0;
    v.rim.value = 0;
    // camera orbit around the model, distance fitted to the posed bounds (whole body + wings in frame, feet clear of
    // the animation buttons along the bottom of the stage)
    const H = a.height, F0 = this.measure(v, dt), ks = a.scale;
    const F = { minY: F0.minY * ks, maxY: F0.maxY * ks, rad: F0.rad * ks };
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fh = F.maxY - F.minY;
    const fitR = Math.max(fh / 0.74, (2.25 * F.rad) / Math.max(0.5, this.camera.aspect)) / (2 * tanH) + F.rad * 0.5;
    const r = Math.max(2.4, fitR) * this.zoom;
    const vh = 2 * tanH * Math.max(2.4, fitR);
    const cx = Math.sin(this.yaw) * Math.cos(this.tilt) * r, cz = Math.cos(this.yaw) * Math.cos(this.tilt) * r;
    // zooming in drifts the focus up to the face
    // the close-up frames the head bone itself (crowns, horns and hair make "a fraction of the height" miss the face)
    const zk = Math.max(0, Math.min(1, (1 - this.zoom) / 0.65));
    let headY = H * 0.9;
    const hb = v.anim.bones.head;
    if (hb) { hb.getWorldPosition(this.tmpV); headY = this.tmpV.y + H * 0.04 - v.group.position.y; }
    const body = Math.max(F.minY + vh * 0.31, (F.minY + F.maxY) / 2);
    const focus = body * (1 - zk) + headY * zk + (m === 'fly' ? 1.2 : 0);
    this.camera.position.set(cx, focus + Math.sin(this.tilt) * r, cz);
    this.camera.lookAt(0, focus, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /** posed bounds of the current model, re-measured when it swaps (mannequin -> GLB) and settled after the first frames */
  private measure(v: CharacterView, dt: number) {
    const F = this.fit;
    if (F.model !== v.model) { F.model = v.model; F.age = 0; }
    F.age += dt;
    if (F.age < 0.6) {
      const box = new THREE.Box3(), bb = new THREE.Box3();
      v.group.updateWorldMatrix(true, true);
      v.model.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        if ((m as THREE.SkinnedMesh).isSkinnedMesh) (m as THREE.SkinnedMesh).computeBoundingBox();
        else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        bb.copy((m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh).boundingBox! : m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
        box.union(bb);
      });
      if (!box.isEmpty()) {
        const gy = v.group.position.y;
        // stored at scale 1 (the frame multiplies by the actor's current scale: Tenkai-Oh's giant preview)
        const ks = this.actor!.scale;
        F.minY = Math.min(0, box.min.y - gy) / ks; F.maxY = (box.max.y - gy) / ks;
        F.rad = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z, 0.3) / ks;
        const ring = this.scene.getObjectByName('ring') as THREE.Mesh;
        ring.scale.setScalar(Math.max(1, this.actor!.def.radius * 1.6, F.rad * 0.8));
      }
    }
    return F;
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.view?.dispose();
    this.renderer.dispose();
    this.root.remove();
    this.onClose();
  }
}
