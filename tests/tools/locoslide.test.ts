// Locomotion quality with the REAL clip library (tool, not part of npm test):
//   [MANIFEST=public/anim/manifest.json] [HEROES=kaien,raijin] npx vitest run -c tests/tools/vitest.config.ts tests/tools/locoslide.test.ts --reporter=verbose
// Loads every pack in the manifest the way the game does (GLTFLoader -> bakeClips -> ClipLibrary), drives a hero's
// Animator at walk / jog / run speeds in 8 directions, and reports per case how far the planted feet slide (per unit of
// body speed: 0 = locked, the unit tests demand < 0.08 on the synthetic packs), footsteps per second, and which clips
// carried the blend - so a new movement set can be compared against the old one.
import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeClips, type PoseClip } from '../../src/render/Retarget';
import { ClipLibrary, type Manifest } from '../../src/render/ClipLibrary';
import { Animator, type AnimState } from '../../src/render/Animator';
import { mannequin } from '../../src/render/CharacterView';
import { Actor } from '../../src/game/Actor';
import { HERO } from '../../src/data/heroes';

it('measures foot slide', async () => {
  const mpath = process.env.MANIFEST ?? 'public/anim/manifest.json', dir = mpath.replace(/[^/\\]+$/, '');
  const m: Manifest = JSON.parse(readFileSync(mpath, 'utf-8'));
  const clips: PoseClip[] = [];
  for (const f of m.packs ?? []) {
    if (!existsSync(dir + f)) continue;
    const buf = readFileSync(dir + f);
    const g: any = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
    clips.push(...bakeClips(g.scene, g.animations, f));
  }
  const lib = new ClipLibrary(clips, m);
  const out = [`gaits: ${lib.gaits.map(g => `${g.name} ${g.speed.toFixed(2)} x${g.clips.length}`).join(', ')}`];
  const state = (o: Partial<AnimState> & { time: number }): AnimState => ({
    dt: 1 / 60, vel: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: true, flying: false, frame: 'human', attackAge: 9, attackKind: 'primary', castAge: 9, castId: '',
    hitAge: 9, landAge: 9, jumpAge: 9, stunned: false, charging: false, beam: false, barrier: false, rooted: false, scale: 1, pos: new THREE.Vector3(), ...o,
  });
  let worst = 0, sum = 0, cases = 0;
  for (const id of (process.env.HEROES ?? 'kaien,raijin').split(',')) {
    for (const speed of [1.4, 3.2, 6]) for (let k = 0; k < 8; k++) {
      const d = HERO[id], a = new Actor(d, d.team), mesh = mannequin(a), an = new Animator(mesh);
      an.useClips(lib, 3, id);
      const ang = k * Math.PI / 4, vx = Math.sin(ang) * speed, vz = Math.cos(ang) * speed;
      const pos = new THREE.Vector3(); let t = 0, slide = 0, n = 0, steps = 0;
      const prev: (THREE.Vector3 | null)[] = [null, null], fp = new THREE.Vector3(), used = new Set<string>();
      an.onStep = () => steps++;
      const group = new THREE.Group(); group.add(mesh);
      for (let f = 0; f < 240; f++) {
        t += 1 / 60; pos.x += vx / 60; pos.z += vz / 60;
        group.position.copy(pos);
        an.update(state({ time: t, vel: new THREE.Vector3(vx, 0, vz), pos: pos.clone() }));
        group.updateMatrixWorld(true);
        if (f < 60) continue;
        for (const e of an.layer?.lib.blend(Math.atan2(vx, vz), speed / Math.max(0.1, an.legLen)) ?? []) if (e.w > 0.2) used.add(e.clip.name);
        for (let i = 0; i < 2; i++) {
          const planted = !!an.plant[i];
          an.bones[i ? 'foot_R' : 'foot_L']!.getWorldPosition(fp);
          if (planted && prev[i]) { slide += Math.hypot(fp.x - prev[i]!.x, fp.z - prev[i]!.z) * 60; n++; }
          prev[i] = planted ? fp.clone() : null;
        }
      }
      const s = n ? slide / n / speed : 0;
      worst = Math.max(worst, s); sum += s; cases++;
      out.push(`${id.padEnd(7)} ${speed.toFixed(1)} m/s ${String(k * 45).padStart(3)} deg  slide ${s.toFixed(3)}  steps/s ${(steps / 3).toFixed(1)}  planted ${n}  ${[...used].slice(0, 3).join(' + ')}`);
    }
  }
  out.push(`MEAN slide ${(sum / cases).toFixed(3)}, WORST ${worst.toFixed(3)} over ${cases} cases`);
  console.log(out.join('\n'));
});
