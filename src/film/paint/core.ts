// 2D anime painting core: canvas helpers, colour math, easing, value noise, brush / cel primitives.
export const W = 1920, H = 1080;
export type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------- math
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const ease = (k: number) => { k = clamp(k); return k * k * (3 - 2 * k); };
export const easeOut = (k: number) => 1 - Math.pow(1 - clamp(k), 3);
export const easeIn = (k: number) => Math.pow(clamp(k), 3);
export const easeInOut = (k: number) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
/** 0..1 over [a,b] of k */
export const seg = (k: number, a: number, b: number) => clamp((k - a) / (b - a));
export const back = (k: number) => { const c = 1.7; k = clamp(k); return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
/** deterministic pseudo random from an integer seed */
export function rng(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export const hash = (x: number, y = 0) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

// value noise + fbm (for clouds, paper, smoke)
export function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x: number, y: number, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- colour
export function hex2rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
/** mix two hex colours */
export function mix(a: string, b: string, k: number, alpha = 1) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb(lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k), alpha);
}
/** cel shadow: darker, hue shifted toward violet (anime shading) */
export const shade = (c: string, k = 0.32) => mix(c, '#3a2458', k);
export const light = (c: string, k = 0.35) => mix(c, '#fffaf0', k);
export const alpha = (c: string, a: number) => { const [r, g, b] = hex2rgb(c); return rgb(r, g, b, a); };

// ---------------------------------------------------------------- canvas
export function canvas(w = W, h = H): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
export type Pt = [number, number];
export function path(ctx: Ctx, pts: Pt[], close = true) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}
/** smooth closed shape through points (Catmull-Rom -> Bezier) */
export function smooth(ctx: Ctx, pts: Pt[], close = true, tension = 0.5) {
  const n = pts.length; if (n < 3) return path(ctx, pts, close);
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  const P = (i: number) => pts[close ? (i + n) % n : clamp(i, 0, n - 1)];
  const last = close ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const t = tension / 3;
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t, p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t, p2[0], p2[1]);
  }
  if (close) ctx.closePath();
}
export const INK = '#1a1022';
/** fill + ink outline (the anime cel look) */
export function cel(ctx: Ctx, fill: string | CanvasGradient, lw = 3, ink = INK) {
  ctx.fillStyle = fill; ctx.fill();
  if (lw > 0) { ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
}
/** tapered capsule from a to b (limbs) */
export function capsule(ctx: Ctx, a: Pt, b: Pt, w0: number, w1: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  ctx.beginPath();
  ctx.moveTo(a[0] + nx * w0, a[1] + ny * w0);
  ctx.lineTo(b[0] + nx * w1, b[1] + ny * w1);
  ctx.arc(b[0], b[1], w1, Math.atan2(ny, nx), Math.atan2(-ny, -nx));
  ctx.lineTo(a[0] - nx * w0, a[1] - ny * w0);
  ctx.arc(a[0], a[1], w0, Math.atan2(-ny, -nx), Math.atan2(ny, nx));
  ctx.closePath();
}
/** glow: additive radial blob */
export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, a = 0.8) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(color, a)); g.addColorStop(0.35, alpha(color, a * 0.45)); g.addColorStop(1, alpha(color, 0));
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
}
/** a painterly brush stroke (layered semi-transparent dabs along a path) */
export function brush(ctx: Ctx, pts: Pt[], width: number, color: string, a = 0.5, seed = 1) {
  const r = rng(seed);
  ctx.save(); ctx.fillStyle = color;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, L / (width * 0.3));
    for (let j = 0; j < n; j++) {
      const k = j / n, x = lerp(x0, x1, k) + (r() - 0.5) * width * 0.3, y = lerp(y0, y1, k) + (r() - 0.5) * width * 0.3;
      ctx.globalAlpha = a * (0.4 + r() * 0.6);
      ctx.beginPath(); ctx.ellipse(x, y, width * (0.4 + r() * 0.3), width * (0.25 + r() * 0.2), r() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
export function vgrad(ctx: Ctx, y0: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, y0, 0, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g;
}
