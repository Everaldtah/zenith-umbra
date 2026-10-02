// Loop-cycle finder for long generated / mocap gait takes (tool, not part of npm test):
//   CLIPS=pack.glb [ONLY=regex] [MIN=0.5] [MAX=2.2] [SKIP=0.4] [MINSPEED=legs/s] npx vitest run -c tests/tools/vitest.config.ts tests/tools/cyclefind.test.ts --reporter=verbose
// A text-to-motion take (Tripo Studio: 5 s) holds a few strides with a start-up; the clip library only takes a gait
// clip that LOOPS (analyse(): first and last pose match - hips height within 0.04 leg lengths, each foot relative to the
// hips within 0.08). For every clip this searches windows [t0, t0 + L] (L in MIN..MAX s, t0 after SKIP s) for the best
// matching ends, and prints the window, how well it meets those tolerances (<= 1 passes), and the travel over it -
// speed (leg lengths/s) and direction (deg, 0 = forward, +90 = to the character's left) - which shows whether a
// "strafe left" prompt really moved left. Feed the windows to anim_pack.py --map as [name, t0, t1].
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeClips, type PoseClip } from '../../src/render/Retarget';
import { RT, RT_INDEX, type RtBone } from '../../src/render/Rig';

const NB = RT.length;
const P = (c: PoseClip, f: number, b: RtBone) => { const i = (f * NB + RT_INDEX[b]) * 3; return new THREE.Vector3(c.p[i], c.p[i + 1], c.p[i + 2]); };
const rel = (c: PoseClip, f: number, b: RtBone) => P(c, f, b).sub(P(c, f, 'hips'));

it('finds loop cycles', async () => {
  const file = process.env.CLIPS!, only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  const MIN = +(process.env.MIN ?? 0.5), MAX = +(process.env.MAX ?? 2.2), SKIP = +(process.env.SKIP ?? 0.4), MINSPEED = +(process.env.MINSPEED ?? 0);
  const buf = readFileSync(file);
  const g: any = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  const out: string[] = [];
  // bake the RAW takes, travel kept (the game puts travelling one-shots in place; these aren't loops yet)
  for (const c of bakeClips(g.scene, g.animations, file, true)) {
    if (only && !only.test(c.name)) continue;
    let best = { cost: Infinity, f0: 0, f1: 0 };
    const fps = c.fps, n = c.frames;
    for (let f0 = Math.round(SKIP * fps); f0 < n; f0++) {
      for (let f1 = f0 + Math.round(MIN * fps); f1 <= Math.min(n - 1, f0 + Math.round(MAX * fps)); f1++) {
        const dh = Math.abs(P(c, f0, 'hips').y - P(c, f1, 'hips').y) / 0.04;
        const dl = rel(c, f0, 'foot_L').distanceTo(rel(c, f1, 'foot_L')) / 0.08, dr = rel(c, f0, 'foot_R').distanceTo(rel(c, f1, 'foot_R')) / 0.08;
        const ha = rel(c, f0, 'hand_L').distanceTo(rel(c, f1, 'hand_L')) / 0.2, hb = rel(c, f0, 'hand_R').distanceTo(rel(c, f1, 'hand_R')) / 0.2;
        // the tolerances that decide loop-ness count most; the hands only break ties (swinging arms in phase)
        // (a gait window must actually travel: generated takes often slow to a stop at the end)
        if (MINSPEED > 0) { const dd = P(c, f1, 'hips').sub(P(c, f0, 'hips')); dd.y = 0; if (dd.length() / ((f1 - f0) / fps) < MINSPEED) continue; }
        const cost = Math.max(dh, dl, dr) + 0.15 * Math.max(ha, hb) - 0.02 * (f1 - f0) / fps;
        if (cost < best.cost) best = { cost, f0, f1 };
      }
    }
    const { f0, f1 } = best, L = (f1 - f0) / fps;
    const d = P(c, f1, 'hips').sub(P(c, f0, 'hips')); d.y = 0;
    const dh = Math.abs(P(c, f0, 'hips').y - P(c, f1, 'hips').y) / 0.04;
    const df = Math.max(rel(c, f0, 'foot_L').distanceTo(rel(c, f1, 'foot_L')), rel(c, f0, 'foot_R').distanceTo(rel(c, f1, 'foot_R'))) / 0.08;
    out.push(`${c.name.padEnd(16)} [${(f0 / fps).toFixed(3)}, ${(f1 / fps).toFixed(3)}]  L ${L.toFixed(2)} s  hips ${dh.toFixed(2)} feet ${df.toFixed(2)} ${Math.max(dh, df) <= 1 ? 'LOOPS' : 'no loop'}  ` +
      `travel ${(d.length() / L).toFixed(2)} legs/s at ${(Math.atan2(d.x, d.z) * 180 / Math.PI).toFixed(0)} deg`);
  }
  console.log(out.join('\n'));
});
