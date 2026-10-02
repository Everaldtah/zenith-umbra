// Dynamic render scale (engine core), after Unreal's dynamic resolution as Fortnite ships it: the scene's resolution
// follows the GPU's measured frame time against the frame budget, with headroom, a panic drop and slow recovery.
// What it fixes in the old controller: that one lowered the resolution whenever the frame rate was under target - but
// a CPU-bound frame (the common case in a 10-hero fight) doesn't get faster with fewer pixels, it just gets blurrier.
// This one only trades pixels when the GPU is the bottleneck. Scale moves in 5% steps and changes rarely (each change
// re-allocates the post chain's targets): down at most every 0.5 s (immediately on a panic), up at most every 2 s.

export class DynamicResolution {
  scale = 1;
  min = 0.5;
  max = 1;
  /** fraction of the frame budget the GPU should use (the rest absorbs spikes) */
  headroom = 0.85;
  private ema = -1;
  private lastChange = 0;
  private over = 0;

  reset(scale: number) { this.scale = scale; this.ema = -1; this.over = 0; }

  /**
   * @param now     ms clock
   * @param gpuMs   measured GPU time of the last frames (-1 = unknown)
   * @param cpuMs   CPU time the frame's own work took (main thread)
   * @param frameMs the frame's wall interval
   * @param budget  target frame time (ms)
   * @returns true when `scale` changed
   */
  update(now: number, gpuMs: number, cpuMs: number, frameMs: number, budget: number): boolean {
    // without a GPU timer: infer GPU load from the frame interval, but only when the CPU isn't what's slow
    const load = gpuMs > 0 ? gpuMs : cpuMs < budget * 0.7 ? frameMs * 0.9 : -1;
    if (load <= 0) { this.over = 0; return false; }
    this.ema = this.ema < 0 ? load : this.ema + (load - this.ema) * 0.1;
    const want = budget * this.headroom;
    this.over = load > budget * 1.5 ? this.over + 1 : 0;
    const panic = this.over >= 3;
    const since = now - this.lastChange;
    let next = this.scale;
    if (panic || (this.ema > budget * 0.95 && since > 500)) {
      // pixel cost ~ scale^2: the scale that would bring the load down to the target, at least one step, at most four
      const fit = this.scale * Math.sqrt(want / (panic ? load : this.ema));
      next = Math.max(this.min, Math.min(this.scale - 0.05, Math.max(this.scale - 0.2, fit)));
    } else if (this.ema < want * 0.8 && since > 2000 && this.scale < this.max) {
      const fit = this.scale * Math.sqrt(want / this.ema);
      if (fit > this.scale + 0.05) next = Math.min(this.max, this.scale + 0.05);
    }
    next = Math.min(this.max, Math.max(this.min, Math.round(next * 20) / 20));
    if (Math.abs(next - this.scale) < 1e-6) return false;
    this.scale = next; this.lastChange = now; this.over = 0;
    this.ema = -1;                                   // the old load no longer describes the new resolution
    return true;
  }
}
