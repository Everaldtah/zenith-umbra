// Animation library tests: retargeting (UAL / Mixamo / Quaternius naming, T / A rest poses, cm units, facing, Z-up,
// bone rolls), clip analysis, 8-way blend space, gameplay slots, and the Animator driven by clips (foot sliding,
// death, melee combos, fallback to procedural).
import * as THREE from 'three';
import { classifyBone, mapSkeleton, bakeClips, samplePose, Pose, type PoseClip } from '../../src/render/Retarget';
import { ClipLibrary, slotOf, mirrorClip, reverseClip } from '../../src/render/ClipLibrary';
import { Animator, type AnimState } from '../../src/render/Animator';
import { mannequin } from '../../src/render/CharacterView';
import { Actor } from '../../src/game/Actor';
import { HERO, PILOTS } from '../../src/data/heroes';
import { RT, RT_INDEX, RT_CHILD, type RtBone } from '../../src/render/Rig';
import { STYLES, buildRig, clipFor, gaitMotion, fallMotion, idleMotion, type Motion } from './animFixture';

const DEG = 180 / Math.PI;
const bake = (style: string, motions: Motion[]) => { const rig = buildRig(STYLES[style]); return bakeClips(rig.scene, motions.map(m => clipFor(rig, m)), style); };

describe('bone mapping', () => {
  it('classifies the naming schemes of UAL, Mixamo, old Quaternius, Rigify, Biped', () => {
    const cases: [string, string | null][] = [
      ['pelvis', 'hips'], ['upperarm_l', 'upperarm_L'], ['lowerarm_r', 'forearm_R'], ['calf_l', 'shin_L'], ['thigh_r', 'thigh_R'], ['clavicle_l', 'shoulder_L'], ['ball_l', null],
      ['mixamorigLeftArm', 'upperarm_L'], ['mixamorigRightForeArm', 'forearm_R'], ['mixamorigLeftUpLeg', 'thigh_L'], ['mixamorigRightLeg', 'shin_R'], ['mixamorigLeftShoulder', 'shoulder_L'],
      ['mixamorig:Hips', 'hips'], ['mixamorigLeftHandIndex1', null], ['mixamorigHeadTop_End', null], ['mixamorigRightToeBase', null],
      ['UpperArmL', 'upperarm_L'], ['LowerLegR', 'shin_R'], ['FootL', 'foot_L'], ['UpperArm.R', 'upperarm_R'],
      ['DEF-thigh.L', 'thigh_L'], ['DEF-forearm.R', 'forearm_R'], ['Bip01 L UpperArm', 'upperarm_L'], ['Bip01 R Calf', 'shin_R'],
      ['upperarm_twist_01_l', null], ['thigh_twist_01_r', null], ['Head', 'head'], ['neck_01', 'neck'], ['RightHand', 'hand_R'],
    ];
    for (const [n, want] of cases) expect([n, classifyBone(n)]).toEqual([n, want]);
  });

  for (const style of Object.keys(STYLES)) {
    it(`${style}: maps all 19 body bones incl. spine / chest from the hierarchy`, () => {
      const rig = buildRig(STYLES[style]);
      const m = mapSkeleton(rig.scene)!;
      expect(m).toBeTruthy();
      for (const b of RT) expect([b, !!m[b]]).toEqual([b, true]);
      expect(m.spine!.name).toBe(STYLES[style].names.spine1);
      expect(m.chest!.name).toBe(STYLES[style].names.chest);
    });
  }
  it('rejects a non-humanoid scene', () => {
    const g = new THREE.Group(); const b = new THREE.Bone(); b.name = 'Tail'; g.add(b);
    expect(mapSkeleton(g)).toBeNull();
    expect(bakeClips(g, [new THREE.AnimationClip('x', 1, [])])).toEqual([]);
  });
});

