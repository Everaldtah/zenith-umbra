// Blinking: the heroes' eyes are painted into their textures, so each eye gets a small lid - a patch in the face's skin
// tone with a lash line along its lower edge - hung from the head bone just in front of the painted eye. It drops from
// the upper lid to cover the eye and lifts again. Eye centre, size, facing and the lid / lash colours come from the
// model itself (assetgen/blender/eyes.py: MediaPipe face landmarks on a front render, raycast onto the mesh).
// Timing follows how people blink: every 2-6 s, ~150 ms, a double blink now and then; a squeeze when hit; shut in death.
import * as THREE from 'three';
import type { EyeInfo } from './Assets';

const lidTexture = (skin: THREE.Color, lash: THREE.Color) => {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${skin.getHexString(THREE.SRGBColorSpace)}`; g.fillRect(0, 0, 32, 32);
  // soft crease shading under the brow, then the lash line along the bottom edge (slightly curved, thick at the outer corner)
  const gr = g.createLinearGradient(0, 0, 0, 32); gr.addColorStop(0, 'rgba(0,0,0,0.10)'); gr.addColorStop(0.6, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  g.fillStyle = `#${lash.getHexString(THREE.SRGBColorSpace)}`;
  g.beginPath(); g.moveTo(0, 25); g.quadraticCurveTo(16, 31, 32, 23); g.lineTo(32, 32); g.lineTo(0, 32); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export class Eyelids {
  private lids: THREE.Mesh[] = [];
  private next = 1 + Math.random() * 4;
  private blinkAt = -9;
  private double = false;
  private lastHit = -9;

  /** model: the hero's GLB scene (the space eyes.py measured in); head: its head bone */
  constructor(model: THREE.Object3D, head: THREE.Object3D, eyes: EyeInfo[], emissive: number) {
    model.updateMatrixWorld(true);
    const headInModel = model.matrixWorld.clone().invert().multiply(head.matrixWorld);
    const toHead = headInModel.clone().invert();
    for (const e of eyes) {
      const skin = new THREE.Color().setRGB(e.skin[0], e.skin[1], e.skin[2], THREE.SRGBColorSpace);
      const lash = new THREE.Color().setRGB(e.lash[0], e.lash[1], e.lash[2], THREE.SRGBColorSpace);
      const map = lidTexture(skin, lash);
      const mat = new THREE.MeshStandardMaterial({ map, emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: emissive, roughness: 0.72, metalness: 0.04,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      // a gently curved patch (so its corners tuck into the face), pivot along the top edge: scale.y = how far it has closed
      const geo = new THREE.PlaneGeometry(1, 1, 6, 1);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, -0.35 * x * x); }
      geo.translate(0, -0.5, 0);
      geo.computeVertexNormals();
      const lid = new THREE.Mesh(geo, mat);
      lid.frustumCulled = false; lid.castShadow = false;
      // model-space frame: facing the eye's normal, up = model up, the top edge on the upper lid
      const n = new THREE.Vector3(e.n[0], e.n[1], e.n[2]); n.y *= 0.3; n.normalize();
      const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize(), y = new THREE.Vector3().crossVectors(n, x);
      const top = new THREE.Vector3(e.p[0], e.p[1], e.p[2]).addScaledVector(y, e.h * 0.62).addScaledVector(n, Math.max(0.0018, e.w * 0.07));
      const mm = new THREE.Matrix4().makeBasis(x, y, n).setPosition(top).scale(new THREE.Vector3(e.w * 1.35, e.h * 1.3, 1));
      const local = toHead.clone().multiply(mm);
      local.decompose(lid.position, lid.quaternion, lid.scale);
      lid.userData.sy = lid.scale.y;
      lid.visible = false;
      head.add(lid);
      this.lids.push(lid);
    }
  }

  /** closed amount (0 open .. 1 shut) this frame */
  private closed(time: number, hitAt: number, dead: boolean) {
    if (dead) return 1;
    if (time >= this.next) { this.blinkAt = time; this.double = Math.random() < 0.18; this.next = time + 2 + Math.random() * 4; }
    const b = (t0: number) => { const u = (time - t0) / 0.15; return u < 0 || u > 1 ? 0 : u < 0.4 ? u / 0.4 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45; };
    let c = Math.max(b(this.blinkAt), this.double ? b(this.blinkAt + 0.22) : 0);
    // flinch: a hard squeeze on a fresh hit
    if (hitAt > this.lastHit) this.lastHit = hitAt;
    const ha = time - this.lastHit;
    if (ha >= 0 && ha < 0.28) c = Math.max(c, 0.85 * (1 - ha / 0.28));
    return c;
  }

  /** alpha: how opaque the body is drawn (a cloaked hero's lids fade with it) */
  update(time: number, hitAt: number, dead: boolean, alpha = 1) {
    const c = this.closed(time, hitAt, dead);
    for (const l of this.lids) {
      l.visible = c > 0.03 && alpha > 0.01;
      l.scale.y = l.userData.sy * Math.max(0.03, c);
      const m = l.material as THREE.MeshStandardMaterial, tr = alpha < 1;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = alpha;
    }
  }

  dispose() { for (const l of this.lids) { l.parent?.remove(l); (l.material as THREE.MeshStandardMaterial).map?.dispose(); (l.material as THREE.Material).dispose(); l.geometry.dispose(); } }
}


/**
 * Masked heroes' eyes (Hex's porcelain mask, Kagemaru's skull): a glow in each dark socket instead of a blink - the
 * read Overwatch gives its masked characters. Camera-facing additive sprites hung from the head bone just inside the
 * socket (the mask hides them from behind), breathing slowly, flaring on a cast or a hit, dark in death.
 */
export class EyeGlow {
  private sprites: THREE.Sprite[] = [];
  private flare = 0;
  private lastCast = -9;
  private lastHit = -9;

  constructor(model: THREE.Object3D, head: THREE.Object3D, eyes: EyeInfo[], color: string) {
    model.updateMatrixWorld(true);
    const toHead = model.matrixWorld.clone().invert().multiply(head.matrixWorld).invert();
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!, col = new THREE.Color(color);
    const rgb = (a: number, k = 1) => `rgba(${Math.round(Math.min(255, col.r * 255 * k))},${Math.round(Math.min(255, col.g * 255 * k))},${Math.round(Math.min(255, col.b * 255 * k))},${a})`;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, rgb(1, 1.4)); gr.addColorStop(0.45, rgb(0.55)); gr.addColorStop(1, rgb(0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    for (const e of eyes) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
      const sp = new THREE.Sprite(mat);
      const n = new THREE.Vector3(e.n[0], e.n[1], e.n[2]).normalize();
      // just in front of the socket (the sockets are painted, not holes): the head still hides it from behind
      const at = new THREE.Vector3(e.p[0], e.p[1], e.p[2]).addScaledVector(n, e.w * 0.35).applyMatrix4(toHead);
      sp.position.copy(at);
      const s0 = e.w * 2.6;
      sp.scale.set(s0, s0, 1); sp.userData.s0 = s0;
      sp.frustumCulled = false; sp.renderOrder = 2;
      head.add(sp);
      this.sprites.push(sp);
    }
  }

  /** alpha: how opaque the body is drawn (a cloaked hero's eyes fade with it) */
  update(time: number, castAt: number, hitAt: number, dead: boolean, alpha = 1) {
    if (castAt > this.lastCast) { this.lastCast = castAt; this.flare = 1; }
    if (hitAt > this.lastHit) { this.lastHit = hitAt; this.flare = Math.max(this.flare, 0.5); }
    this.flare = Math.max(0, this.flare - 0.04);
    const k = dead ? 0 : 0.85 + 0.15 * Math.sin(time * 2.1) + this.flare * 0.9;
    for (const sp of this.sprites) {
      const s = sp.userData.s0 * (0.9 + 0.35 * k);
      sp.scale.set(s, s, 1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.min(1, k) * alpha;
      sp.visible = k * alpha > 0.01;
    }
  }

  dispose() { for (const sp of this.sprites) { sp.parent?.remove(sp); sp.material.map?.dispose(); sp.material.dispose(); } this.sprites = []; }
}
