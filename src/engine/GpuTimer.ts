// GPU frame time from EXT_disjoint_timer_query_webgl2 (engine core). Queries are pooled and read back a few frames
// later, only once the driver says the result is available - never a blocking read, so measuring costs no stall.
// Without the extension (or after a disjoint event: clock change, GPU reset) `ms` stays -1 and the dynamic
// resolution falls back to CPU-side frame timing.

export class GpuTimer {
  /** last measured GPU time of a whole frame (ms), smoothed; -1 = unavailable */
  ms = -1;
  /** the latest raw sample */
  last = -1;
  readonly supported: boolean;
  private ext: any;
  private free: WebGLQuery[] = [];
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.supported = !!this.ext;
  }

  begin() {
    if (!this.ext || this.active) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll() {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      this.pending.shift(); this.free.push(q);
      if (disjoint) continue;
      this.last = ns / 1e6;
      this.ms = this.ms < 0 ? this.last : this.ms + (this.last - this.ms) * 0.15;
    }
    // a driver that never reports back: don't let the queue grow without bound
    while (this.pending.length > 6) { const q = this.pending.shift()!; gl.deleteQuery(q); }
    if (disjoint) this.ms = -1;
  }

  dispose() {
    for (const q of [...this.free, ...this.pending]) this.gl.deleteQuery(q);
    this.free = []; this.pending = [];
  }
}