describe('retargeting accuracy', () => {
  const walk = gaitMotion('Jog_Fwd_Loop', 2.4, 0, 0.7, 0.35);
  const clips = Object.fromEntries(Object.keys(STYLES).map(s => [s, bake(s, [walk])[0]]));
  const truthPose = (t: number) => walk.at(t);

  for (const style of Object.keys(STYLES)) {
    it(`${style}: limb directions, torso deltas and hips match the source motion`, () => {
      const c = clips[style];
      const P = new Pose();
      let worstDir = 0, worstTorso = 0, worstHips = 0;
      const limbs: [RtBone, string][] = [['upperarm_L', 'uarm_L'], ['forearm_L', 'farm_L'], ['upperarm_R', 'uarm_R'], ['forearm_R', 'farm_R'], ['thigh_L', 'thigh_L'], ['shin_L', 'shin_L'], ['thigh_R', 'thigh_R'], ['shin_R', 'shin_R']];
      for (let f = 0; f < c.frames; f++) {
        const t = f / c.fps;
        samplePose(c, t, P);
        const tr = truthPose(t);
        for (const [b, j] of limbs) {
          const d = P.p[RT_INDEX[RT_CHILD[b]!]].clone().sub(P.p[RT_INDEX[b]]).normalize();
          worstDir = Math.max(worstDir, d.angleTo((tr.dir as any)[j]) * DEG);
        }
        for (const [b, j] of [['hips', 'hips'], ['chest', 'chest'], ['head', 'head']] as [RtBone, string][]) {
          worstTorso = Math.max(worstTorso, P.q[RT_INDEX[b]].angleTo((tr.torso as any)[j]) * DEG);
        }
        worstHips = Math.max(worstHips, P.d[RT_INDEX.hips].distanceTo(tr.hips));
      }
      expect(worstDir).toBeLessThan(1.5);
      expect(worstTorso).toBeLessThan(1.5);
      expect(worstHips).toBeLessThan(0.01);
    });
  }

  it('every rig style produces the same baked clip (rig-independent)', () => {
    const P0 = new Pose(), P1 = new Pose();
    for (const style of ['mixamo', 'zup', 'quat']) {
      for (let t = 0; t < walk.duration; t += 0.1) {
        samplePose(clips.ual, t, P0); samplePose(clips[style], t, P1);
        for (const b of ['foot_L', 'foot_R', 'hips'] as RtBone[]) expect(P0.d[RT_INDEX[b]].distanceTo(P1.d[RT_INDEX[b]])).toBeLessThan(0.02);
      }
    }
  });
});

describe('clip analysis', () => {
  const dirs: [string, number][] = [['Jog_Fwd_Loop', 0], ['Jog_Left_Loop', Math.PI / 2], ['Jog_Bwd_Loop', Math.PI], ['Jog_Right_Loop', -Math.PI / 2], ['Jog_Fwd_Left_Loop', Math.PI / 4]];
  for (const style of ['ual', 'mixamo']) {
    it(`${style}: speed + travel direction measured from the planted feet (in-place clips)`, () => {
      const cs = bake(style, dirs.map(([n, a]) => gaitMotion(n, 2.4, a, 0.7, 0.35)));
      for (const [i, c] of cs.entries()) {
        expect(c.loop).toBe(true);
        expect(c.rootMotion).toBe(false);
        expect(Math.abs(c.speed - 2.4) / 2.4).toBeLessThan(0.05);
        const a = Math.atan2(c.travel[0], c.travel[1]);
        let d = Math.abs(a - dirs[i][1]); d = Math.min(d, 2 * Math.PI - d);
        expect(d * DEG).toBeLessThan(4);
        const planted = Array.from({ length: c.frames }, (_, f) => c.contact[f * 2]).reduce((s, x) => s + x, 0) / c.frames;
        expect(Math.abs(planted - 0.35)).toBeLessThan(0.12);
      }
    });
  }
  it('root-motion clips are measured from the hips and made in place', () => {
    const [c] = bake('mixamo', [gaitMotion('Walking', 1.5, 0, 1.2, 0.6, true)]);
    expect(c.rootMotion).toBe(true);
    expect(Math.abs(c.speed - 1.5) / 1.5).toBeLessThan(0.03);
    const last = c.frames - 1, h = RT_INDEX.hips * 3;
    expect(Math.abs(c.p[last * RT.length * 3 + h + 2] - c.p[h + 2])).toBeLessThan(0.02);
  });
  it('one-shots are not loops; stationary clips have no speed', () => {
    const [death, idle] = bake('ual', [fallMotion('Death01'), idleMotion('Idle_Loop')]);
    expect(death.loop).toBe(false);
    expect(idle.loop).toBe(true);
    expect(idle.speed).toBe(0);
  });
  it('mirror swaps sides and travel; reverse walks backwards', () => {
    const [r] = bake('ual', [gaitMotion('Jog_Right_Loop', 2, -Math.PI / 2, 0.7, 0.35)]);
    const m = mirrorClip(r);
    expect(m.travel[0]).toBeCloseTo(-r.travel[0], 3);
    const P = new Pose(), Q = new Pose();
    samplePose(r, 0.3, P); samplePose(m, 0.3, Q);
    expect(Q.p[RT_INDEX.foot_L].x).toBeCloseTo(-P.p[RT_INDEX.foot_R].x, 4);
    const [f] = bake('ual', [gaitMotion('Walk_Loop', 1.4, 0, 1)]);
    const b = reverseClip(f);
    expect(b.travel[1]).toBeLessThan(-0.95);
    expect(Math.abs(b.speed - 1.4) / 1.4).toBeLessThan(0.08);
  });
});

