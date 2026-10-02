// Engine core (src/engine): frame pacing, render interpolation, dynamic resolution - on simulated displays, so the
// numbers are exact rather than at the mercy of a busy machine's frame timing.
import { FramePacer } from '../../src/engine/FramePacer';
import { Interpolator } from '../../src/engine/Interpolator';
import { DynamicResolution } from '../../src/engine/DynamicResolution';
import type { Actor } from '../../src/game/Actor';

/** rAF timestamps of a display at `hz`, with a little scheduling jitter (deterministic) */
function* vblanks(hz: number, jitter = 0.35) {
  let i = 0, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (;;) yield 1000 + (i++ * 1000) / hz + (rnd() - 0.5) * 2 * jitter;
}

const cv = (xs: number[]) => { const m = xs.reduce((a, x) => a + x, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length) / m; };

describe('FramePacer', () => {
  it('measures the refresh and hands out vsync-exact deltas without drifting from the clock', () => {
    for (const hz of [57, 60, 144, 165, 240]) {
      const p = new FramePacer(), g = vblanks(hz);
      let t = 0, sum = 0, first = 0;
      for (let i = 0; i < 600; i++) { t = g.next().value as number; if (i === 0) first = t; const dt = p.tick(t, 0); if (i > 0) sum += dt; }
      expect(Math.abs(p.refreshHz - hz)).toBeLessThan(hz * 0.01);
      expect(p.vsynced).toBe(true);
      // game time tracks the wall clock to within one refresh interval
      expect(Math.abs(sum * 1000 - (t - first))).toBeLessThan(1000 / hz);
    }
  });

  it('a capped frame rate holds the cap (the old skip test gave 48 for a 60 cap on 144 Hz)', () => {
    for (const [hz, cap] of [[144, 60], [240, 144], [120, 60], [144, 72], [165, 120]]) {
      const p = new FramePacer(), g = vblanks(hz);
      let frames = 0, t0 = 0, t = 0;
      for (let i = 0; i < hz * 6; i++) { t = g.next().value as number; if (i === hz) t0 = t; if (p.tick(t, cap) >= 0 && i >= hz) frames++; }
      const fps = frames / ((t - t0) / 1000);
      expect([hz, cap, Math.abs(fps - cap) < cap * 0.03]).toEqual([hz, cap, true]);
    }
  });

  it('a cap that divides the refresh locks to every n-th vblank (even frame times)', () => {
    const p = new FramePacer(), g = vblanks(144);
    const runs: number[] = []; let last = 0;
    for (let i = 0; i < 144 * 4; i++) { const t = g.next().value as number; if (p.tick(t, 72) >= 0) { if (i > 144 && last) runs.push(t - last); last = t; } }
    expect(Math.max(...runs) - Math.min(...runs)).toBeLessThan(2);        // all ~13.9 ms, never 6.9 / 20.8
  });

  it('a skipped tick returns -1 and a dropped frame comes through as two intervals', () => {
    const p = new FramePacer(), g = vblanks(60, 0);
    for (let i = 0; i < 120; i++) p.tick(g.next().value as number, 0);
    g.next();                                    // a missed vblank
    expect(p.tick(g.next().value as number, 0)).toBeCloseTo(2 / 60, 4);
  });
});

/** a 120 Hz fixed-step loop like Game.loop on a display at `hz`; returns each frame's on-screen displacement of an
 *  actor moving at a constant 6 m/s, divided by what it should be (frame time x speed) */
function rendered(hz: number, interpolate: boolean) {
  const DT = 1 / 120, speed = 6;
  const a = { pos: { x: 0, y: 0, z: 0 }, vel: { x: speed, y: 0, z: 0 }, yaw: 0, pitch: 0 } as unknown as Actor;
  const w = { actors: [a], projs: [] as { pos: { x: number; y: number; z: number } }[] };
  const pacer = new FramePacer(), it = new Interpolator(), g = vblanks(hz);
  let acc = 0, lastX: number | null = null;
  const out: number[] = [];
  for (let i = 0; i < hz * 5; i++) {
    const t = g.next().value as number;
    const dt = pacer.tick(t, 0);
    acc += dt;
    while (acc >= DT) { it.snapshot(w.actors, w.projs); a.pos.x += speed * DT; acc -= DT; }
    if (interpolate) it.apply(w.actors, w.projs, acc / DT, null);
    const x = a.pos.x;                           // what the view draws
    it.restore();
    // the display shows each frame for exactly one vblank (the jitter is in when rAF ran, not in what was seen)
    if (lastX !== null && i > hz) out.push((x - lastX) / (1 / hz) / speed);
    lastX = x;
  }
  return out;
}

