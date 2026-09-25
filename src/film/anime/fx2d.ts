// 2D anime effects, drawn in screen space. Timing parameter k runs 0..1 over the effect's life.
import { type Ctx, type Pt, alpha, glow, rng, clamp, easeOut, lerp } from '../paint/core';

export const W = 1920, H = 1080;

/** radial focus lines (the "shock" background of every anime reaction / impact) */
export function focusLines(ctx: Ctx, cx: number, cy: number, t: number, o: { col?: string; inner?: number; n?: number; a?: number; fill?: boolean } = {}) {
  const r = rng(Math.floor(t * 24)), R = Math.hypot(W, H);
  ctx.save();
  if (o.fill) { ctx.fillStyle = alpha(o.col ?? '#ffffff', 0.08); ctx.fillRect(0, 0, W, H); }
  ctx.fillStyle = alpha(o.col ?? '#ffffff', o.a ?? 0.75);
  for (let i = 0; i < (o.n ?? 140); i++) {
    const a = r() * Math.PI * 2, w = 0.002 + r() * 0.012, r0 = (o.inner ?? 300) * (0.8 + r() * 0.7);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R);
    ctx.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R);
    ctx.fill();
  }
  ctx.restore();
}
/** parallel speed lines (a character dashing across) */
export function speedLines(ctx: Ctx, ang: number, t: number, o: { col?: string; n?: number; a?: number } = {}) {
  const r = rng(Math.floor(t * 30));
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(ang);
  for (let i = 0; i < (o.n ?? 90); i++) {
    const y = (r() - 0.5) * H * 1.8, len = 300 + r() * 1200, x = (r() - 0.5) * W * 2.2;
    ctx.fillStyle = alpha(o.col ?? '#ffffff', (o.a ?? 0.5) * (0.3 + r() * 0.7));
    ctx.fillRect(x, y, len, 1 + r() * 4);
  }
  ctx.restore();
}
/** impact frame: posterise to two tones (the sakura / Gainax hit frame). Applied in the post shader; here a flash layer. */
export function flashRing(ctx: Ctx, x: number, y: number, k: number, col = '#ffffff', r = 500) {
  const e = easeOut(k);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = alpha(col, 1 - k); ctx.lineWidth = 40 * (1 - k) + 2;
  ctx.beginPath(); ctx.ellipse(x, y, r * e, r * e * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
  glow(ctx, x, y, r * 0.8 * (1 - k * 0.5), col, 0.9 * (1 - k));
  ctx.restore();
}
/** lightning bolt with branches (deterministic per seed, re-rolled every few frames for crackle) */
export function lightning(ctx: Ctx, a: Pt, b: Pt, t: number, col = '#8ad8ff', w = 5, seed = 1) {
  const r = rng(seed * 97 + Math.floor(t * 20));
  const bolt = (p0: Pt, p1: Pt, width: number, depth: number) => {
    const pts: Pt[] = [p0]; const n = 10;
    for (let i = 1; i < n; i++) { const k = i / n; pts.push([lerp(p0[0], p1[0], k) + (r() - 0.5) * 70 * (1 - depth * 0.3), lerp(p0[1], p1[1], k) + (r() - 0.5) * 70 * (1 - depth * 0.3)]); }
    pts.push(p1);
    for (const [lw, c] of [[width * 4, alpha(col, 0.25)], [width * 1.6, col], [width * 0.5, '#ffffff']] as [number, string][]) {
      ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
    if (depth < 2) for (let i = 2; i < n - 2; i += 3) if (r() < 0.6) { const s = pts[i]; bolt(s, [s[0] + (r() - 0.3) * 260, s[1] + (r() - 0.2) * 220], width * 0.5, depth + 1); }
  };
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; bolt(a, b, w, 0); glow(ctx, b[0], b[1], 120, col, 0.8); ctx.restore();
}
/** sword slash: a crescent smear with a hot core */
export function slash(ctx: Ctx, x: number, y: number, r: number, a0: number, a1: number, k: number, col = '#8ad8ff') {
  const e = easeOut(clamp(k * 1.6)), fade = 1 - clamp((k - 0.4) / 0.6);
  const a = lerp(a0, a1, e);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [wid, c, al] of [[60, col, 0.35], [22, col, 0.9], [7, '#ffffff', 1]] as [number, string, number][]) {
    ctx.strokeStyle = alpha(c, al * fade); ctx.lineWidth = wid; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r, a0, a, a1 < a0); ctx.stroke();
  }
  ctx.restore();
}
/** Evangelion cross explosion: a pillar of light with a cross beam, blooming then fading */
export function evaCross(ctx: Ctx, x: number, y: number, k: number, col = '#ffd0a0', s = 1) {
  const grow = easeOut(clamp(k * 3)), fade = 1 - clamp((k - 0.35) / 0.65);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const hw = 60 * s * grow, vh = 1200 * s * grow, hb = 520 * s * grow;
  for (const [m, a] of [[3, 0.25], [1.4, 0.6], [0.5, 1]] as [number, number][]) {
    const g = ctx.createLinearGradient(x - hw * m, 0, x + hw * m, 0);
    g.addColorStop(0, alpha(col, 0)); g.addColorStop(0.5, alpha(m < 1 ? '#ffffff' : col, a * fade)); g.addColorStop(1, alpha(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - hw * m, y - vh, hw * m * 2, vh * 1.05);
    const g2 = ctx.createLinearGradient(0, y - vh * 0.72 - hw * m * 0.6, 0, y - vh * 0.72 + hw * m * 0.6);
    g2.addColorStop(0, alpha(col, 0)); g2.addColorStop(0.5, alpha(m < 1 ? '#ffffff' : col, a * fade)); g2.addColorStop(1, alpha(col, 0));
    ctx.fillStyle = g2; ctx.fillRect(x - hb * m * 0.5, y - vh * 0.72 - hw * m * 0.6, hb * m, hw * m * 1.2);
  }
  glow(ctx, x, y, 500 * s * grow, col, 0.9 * fade);
  ctx.restore();
}
/** Gurren-Lagann drill spiral (spinning cone of stripes) */
export function drill(ctx: Ctx, x: number, y: number, ang: number, len: number, rad: number, t: number, col = '#ff3355', col2 = '#1a1016') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, -rad); ctx.lineTo(len, 0); ctx.lineTo(0, rad); ctx.closePath();
  ctx.fillStyle = col2; ctx.fill(); ctx.save(); ctx.clip();
  const ph = (t * 3) % 1;
  for (let i = -1; i < 9; i++) {
    const u = (i + ph) / 8, x0 = u * len;
    ctx.fillStyle = i % 2 ? col : '#ffd0d0';
    ctx.beginPath(); ctx.moveTo(x0, -rad); ctx.lineTo(x0 + len / 16, -rad); ctx.lineTo(x0 + len / 8 + len / 16, rad); ctx.lineTo(x0 + len / 8, rad); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#140c18'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -rad); ctx.lineTo(len, 0); ctx.lineTo(0, rad); ctx.stroke();
  glow(ctx, len, 0, rad * 1.6, col, 0.7);
  ctx.restore();
}
/** spiral burst (Gurren's spiral energy, behind a hero) */
export function spiral(ctx: Ctx, x: number, y: number, r: number, t: number, col = '#7cff9a', a = 0.6) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(t * 2); ctx.globalCompositeOperation = 'lighter';
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath();
    for (let i = 0; i < 120; i++) { const u = i / 120, ang = arm * 2.094 + u * 9, rr = u * r; const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.strokeStyle = alpha(col, a); ctx.lineWidth = 10; ctx.stroke(); ctx.strokeStyle = alpha('#ffffff', a); ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}
