// Motion timelines of the clips in an animation pack, through the game's own retargeter (tool, not part of npm test):
//   CLIPS=path/to/pack.glb [ONLY=regex] [STEP=0.25] [OUT=file.txt] npx vitest run -c tests/tools/vitest.config.ts tests/tools/clipscan.test.ts
// Per clip: whether the skeleton mapped, duration, loop / speed / travel from analyse(), then a row every STEP seconds:
//   hips height (leg lengths), body tilt from upright (deg: ~180 = upside down), the higher foot's height, the hands' height
//   over the head, and the motion activity - enough to cut a long mocap take (several repeats of a kick, a run-up and a
//   flip and a walk-back) down to the one move that matters (anim_pack.py --map "stem": [name, start, end]).
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeClips, type PoseClip } from '../../src/render/Retarget';
import { RT, RT_INDEX, type RtBone } from '../../src/render/Rig';

const NB = RT.length;
const P = (c: PoseClip, f: number, b: RtBone) => { const i = (f * NB + RT_INDEX[b]) * 3; return new THREE.Vector3(c.p[i], c.p[i + 1], c.p[i + 2]); };

it('scans the clips', async () => {
  const file = process.env.CLIPS!, step = +(process.env.STEP ?? 0.25), only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  const buf = readFileSync(file);
  const g: any = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  const clips = bakeClips(g.scene, g.animations, file);
  const out: string[] = [`${file}: ${g.animations.length} animations, ${clips.length} baked`];
  for (const c of clips) {
    if (only && !only.test(c.name)) continue;
    out.push(`\n== ${c.name}  ${c.duration.toFixed(2)} s  loop ${c.loop}  speed ${c.speed.toFixed(2)}  travel ${c.travel.map(v => v.toFixed(2))}  mask ${c.mask.filter(Boolean).length}/${NB}`);
    out.push('   t    hipsY  tilt  footY  handsOverHead  act');
    let prev: Float32Array | null = null;
    for (let t = 0; t <= c.duration + 1e-6; t += step) {
      const f = Math.min(c.frames - 1, Math.round(t * c.fps));
      const hips = P(c, f, 'hips'), head = P(c, f, 'head');
      const up = head.clone().sub(hips).normalize();
      const tilt = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, up.y))));
      const foot = Math.max(P(c, f, 'foot_L').y, P(c, f, 'foot_R').y);
      const hands = Math.max(P(c, f, 'hand_L').y, P(c, f, 'hand_R').y) - head.y;
      const q = c.q.slice(f * NB * 4, (f + 1) * NB * 4);
      let act = 0;
      if (prev) for (let i = 0; i < NB; i++) { const a = new THREE.Quaternion().fromArray(prev, i * 4), b = new THREE.Quaternion().fromArray(q, i * 4); act += 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))); }
      prev = q;
      out.push(`${t.toFixed(2).padStart(6)} ${hips.y.toFixed(2).padStart(6)} ${tilt.toFixed(0).padStart(5)} ${foot.toFixed(2).padStart(6)} ${hands.toFixed(2).padStart(8)}  ${'#'.repeat(Math.min(40, Math.round(act * 4)))}`);
    }
  }
  console.log(out.join('\n'));
});
