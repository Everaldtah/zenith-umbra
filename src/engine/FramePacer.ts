// Frame timing for the render loop (engine core).
//  - measures the display's refresh interval from the requestAnimationFrame cadence
//  - hands out vsync-quantized frame deltas: rAF timestamps jitter by a fraction of a millisecond even when every frame
//    lands on its vblank, and animating with that raw jitter is the micro-stutter Croteam traced in "The Elusive Frame
//    Timing" (GDC 2018). A delta within 12% of a whole number of refresh intervals is snapped to it; the snapping error
//    is carried as a debt and paid back gradually, so game time never drifts from the wall clock (co-op stays in sync).
//  - paces a frame cap by deadline instead of "skip if too soon": the old test turned a 60 cap on a 144 Hz screen into
//    48 fps and a 144 cap on 240 Hz into 120. A cap that divides the refresh (60 on 120/240, 72 on 144) locks to every
//    n-th vblank exactly, so each frame is held on screen for the same time.

const RING = 120;

export class FramePacer {
  /** measured display refresh interval (ms) and rate */
  refreshMs = 1000 / 60;
  get refreshHz() { return 1000 / this.refreshMs; }
  /** true once the rAF cadence looks vsync-locked (steady intervals) - only then are deltas quantized */
  vsynced = false;
  private ring = new Float64Array(RING);
  private n = 0;
  private lastRaf = 0;
  private lastFrame = 0;
  private nextDue = 0;
  private debt = 0;

  /** called on every rAF tick: the delta (s) for a frame to run now, or -1 to skip this tick (frame cap) */
  tick(tms: number, capFps: number): number {
    if (this.lastRaf > 0) this.sample(tms - this.lastRaf);
    this.lastRaf = tms;
    if (this.lastFrame === 0) { this.lastFrame = tms; this.nextDue = tms; return 0; }
    // frame cap: run on the vblank nearest each deadline
    if (capFps > 0 && capFps < this.refreshHz * 0.97) {
      const per = this.capInterval(capFps), locked = this.vsynced && Math.abs(per / this.refreshMs - Math.round(per / this.refreshMs)) < 1e-6;
      if (tms < this.nextDue - this.refreshMs * 0.5) return -1;
      // a whole number of vblanks: count from the vblank just shown (phase-locked, the estimate's error can't build up);
      // otherwise keep the fractional remainder so the average holds the cap
      if (locked) this.nextDue = tms + per;
      else { this.nextDue += per; if (tms - this.nextDue > per) this.nextDue = tms + per; }   // fell behind: start over
    } else this.nextDue = tms;
    const raw = tms - this.lastFrame;
    this.lastFrame = tms;
    return Math.min(0.1, this.quantize(raw) / 1000);
  }

  /** the cap as a frame interval: a whole number of vblanks when the cap divides the refresh closely enough */
  capInterval(capFps: number): number {
    const ratio = this.refreshHz / capFps, k = Math.round(ratio);
    return this.vsynced && k >= 1 && Math.abs(ratio - k) < 0.06 ? k * this.refreshMs : 1000 / capFps;
  }

  private quantize(raw: number): number {
    if (!this.vsynced || raw <= 0) return raw;
    const k = Math.round(raw / this.refreshMs);
    const q = k >= 1 && Math.abs(raw - k * this.refreshMs) <= this.refreshMs * 0.12 ? k * this.refreshMs : raw;
    // the debt is the wall clock minus game time: the stamps' jitter (it telescopes - bounded) plus any error in the
    // refresh estimate (it builds up). Paid back 5% a frame, like a phase-locked loop: a fraction of a percent of
    // speed, never a visible jump, and game time stays within a frame of the clock
    this.debt += raw - q;
    const pay = this.debt * 0.05;
    this.debt -= pay;
    return q + pay;
  }

  private sample(d: number) {
    if (d <= 1 || d > 100) return;
    this.ring[this.n % RING] = d; this.n++;
    if (this.n < 30 || this.n % 30 !== 0) return;
    // the refresh is the low median of the recent intervals (dropped frames sit at 2x and above)
    const m = Math.min(this.n, RING), s = Array.from(this.ring.subarray(0, m)).sort((a, b) => a - b);
    const med = s[Math.floor(m * 0.4)];
    let close = 0, sum = 0;
    for (const x of s) if (Math.abs(x - med) < med * 0.08) { close++; sum += x; }
    // steady when most intervals sit on one value; the refresh is their mean (finer than any one rAF stamp)
    this.vsynced = close > m * 0.6 && med > 3.5;
    if (close > 0) this.refreshMs = sum / close;
  }
}
