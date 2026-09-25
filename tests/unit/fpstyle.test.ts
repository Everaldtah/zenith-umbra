// First-person arms: the viewmodel personality table (FirstPerson.ts) and the Blender authoring tool (fp_arms.py) must
// agree, or authored clips frame differently from the procedural fallback; and every hero's grip must be reachable.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FP_STYLE, viewmodelOffset } from '../../src/render/FirstPerson';
import { Animator } from '../../src/render/Animator';
import { mannequin } from '../../src/render/CharacterView';
import { Actor } from '../../src/game/Actor';
import { HERO } from '../../src/data/heroes';

const py = readFileSync('assetgen/blender/fp_arms.py', 'utf8');

describe('first-person viewmodel', () => {
  it('fp_arms.py uses the same grips, hand rests, recoil, eye push and near clip as FirstPerson.ts', () => {
    const table = (name: string) => Object.fromEntries([...py.match(new RegExp(`${name} = \\{([^}]*)\\}`))![1].matchAll(/"(\w+)": ([\d.]+)/g)].map(m => [m[1], +m[2]]));
    const push = table('PUSH'), clip = table('CLIP');
    for (const [id, st] of Object.entries(FP_STYLE)) {
      const m = py.match(new RegExp(`"${id}": \\("(\\w+)", \\(([^)]*)\\), \\(([^)]*)\\), ([\\d.]+)\\)`));
      expect(m, id).toBeTruthy();
      const nums = (x: string) => x.split(',').map(Number);
      expect([id, m![1], nums(m![2]), nums(m![3]), +m![4], push[id] ?? 0, clip[id] ?? 0]).toEqual([id, st.grip, st.R, st.L, st.recoil, st.push ?? 0, st.clip ?? 0]);
    }
  });

  it('the viewmodel offset puts every hero\'s rest grip within reach, shoulders always behind the camera', () => {
    for (const [id, st] of Object.entries(FP_STYLE)) {
      const def = HERO[id]; if (!def) continue;
      const an = new Animator(mannequin(new Actor(def, def.team)));
      // shorten the arms like a bad auto-rig: the offset must still reach
      for (const k of [1, 0.45]) {
        const rest = Object.fromEntries(Object.entries(an.rest).map(([n, r]) => [n, { p: r!.p.clone() }])) as any;
        for (const S of ['L', 'R']) {
          const s = rest[`upperarm_${S}`].p;
          for (const n of [`forearm_${S}`, `hand_${S}`]) rest[n].p.sub(s).multiplyScalar(k).add(s);
        }
        const eye = an.rest.head!.p.clone().add(new THREE.Vector3(0, an.height * 0.06, an.height * 0.05));
        const o = viewmodelOffset({ rest }, eye, st, 1);
        for (const [S, v] of [['L', st.L], ['R', st.R]] as const) {
          // whatever the arm length, the shoulders never come in front of the camera
          expect([id, k, S, 'shoulder behind camera', rest[`upperarm_${S}`].p.z + o.z - eye.z < 0]).toEqual([id, k, S, 'shoulder behind camera', true]);
          // on badly short arms the rig can't slide far enough forward to reach: the hands fall short (IK clamps)
          if (!v || k < 1) continue;
          const t = new THREE.Vector3(-v[0], v[1], v[2]).add(eye).sub(o);
          const reach = rest[`upperarm_${S}`].p.distanceTo(rest[`forearm_${S}`].p) + rest[`forearm_${S}`].p.distanceTo(rest[`hand_${S}`].p);
          // a far grip (Yuzu's bow arm) may end at full extension, slightly short of the target
          expect([id, k, S, 'grip in reach', t.distanceTo(rest[`upperarm_${S}`].p) <= reach * 1.15]).toEqual([id, k, S, 'grip in reach', true]);
        }
      }
    }
  });
});
