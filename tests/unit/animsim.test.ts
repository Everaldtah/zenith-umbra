// Clip library in a real 5v5 bot match (headless, 60 fps): every hero's view animated with and without the library,
// measuring what the AI Test Lab measures in the browser - how far planted feet slide (relative to body speed), NaN
// bones, which clip one-shots play. The clip layer must not slide more than the procedural gait it replaces.
import * as THREE from 'three';
import { createMatch } from '../../src/game/setup';
import { CharacterView } from '../../src/render/CharacterView';
import { ClipLibrary, setAnimLibrary } from '../../src/render/ClipLibrary';
import { bakeClips } from '../../src/render/Retarget';
import { STYLES, buildRig, clipFor, gaitMotion, fallMotion, idleMotion } from './animFixture';

const DT = 1 / 60;

function library() {
  const rig = buildRig(STYLES.ual);
  const ms = [idleMotion('Idle_Loop'), gaitMotion('Walk_Loop', 1.3, 0, 1),
    gaitMotion('Jog_Fwd_Loop', 2.6, 0, 0.7, 0.35), gaitMotion('Jog_Left_Loop', 2.6, Math.PI / 2, 0.7, 0.35), gaitMotion('Jog_Right_Loop', 2.6, -Math.PI / 2, 0.7, 0.35),
    gaitMotion('Jog_Bwd_Loop', 2.4, Math.PI, 0.7, 0.35), gaitMotion('Jog_Fwd_Left_Loop', 2.6, Math.PI / 4, 0.7, 0.35), gaitMotion('Jog_Fwd_Right_Loop', 2.6, -Math.PI / 4, 0.7, 0.35),
    gaitMotion('Sprint_Loop', 4.6, 0, 0.6, 0.28), fallMotion('Jump_Start', 0.3), idleMotion('Jump_Loop', 0.8), fallMotion('Jump_Land', 0.3),
    fallMotion('Death01', 1.2), fallMotion('Hit_Chest', 0.35), fallMotion('Sword_Combo_1', 0.4), fallMotion('Sword_Combo_2', 0.4), fallMotion('Punch_Jab', 0.35), fallMotion('Roll', 0.7)];
  return new ClipLibrary(bakeClips(rig.scene, ms.map(m => clipFor(rig, m)), 'ual'));
}

function run(withClips: boolean, secs = 90) {
  const lib = withClips ? library() : null;
  setAnimLibrary(lib);
  const { world } = createMatch('kurogane', 'aitest', null, 0.8);
  const views = new Map<number, CharacterView>();
  const stats = new Map<string, { slide: number; n: number; nan: number; clip: number; frames: number; actions: Set<string> }>();
  const prev = new Map<string, THREE.Vector3>(), was = new Map<string, boolean>(), tmp = new THREE.Vector3();
  const viewer = { team: 'zenith', sees: () => true };
  for (let f = 0; f < secs * 60 && !world.winner; f++) {
    world.step(DT); world.events.length = 0;
    for (const a of world.actors) {
      if (a.isRobot) continue;
      let v = views.get(a.id);
      if (v && v.defId !== a.def.id) { views.delete(a.id); v = undefined; }
      if (!v) { v = new CharacterView(a, 'zenith'); if (lib) v.anim.useClips(lib, a.id); views.set(a.id, v); }
      v.update(DT, world.time, viewer);
      v.group.updateMatrixWorld(true);
      let s = stats.get(a.def.id);
      if (!s) stats.set(a.def.id, s = { slide: 0, n: 0, nan: 0, clip: 0, frames: 0, actions: new Set() });
      if (v.anim.clip?.action) s.actions.add(v.anim.clip.action);
      if (!a.alive) continue;
      s.frames++;
      if (v.anim.clip && v.anim.clip.legs > 0.5) s.clip++;
      for (const b of Object.values(v.anim.bones)) if (b && !Number.isFinite(b.quaternion.w)) { s.nan++; break; }
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (!(v.anim.ok && a.grounded && sp > 1 && !a.forced)) { prev.delete(`${a.id}L`); prev.delete(`${a.id}R`); continue; }
      for (const [i, side] of [[0, 'L'], [1, 'R']] as const) {
        const bone = v.anim.bones[`foot_${side}`]; if (!bone) continue;
        bone.getWorldPosition(tmp);
        const key = `${a.id}${side}`, p = prev.get(key);
        const planted = !!v.anim.plant[i] && (was.get(key) ?? false);
        was.set(key, !!v.anim.plant[i]);
        if (p && planted) { s.slide += Math.hypot(tmp.x - p.x, tmp.z - p.z) / DT / sp; s.n++; }
        prev.set(key, tmp.clone());
      }
    }
  }
  setAnimLibrary(null);
  return stats;
}

describe('clip library in a bot match', () => {
  const proc = run(false), clip = run(true);
  const rows = [...clip.keys()].map(id => {
    const c = clip.get(id)!, p = proc.get(id);
    return { id, clipSlide: +(c.slide / Math.max(1, c.n)).toFixed(3), procSlide: p ? +(p.slide / Math.max(1, p.n)).toFixed(3) : null, samples: c.n, clipShare: +(c.clip / Math.max(1, c.frames)).toFixed(2), nan: c.nan, actions: [...c.actions].sort().join(',') };
  });
  console.log(rows.map(r => JSON.stringify(r)).join("\n"));
  for (const r of rows) {
    it(`${r.id}: no NaN bones, feet don't slide more than the procedural gait`, () => {
      expect(r.nan).toBe(0);
      if (r.samples > 60) expect(r.clipSlide).toBeLessThan(Math.max(0.12, (r.procSlide ?? 0.1) * 1.25));
    });
  }
  it('human heroes are driven by clips; one-shots play', () => {
    for (const id of ['raijin', 'kaien', 'yuzu', 'hex', 'kagemaru', 'enra']) {
      const r = rows.find(x => x.id === id);
      if (r) expect([id, r.clipShare > 0.5]).toEqual([id, true]);
    }
    expect(new Set(rows.flatMap(r => r.actions.split(',')))).toContain('hit');
  });
});