export function shockwave(ctx: Ctx, x: number, y: number, k: number, r: number, col = '#ffd76a') {
  const e = easeOut(k);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = alpha(col, 1 - k); ctx.lineWidth = 30 * (1 - k) + 3;
  ctx.beginPath(); ctx.ellipse(x, y, r * e, r * e * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = alpha('#ffffff', 0.8 * (1 - k)); ctx.lineWidth = 6 * (1 - k); ctx.stroke();
  ctx.restore();
}
export function beam(ctx: Ctx, a: Pt, b: Pt, w: number, col: string, k = 1, t = 0) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const flick = 0.85 + Math.sin(t * 60) * 0.15;
  for (const [m, c, al] of [[4, col, 0.25], [1.8, col, 0.8], [0.6, '#ffffff', 1]] as [number, string, number][]) {
    ctx.strokeStyle = alpha(c, al * k); ctx.lineWidth = w * m * flick; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  glow(ctx, b[0], b[1], w * 6, col, 0.8 * k);
  ctx.restore();
}
/** hexagon barrier (Tenkai's bulwark, Kaien's seal) */
export function hexShield(ctx: Ctx, x: number, y: number, rw: number, rh: number, k: number, col = '#ffd76a', t = 0) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.ellipse(0, 0, rw * k, rh * k, 0, 0, Math.PI * 2); ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const s = 34;
  for (let gy = -rh; gy < rh; gy += s * 0.87) for (let gx = -rw; gx < rw; gx += s * 1.5) {
    const ox = gx + ((Math.round(gy / (s * 0.87)) % 2) ? s * 0.75 : 0);
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ctx.lineTo(ox + Math.cos(a) * s * 0.48, gy + Math.sin(a) * s * 0.48); } ctx.closePath();
    const pulse = 0.25 + 0.2 * Math.sin(t * 6 + ox * 0.02 + gy * 0.03);
    ctx.fillStyle = alpha(col, pulse * 0.5); ctx.fill(); ctx.strokeStyle = alpha(col, 0.8); ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}
