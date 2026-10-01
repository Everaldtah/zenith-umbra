// Enra's Hellfire Chains, the render-side timelines and the chain layer (src/render/ChainBlades.ts): the blade leaves
// the fist on a light swing and the throw on the sim's numbers (docs/research/kratos_blades_study.md), the chain pays
// out to wherever the blade is and hangs slack when it's in the hand.
import * as THREE from 'three';
import { CB_WIND, CB_ARC, CB_SWING, CB_THROW, CB_THROW_HIT, CB_THROW_BACK, swingExt, swingArc, swingPhi, throwExt, throwSpin, fireK, buildChain, layChain, slackCurve, yokeCurve } from '../../src/render/ChainBlades';

describe('swing timeline', () => {
  it('the blade is in the fist through the wind-up, at the chain\'s full length for the middle of the arc, back by the end', () => {
    expect(swingExt(0)).toBe(0);
    expect(swingExt(CB_WIND * 0.5)).toBeLessThan(0.1);
    expect(swingExt(CB_WIND + CB_ARC * 0.5)).toBeGreaterThan(0.95);
    expect(swingExt(CB_WIND + CB_ARC)).toBeCloseTo(1, 5);
    expect(swingExt(CB_SWING)).toBe(0);
    expect(swingExt(CB_SWING + 1)).toBe(0);
  });
  it('the arc runs from its own side across the body: the bearing starts on the swing side and ends on the other', () => {
    for (const side of [1, -1]) {
      expect(Math.sign(swingPhi(0, side))).toBe(side);
      expect(Math.sign(swingPhi(CB_WIND + CB_ARC, side))).toBe(-side);
      expect(swingArc(0)).toBe(0); expect(swingArc(CB_WIND + CB_ARC)).toBe(1);
    }
    // monotone across the arc (never doubles back)
    let last = swingPhi(CB_WIND, -1);
    for (let t = CB_WIND; t <= CB_WIND + CB_ARC; t += 0.01) { const p = swingPhi(t, -1); expect(p).toBeGreaterThanOrEqual(last - 1e-9); last = p; }
  });
});

describe('throw timeline', () => {
  it('the blade flies out in 0.25 s, holds taut, is back by 0.6 s, spinning once each way', () => {
    expect(throwExt(0.04)).toBe(0);
    expect(throwExt(CB_THROW_HIT)).toBeCloseTo(1, 5);
    expect(throwExt((CB_THROW_HIT + CB_THROW_BACK) / 2)).toBe(1);
    expect(throwExt(CB_THROW)).toBe(0);
    expect(throwSpin(CB_THROW_HIT)).toBeCloseTo(1, 5);
    expect(throwSpin(CB_THROW - 1e-6)).toBeCloseTo(2, 3);
  });
  it('the blade burns for the whole of a swing and a throw and is out otherwise', () => {
    expect(fireK('primary', 0.2)).toBe(1); expect(fireK('secondary', 0.3)).toBe(1);
    expect(fireK('primary', CB_SWING)).toBe(0); expect(fireK('secondary', CB_THROW)).toBe(0);
    expect(fireK('punch', 0.1)).toBe(0);
  });
});

describe('the chain', () => {
  const L = 2.05;
  it('hangs in a loop at rest (links below the chord) and pays out straight when the blade is at the chain\'s length', () => {
    const c = buildChain(L, 160);
    const from = new THREE.Vector3(0, 1, 0), near = new THREE.Vector3(0.2, 0.95, 0.1);
    const slack = slackCurve(c, from, near, 0.36 * L, 1 / 60);
    const lowest = Math.min(...slack.map(p => p.y));
    expect(lowest).toBeLessThan(0.95 - 0.1);                                   // the loop drops well below both ends
    const nSlack = layChain(c, slack);
    const far = new THREE.Vector3(0, 1, 3.6);                                   // the blade 3.6 units out
    const taut = slackCurve(c, from, far, from.distanceTo(far), 1 / 60);
    expect(Math.min(...taut.map(p => p.y))).toBeGreaterThan(0.95);            // no slack: straight (the trailing bow comes from motion)
    const nTaut = layChain(c, taut);
    expect(nTaut).toBeGreaterThan(nSlack);                                     // more links shown the farther it flies
    expect(nTaut).toBeLessThanOrEqual(c.n);
    expect(nTaut * c.pitch).toBeGreaterThan(3.4);                              // the links cover the run
    // the hidden links are scaled to nothing
    const m = new THREE.Matrix4(); c.iron.getMatrixAt(c.n - 2, m);
    expect(m.elements[0]).toBe(0);
  });
  it('the yoke runs through every waypoint in order', () => {
    const way = [new THREE.Vector3(-0.5, 0.8, 0.2), new THREE.Vector3(-0.4, 1.2, 0), new THREE.Vector3(0, 1.5, -0.2), new THREE.Vector3(0.4, 1.2, 0), new THREE.Vector3(0.5, 0.8, 0.2)];
    const pts = yokeCurve(way);
    expect(pts[0].distanceTo(way[0])).toBeLessThan(1e-6);
    expect(pts[pts.length - 1].distanceTo(way[way.length - 1])).toBeLessThan(1e-6);
    expect(Math.max(...pts.map(p => p.y))).toBeGreaterThan(1.45);
  });
});