describe('Interpolator', () => {
  it('moves a steady actor evenly on 57 / 144 / 165 Hz displays (judder without it)', () => {
    for (const hz of [57, 144, 165]) {
      const raw = cv(rendered(hz, false)), smooth = cv(rendered(hz, true));
      expect([hz, raw > 0.12]).toEqual([hz, true]);          // uneven steps per frame: visible judder
      expect([hz, smooth < 0.03]).toEqual([hz, true]);       // interpolated: even motion
    }
  });

  it('on a 144 Hz display the raw sim shows frames with no movement at all; interpolated never', () => {
    expect(rendered(144, false).some(r => r < 0.01)).toBe(true);
    expect(rendered(144, true).every(r => r > 0.8)).toBe(true);
  });

  it('restores the simulation state exactly and snaps teleports', () => {
    const a = { pos: { x: 0, y: 0, z: 0 }, yaw: 3.1, pitch: 0 } as unknown as Actor;
    const it = new Interpolator();
    it.snapshot([a], []);
    a.pos.x = 1; a.yaw = -3.1;                   // across the +-pi seam
    it.apply([a], [], 0.5, null);
    expect(a.pos.x).toBeCloseTo(0.5);
    expect(Math.abs(Math.abs(a.yaw) - Math.PI)).toBeLessThan(0.01);    // the short way round, not through 0
    it.restore();
    expect(a.pos.x).toBe(1); expect(a.yaw).toBe(-3.1);
    it.snapshot([a], []);
    a.pos.x = 40;                                // a blink
    it.apply([a], [], 0.5, null);
    expect(a.pos.x).toBe(40);
    it.restore();
  });

  it("keeps the local player's live aim (mouse look is never delayed)", () => {
    const me = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 } as unknown as Actor;
    const it = new Interpolator();
    it.snapshot([me], []);
    me.pos.x = 1; me.yaw = 1;
    it.apply([me], [], 0.5, me);
    expect(me.pos.x).toBeCloseTo(0.5);
    expect(me.yaw).toBe(1);
    it.restore();
  });
});

describe('DynamicResolution', () => {
  const budget = 1000 / 60;
  it('drops the scale when the GPU is over budget and recovers when it has room', () => {
    const d = new DynamicResolution(); d.warmup = 0;
    let t = 0;
    for (let i = 0; i < 120; i++) d.update(t += 16.7, 22, 6, 22, budget);
    expect(d.scale).toBeLessThan(0.95);
    const low = d.scale;
    for (let i = 0; i < 25; i++) d.update(t += 16.7, 8, 6, 16.7, budget);    // under half a second of headroom: not yet
    expect(d.scale).toBe(low);
    for (let i = 0; i < 400; i++) d.update(t += 16.7, 8, 6, 16.7, budget);
    expect(d.scale).toBeGreaterThan(low);
  });

  it('settles where the GPU fits instead of sinking (load proportional to pixels)', () => {
    const d = new DynamicResolution(); d.warmup = 0; d.max = 1.25; d.reset(1.25);
    let t = 0;
    const full = 20;                                                        // GPU ms at scale 1
    for (let i = 0; i < 3000; i++) { const g = full * d.scale * d.scale; d.update(t += 16.7, g, 6, Math.max(16.7, g), budget); }
    const g = full * d.scale * d.scale;
    expect(g).toBeLessThan(budget * 0.95);                                   // holds the frame rate
    expect(g).toBeGreaterThan(budget * 0.6);                                 // without throwing away resolution
  });

  it('holds the scale through the first seconds of a match (uploads and warm-up are not GPU load)', () => {
    const d = new DynamicResolution();
    let t = 0;
    for (let i = 0; i < 150; i++) d.update(t += 16.7, 60, 5, 60, budget);   // 2.5 s of terrible frames at the start
    expect(d.scale).toBe(1);
    for (let i = 0; i < 60; i++) d.update(t += 16.7, 60, 5, 60, budget);
    expect(d.scale).toBeLessThan(1);
  });

  it('never blurs a CPU-bound frame (GPU idle, frame long)', () => {
    const d = new DynamicResolution(); d.warmup = 0;
    let t = 0;
    for (let i = 0; i < 300; i++) d.update(t += 25, 7, 24, 25, budget);
    expect(d.scale).toBe(1);
  });

  it('panics down at once on a GPU spike, within its limits', () => {
    const d = new DynamicResolution(); d.warmup = 0;
    d.update(0, 10, 5, 16.7, budget);
    for (let i = 1; i <= 3; i++) d.update(i, 40, 5, 40, budget);
    expect(d.scale).toBeLessThan(1);
    expect(d.scale).toBeGreaterThanOrEqual(0.8);
    let t = 10;
    for (let i = 0; i < 2000; i++) d.update(t += 16.7, 60, 5, 60, budget);
    expect(d.scale).toBe(d.min);
  });
});