describe('library', () => {
  it('sorts pack clip names into gameplay slots', () => {
    const cases: [string, boolean, string | null][] = [
      ['Idle_Loop', true, 'idle'], ['Idle', true, 'idle'], ['Idle_Talking_Loop', true, null], ['Death01', false, 'death'], ['Dying Backwards', false, 'death'],
      ['Hit_Chest', false, 'hit'], ['HitReact_Left', false, 'hit'], ['Jump_Start', false, 'jump_start'], ['Jump_Loop', true, 'jump_loop'], ['Jump_Land', false, 'land'],
      ['Falling Idle', true, 'jump_loop'], ['Roll', false, 'roll'], ['Punch_Jab', false, 'punch'], ['Punch_Cross', false, 'punch'], ['Sword_Attack', false, 'melee'],
      ['Melee_Combo_Hit_1', false, 'melee'], ['Sword_Combo_02', false, 'melee'], ['Spell_Simple_Shoot', false, 'cast'], ['Parkour_Vault', false, 'vault'],
      ['Backflip', false, 'flip'], ['Running Slide', false, 'slide'], ['Throw', false, 'throw'], ['Stunned', true, 'stun'], ['Jog_Fwd_Loop', true, null], ['T-Pose', false, null],
    ];
    for (const [n, loop, want] of cases) expect([n, slotOf(n, loop)]).toEqual([n, want]);
  });

  const packs = () => [
    ...bake('ual', [gaitMotion('Walk_Loop', 1.3, 0, 1), gaitMotion('Jog_Fwd_Loop', 2.6, 0, 0.7, 0.35), gaitMotion('Jog_Left_Loop', 2.6, Math.PI / 2, 0.7, 0.35),
      gaitMotion('Jog_Bwd_Loop', 2.4, Math.PI, 0.7, 0.35), gaitMotion('Sprint_Loop', 4.4, 0, 0.6, 0.28), idleMotion('Idle_Loop'), fallMotion('Death01'), fallMotion('Death02', 1.6),
      fallMotion('Sword_Combo_1', 0.4), fallMotion('Sword_Combo_2', 0.4), fallMotion('Sword_Combo_3', 0.5), fallMotion('Punch_Jab', 0.35), fallMotion('Roll', 0.7)]),
    ...bake('mixamo', [gaitMotion('Crouched Walking', 1, 0, 1)]),
  ];
  it('builds gaits by measured speed, fills directions by mirroring / reversal', () => {
    const lib = new ClipLibrary(packs());
    expect(lib.gaits.map(g => g.name)).toEqual(['walk', 'jog', 'sprint']);
    const jog = lib.gaits[1];
    const angles = jog.clips.map(c => Math.round(Math.atan2(c.travel[0], c.travel[1]) * DEG) + 0).sort((a, b) => a - b);
    expect(angles.map(a => a === -180 ? 180 : a).sort((a, b) => a - b)).toEqual([-90, 0, 90, 180]);
    expect(jog.clips.some(c => c.name.includes('(mirror)'))).toBe(true);        // right strafe mirrored from the left
    expect(lib.gaits[0].clips.some(c => c.name.includes('(reverse)'))).toBe(true); // walk backwards from walk forwards
    expect(lib.get('melee').map(c => c.name)).toEqual(['Sword_Combo_1', 'Sword_Combo_2', 'Sword_Combo_3']);
    expect(lib.get('death').length).toBe(2);
    expect(lib.has('idle') && lib.has('punch') && lib.has('roll')).toBe(true);
  });
  it('blend space: weights sum to 1, neighbours by direction, gaits by speed', () => {
    const lib = new ClipLibrary(packs());
    for (const [ang, sp] of [[0, 1], [0.7, 2.6], [-2.5, 3.5], [Math.PI, 2], [1.9, 5], [0.3, 0.2]] as [number, number][]) {
      const b = lib.blend(ang, sp);
      expect(b.reduce((s, e) => s + e.w, 0)).toBeCloseTo(1, 3);
    }
    const diag = lib.blend(Math.PI / 4, lib.gaits[1].speed);
    expect(diag.length).toBe(2);
    expect(diag.map(e => e.clip.name).sort()).toEqual(['Jog_Fwd_Loop', 'Jog_Left_Loop']);
    expect(diag[0].w).toBeCloseTo(0.5, 1);
    const between = lib.blend(0, (lib.gaits[1].speed + lib.gaits[2].speed) / 2);
    expect(between.map(e => e.clip.name).sort()).toEqual(['Jog_Fwd_Loop', 'Sprint_Loop']);
  });
  it('manifest pins and excludes clips', () => {
    const lib = new ClipLibrary(packs(), { slots: { death: ['Death02'] }, exclude: ['Roll'] });
    expect(lib.get('death').map(c => c.name)).toEqual(['Death02']);
    expect(lib.has('roll')).toBe(false);
  });

  // ---------------------------------------------------------------- Animator driven by the library
  const lib = new ClipLibrary(packs());
  const hero = (id = 'raijin') => { const d = HERO[id] ?? Object.values(PILOTS).find(p => p.id === id)!; const a = new Actor(d, d.team); const m = mannequin(a); const an = new Animator(m); return { a, m, an }; };
  const state = (o: Partial<AnimState> & { time: number }): AnimState => ({
    dt: 1 / 60, vel: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: true, flying: false, frame: 'human', attackAge: 9, attackKind: 'primary', castAge: 9, castId: '',
    hitAge: 9, landAge: 9, jumpAge: 9, stunned: false, charging: false, beam: false, barrier: false, rooted: false, scale: 1, pos: new THREE.Vector3(), ...o,
  });
  const finite = (an: Animator) => Object.values(an.bones).every(b => b && [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, b.position.x, b.position.y].every(Number.isFinite));

  /** run at a velocity for `secs`, measure how far planted feet slide in the world relative to body speed */
  function run(an: Animator, m: THREE.Object3D, vx: number, vz: number, secs = 3, yaw = 0) {
    const pos = new THREE.Vector3(); let t = 0, slide = 0, n = 0, steps = 0;
    const prev: (THREE.Vector3 | null)[] = [null, null], fp = new THREE.Vector3();
    an.onStep = () => steps++;
    const group = new THREE.Group(); group.add(m);
    for (let f = 0; f < secs * 60; f++) {
      t += 1 / 60; pos.x += vx / 60; pos.z += vz / 60;
      group.position.copy(pos); group.rotation.y = yaw;
      an.update(state({ time: t, vel: new THREE.Vector3(vx, 0, vz), pos: pos.clone(), yaw }));
      group.updateMatrixWorld(true);
      if (f < 60) continue;
      for (let i = 0; i < 2; i++) {
        const planted = !!an.plant[i];
        an.bones[i ? 'foot_R' : 'foot_L']!.getWorldPosition(fp);
        if (planted && prev[i]) { slide += Math.hypot(fp.x - prev[i]!.x, fp.z - prev[i]!.z) * 60; n++; }
        prev[i] = planted ? fp.clone() : null;
      }
    }
    return { slide: n ? slide / n / Math.max(0.01, Math.hypot(vx, vz)) : 0, n, steps };
  }

  it('without a library the animator stays fully procedural', () => {
    const { an } = hero();
    an.useClips(null);
    an.update(state({ time: 0.1, vel: new THREE.Vector3(0, 0, 3) }));
    expect(an.layer).toBeNull(); expect(an.clip).toBeNull();
  });

  for (const [label, vx, vz] of [['forward jog', 0, 3.2], ['strafe left', 3, 0], ['backpedal', 0, -2.4], ['diagonal', 2.1, 2.1], ['sprint', 0, 6.5], ['walk', 0, 1.4]] as [string, number, number][]) {
    it(`clip locomotion (${label}): planted feet don't slide, steps fire, pose stays finite`, () => {
      const { an, m } = hero();
      an.useClips(lib, 3);
      const r = run(an, m, vx, vz);
      expect(an.clip && an.clip.legs).toBeGreaterThan(0.9);
      expect(r.n).toBeGreaterThan(40);
      expect(r.slide).toBeLessThan(0.08);
      expect(r.steps).toBeGreaterThan(3);
      expect(finite(an)).toBe(true);
    });
  }

  it('idle -> move -> stop blends without NaNs, flying hands back to procedural', () => {
    const { an } = hero('mirei');
    an.useClips(lib, 1);
    let t = 0;
    for (let f = 0; f < 240; f++) {
      t += 1 / 60;
      const moving = f > 60 && f < 150, fly = f > 180;
      an.update(state({ time: t, vel: new THREE.Vector3(0, fly ? 1 : 0, moving ? 3 : 0), frame: 'flyer', flying: fly, grounded: !fly, angel: true }));
    }
    expect(finite(an)).toBe(true);
    expect(an.clip).toBeNull();          // flying: the layer steps aside for the procedural flight poses
  });

  it('melee swings advance through the combo hits and reset after a pause', () => {
    const { an } = hero('raijin');
    an.useClips(lib, 0);
    const seen: string[] = [];
    let t = 0, last = -9;
    const swing = (at: number) => { last = at; };
    for (let f = 0; f < 300; f++) {
      t += 1 / 60;
      if ([10, 40, 70, 250].includes(f)) swing(t);
      an.update(state({ time: t, attackAge: t - last, melee: true, attackTime: 0.45 }));
      if (an.clip?.action === 'melee' && seen[seen.length - 1] !== an.clip.clipName) seen.push(an.clip.clipName);
    }
    expect(seen).toEqual(['Sword_Combo_1', 'Sword_Combo_2', 'Sword_Combo_3', 'Sword_Combo_1']);
    expect(finite(an)).toBe(true);
  });

  it('death clip drops the body to the ground and holds', () => {
    const { an, m } = hero('kaien');
    an.useClips(lib, 0);
    expect(an.clipDeath).toBe(true);
    const hipsY = () => { m.updateMatrixWorld(true); return an.bones.hips!.getWorldPosition(new THREE.Vector3()).y; };
    an.update(state({ time: 0 })); const standing = hipsY();
    let t = 0;
    for (let f = 0; f < 150; f++) { t += 1 / 60; an.update(state({ time: t, dead: true, deathAge: t })); }
    expect(an.clip?.action).toBe('death');
    expect(hipsY()).toBeLessThan(standing * 0.5);
    expect(finite(an)).toBe(true);
  });

  it('abilities map to parkour / roll clips; quick melee plays the punch', () => {
    const { an } = hero('haruto');
    an.useClips(lib, 0);
    an.update(state({ time: 1, castAge: 9 }));
    an.update(state({ time: 1.02, castAge: 0.0, castId: 'pilotroll' }));
    expect(an.clip?.action).toBe('roll');
    const b = hero('raijin'); b.an.useClips(lib, 0);
    b.an.update(state({ time: 1 }));
    b.an.update(state({ time: 1.02, attackAge: 0, attackKind: 'punch' }));
    expect(b.an.clip?.action).toBe('punch');
  });

  it('mechs, drones and the hammer stay procedural', () => {
    const { an } = hero('tenkai');
    an.useClips(lib, 0);
    for (let f = 0; f < 60; f++) an.update(state({ time: f / 60, frame: 'mech', hammer: true, vel: new THREE.Vector3(0, 0, 3) }));
    expect(an.clip).toBeNull();
    expect(finite(an)).toBe(true);
  });
});

describe('clip sampling', () => {
  it('loops wrap and one-shots clamp', () => {
    const [walk, death] = bake('ual', [gaitMotion('Walk_Loop', 1.4, 0, 1), fallMotion('Death01', 1)]);
    const a = new Pose(), b = new Pose();
    samplePose(walk, 0.25, a); samplePose(walk, 1.25, b);
    expect(a.p[RT_INDEX.foot_L].distanceTo(b.p[RT_INDEX.foot_L])).toBeLessThan(1e-4);
    samplePose(death, 5, a); samplePose(death, 1, b);
    expect(a.d[RT_INDEX.hips].distanceTo(b.d[RT_INDEX.hips])).toBeLessThan(1e-6);
  });
});

export type { PoseClip };
