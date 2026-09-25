// Writes synthetic animation packs as real GLB files for the browser test (tests/e2e/anim.mjs): a Quaternius-UAL-style
// pack (UE-style bone names, T-pose, 8-way jog, walk, sprint, idle, jumps, deaths, a split melee combo, punches, roll,
// parkour) and a Mixamo-style pack (mixamorig names, cm units, A-pose, rolled bones, facing -Z). They go through three's
// GLTFExporter and are loaded back by the game's GLTFLoader, the same path the real UAL1 / UAL2 / Mixamo files take.
//   npx vitest run tests/tools/animpack.test.ts --dir tests/tools
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { STYLES, buildRig, clipFor, gaitMotion, fallMotion, idleMotion, type Motion } from '../unit/animFixture';
import { bakeClips } from '../../src/render/Retarget';
import { ClipLibrary } from '../../src/render/ClipLibrary';

// GLTFExporter's binary path reads Blobs through FileReader, which node lacks
(globalThis as any).FileReader ??= class {
  result: ArrayBuffer | string | null = null; onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) { b.arrayBuffer().then(r => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(b: Blob) { b.arrayBuffer().then(r => { this.result = `data:${b.type || 'application/octet-stream'};base64,` + Buffer.from(r).toString('base64'); this.onloadend?.(); }); }
};

const OUT = 'tests/e2e/fixtures/anim';

function exportGlb(scene: THREE.Object3D, clips: THREE.AnimationClip[]): Promise<ArrayBuffer> {
  return new Promise((res, rej) => new GLTFExporter().parse(scene, r => res(r as ArrayBuffer), rej, { binary: true, animations: clips, onlyVisible: false }));
}

const UAL: Motion[] = [
  idleMotion('Idle_Loop'),
  gaitMotion('Walk_Loop', 1.3, 0, 1),
  gaitMotion('Jog_Fwd_Loop', 2.6, 0, 0.7, 0.35), gaitMotion('Jog_Left_Loop', 2.6, Math.PI / 2, 0.7, 0.35), gaitMotion('Jog_Right_Loop', 2.6, -Math.PI / 2, 0.7, 0.35),
  gaitMotion('Jog_Bwd_Loop', 2.4, Math.PI, 0.7, 0.35), gaitMotion('Jog_Fwd_Left_Loop', 2.6, Math.PI / 4, 0.7, 0.35), gaitMotion('Jog_Fwd_Right_Loop', 2.6, -Math.PI / 4, 0.7, 0.35),
  gaitMotion('Sprint_Loop', 4.6, 0, 0.6, 0.28),
  fallMotion('Jump_Start', 0.3), idleMotion('Jump_Loop', 0.8), fallMotion('Jump_Land', 0.3),
  fallMotion('Death01', 1.2), fallMotion('Death02', 1.5), fallMotion('Hit_Chest', 0.35),
  fallMotion('Sword_Combo_1', 0.4), fallMotion('Sword_Combo_2', 0.4), fallMotion('Sword_Combo_3', 0.5),
  fallMotion('Punch_Jab', 0.35), fallMotion('Roll', 0.7), fallMotion('Parkour_Vault', 0.6), fallMotion('Spell_Simple_Shoot', 0.6),
];
const MIXAMO: Motion[] = [fallMotion('Standing React Death Backward', 1.8), fallMotion('Running Slide', 0.8), fallMotion('Backflip', 1.0), gaitMotion('Crouched Walking', 1, 0, 1.1)];

it('writes the synthetic UAL + Mixamo packs', async () => {
  mkdirSync(OUT, { recursive: true });
  const packs: [string, string, Motion[]][] = [['UAL_test.glb', 'ual', UAL], ['mixamo_test.glb', 'mixamo', MIXAMO]];
  for (const [file, style, motions] of packs) {
    const rig = buildRig(STYLES[style]);
    const clips = motions.map(m => clipFor(rig, m));
    const glb = await exportGlb(rig.scene, clips);
    writeFileSync(`${OUT}/${file}`, Buffer.from(glb));
    // round trip through the loader the game uses: every clip bakes
    const g = await new GLTFLoader().parseAsync(glb, '');
    const baked = bakeClips(g.scene, g.animations, file);
    expect(baked.map(c => c.name).sort()).toEqual(motions.map(m => m.name).sort());
  }
  const man: any = { packs: packs.map(p => p[0]) };
  if (existsSync(`${OUT}/fp_raijin.glb`)) man.fp = { raijin: 'fp_raijin.glb' };
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(man, null, 2));
});

it('a library built from the round-tripped packs has every slot + 8-way jog', async () => {
  const all = [];
  for (const f of ['UAL_test.glb', 'mixamo_test.glb']) {
    const buf = (await import('node:fs')).readFileSync(`${OUT}/${f}`);
    const g = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    all.push(...bakeClips(g.scene, g.animations, f));
  }
  const lib = new ClipLibrary(all);
  expect(lib.gaits.map(g => g.name)).toEqual(['walk', 'jog', 'sprint']);
  expect(lib.gaits[1].clips.length).toBeGreaterThanOrEqual(6);
  for (const s of ['idle', 'jump_start', 'jump_loop', 'land', 'death', 'hit', 'melee', 'punch', 'roll', 'vault', 'flip', 'slide', 'cast'] as const) expect([s, lib.has(s)]).toEqual([s, true]);
  expect(lib.get('death').length).toBe(3);
});
