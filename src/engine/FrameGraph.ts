// Frame-time graph for the advanced performance overlay (Options > Video > Performance Stats: advanced, or the perf
// key): the last 160 frame intervals as bars against the display's refresh budget - green on time, amber late,
// red a dropped frame (2x+) - with the GPU's time per frame as a cyan line. Smoothness you can see, not just an
// average: one hitch shows as one red spike.

const N = 160, W = 280, H = 72;

export class FrameGraph {
  private cv: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dts = new Float32Array(N);
  private gpu = new Float32Array(N);
  private i = 0;

  show(host: HTMLElement, on: boolean) {
    if (on && !this.cv) {
      this.cv = document.createElement('canvas');
      this.cv.width = W; this.cv.height = H;
      this.cv.style.cssText = 'position:absolute;left:10px;top:150px;width:280px;height:72px;pointer-events:none;z-index:5;background:rgba(0,0,0,.45);border-radius:2px';
      host.append(this.cv);
      this.ctx = this.cv.getContext('2d');
    }
    if (this.cv) this.cv.style.display = on ? '' : 'none';
  }

  /** one rendered frame: its interval and GPU time (ms; gpu < 0 = unknown) against the refresh interval */
  push(dtMs: number, gpuMs: number, budgetMs: number) {
    this.dts[this.i % N] = dtMs; this.gpu[this.i % N] = gpuMs; this.i++;
    const c = this.ctx;
    if (!c || this.cv!.style.display === 'none') return;
    const scale = H / (budgetMs * 3);                  // the graph shows 0..3x the budget
    c.clearRect(0, 0, W, H);
    const bw = W / N;
    for (let k = 0; k < N; k++) {
      const j = (this.i + k) % N, d = this.dts[j];
      if (!d) continue;
      c.fillStyle = d > budgetMs * 1.9 ? '#ff4d5e' : d > budgetMs * 1.15 ? '#ffb347' : '#5be37d';
      const h = Math.min(H, d * scale);
      c.fillRect(k * bw, H - h, Math.max(1, bw - 0.4), h);
    }
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1;
    for (const m of [1, 2]) { const y = Math.round(H - budgetMs * m * scale) + 0.5; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.strokeStyle = '#4fd7ff'; c.beginPath();
    let pen = false;
    for (let k = 0; k < N; k++) {
      const g = this.gpu[(this.i + k) % N];
      if (!(g > 0)) { pen = false; continue; }
      const x = k * bw + bw / 2, y = H - Math.min(H, g * scale);
      if (pen) c.lineTo(x, y); else { c.moveTo(x, y); pen = true; }
    }
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,.8)'; c.font = '600 10px Consolas, monospace';
    c.fillText(`${budgetMs.toFixed(1)} ms`, 3, H - budgetMs * scale - 3);
  }
}