export function strings(ctx: Ctx, from: Pt, tos: Pt[], t: number, col = '#c77dff') {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [i, to] of tos.entries()) {
    const sag = 40 + Math.sin(t * 3 + i) * 20;
    ctx.strokeStyle = alpha(col, 0.9); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.quadraticCurveTo((from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + sag, to[0], to[1]); ctx.stroke();
    glow(ctx, to[0], to[1], 18, col, 0.6);
  }
  ctx.restore();
}
/** Evangelion title card: white condensed serif on black, mixed sizes */
export function evaCard(ctx: Ctx, lines: [string, number][], k: number) {
  ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = alpha('#ffffff', clamp(k * 8)); ctx.textBaseline = 'alphabetic';
  let y = H * 0.24;
  for (const [txt, size] of lines) {   // baseline advances by each line's own cap height, so big lines never ride up into small ones
    y += size * 0.86;
    ctx.save(); ctx.font = `900 ${size}px "Times New Roman", "Noto Serif", serif`; ctx.translate(W * 0.12, y); ctx.scale(0.78, 1); ctx.fillText(txt, 0, 0); ctx.restore();
    y += size * 0.18;
  }
  ctx.restore();
}
/** big Gurren-style shout text */
export function shout(ctx: Ctx, txt: string, x: number, y: number, size: number, k: number, col = '#ffd23a') {
  const s = 1 + (1 - easeOut(clamp(k * 5))) * 0.8;
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.08); ctx.scale(s, s);
  ctx.font = `italic 900 ${size}px Impact, "Arial Black", sans-serif`; ctx.textAlign = 'center';
  ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#140c18'; ctx.strokeText(txt, 0, 0);
  const g = ctx.createLinearGradient(0, -size, 0, 0); g.addColorStop(0, '#fff6c0'); g.addColorStop(1, col);
  ctx.fillStyle = g; ctx.fillText(txt, 0, 0);
  ctx.restore();
}
/** 80s lens flare streak */
export function flare(ctx: Ctx, x: number, y: number, s: number, col = '#ffe0a0') {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(x - 900 * s, 0, x + 900 * s, 0);
  g.addColorStop(0, alpha(col, 0)); g.addColorStop(0.5, alpha(col, 0.7)); g.addColorStop(1, alpha(col, 0));
  ctx.fillStyle = g; ctx.fillRect(x - 900 * s, y - 3 * s, 1800 * s, 6 * s);
  glow(ctx, x, y, 140 * s, col, 0.9);
  for (const [d, r] of [[0.4, 30], [0.7, 18], [1.1, 50]] as [number, number][]) { ctx.strokeStyle = alpha(col, 0.25); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + (W / 2 - x) * d * 2, y + (H / 2 - y) * d * 2, r * s, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
