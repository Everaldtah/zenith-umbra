// Physics particles for the 2D film, drawn in screen space (1920x1080) on the FX canvas.
// Semi-implicit Euler with gravity, quadratic drag, wind (with gusts), buoyancy (embers), ground collision + bounce + friction,
// flutter lift for paper / petals, trails for sparks, spawn-on-impact splashes for rain.
import { alpha, glow, rng, noise2 } from '../paint/core';

export type Kind = 'rain' | 'splash' | 'ember' | 'petal' | 'talisman' | 'spark' | 'debris' | 'dust' | 'star' | 'mote' | 'feather' | 'ash';
interface P {
  k: Kind; x: number; y: number; vx: number; vy: number; life: number; max: number; size: number;
  rot: number; vr: number; col: string; px: number; py: number; seed: number; z: number;
}
const SPEC: Record<Kind, { g: number; drag: number; bounce: number; buoy: number; flutter: number }> = {
  rain: { g: 2600, drag: 0.02, bounce: 0, buoy: 0, flutter: 0 },
  splash: { g: 1400, drag: 0.5, bounce: 0, buoy: 0, flutter: 0 },
  ember: { g: 0, drag: 1.2, bounce: 0, buoy: -160, flutter: 0.6 },
  petal: { g: 160, drag: 2.2, bounce: 0.1, buoy: 0, flutter: 1 },
  talisman: { g: 120, drag: 2.6, bounce: 0.05, buoy: 0, flutter: 1.3 },
  feather: { g: 90, drag: 2.8, bounce: 0.05, buoy: 0, flutter: 1.1 },
  spark: { g: 1600, drag: 0.8, bounce: 0.45, buoy: 0, flutter: 0 },
  debris: { g: 2200, drag: 0.3, bounce: 0.35, buoy: 0, flutter: 0 },
  dust: { g: -30, drag: 2.5, bounce: 0, buoy: 0, flutter: 0.2 },
  star: { g: 0, drag: 0, bounce: 0, buoy: 0, flutter: 0 },
  mote: { g: 0, drag: 1.5, bounce: 0, buoy: -20, flutter: 0.4 },
  ash: { g: 60, drag: 2, bounce: 0, buoy: 0, flutter: 0.8 },
};

export class Particles {
  list: P[] = [];
  wind = 0; gust = 0; ground = 1000;
  private r = rng(7);
  clear() { this.list.length = 0; }
  emit(k: Kind, n: number, x: number, y: number, o: { spread?: number; speed?: number; dir?: number; cone?: number; col?: string; size?: number; life?: number; w?: number; h?: number; z?: number } = {}) {
    const R = this.r;
    for (let i = 0; i < n; i++) {
      const a = (o.dir ?? -Math.PI / 2) + (R() - 0.5) * (o.cone ?? Math.PI * 2);
      const sp = (o.speed ?? 200) * (0.4 + R() * 0.8);
      const life = (o.life ?? 2) * (0.6 + R() * 0.8);
      this.list.push({
        k, x: x + (R() - 0.5) * (o.w ?? o.spread ?? 0), y: y + (R() - 0.5) * (o.h ?? o.spread ?? 0),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: (o.size ?? 6) * (0.6 + R() * 0.8),
        rot: R() * 6.28, vr: (R() - 0.5) * 8, col: o.col ?? '#ffffff', px: x, py: y, seed: R() * 1000, z: o.z ?? 1,
      });
    }
  }
  /** continuous emitters: rain / snow-like fields across the screen */
  field(k: Kind, rate: number, dt: number, o: Parameters<Particles['emit']>[4] = {}) {
    const n = rate * dt, whole = Math.floor(n) + (this.r() < n % 1 ? 1 : 0);
    for (let i = 0; i < whole; i++) {
      if (k === 'rain') this.emit('rain', 1, this.r() * 2300 - 200, -40, { dir: Math.PI / 2 + 0.12 + this.wind * 0.0002, cone: 0.04, speed: 1500, life: 1.2, size: 1, col: o.col ?? '#bcd4ff', z: 0.5 + this.r() });
      else if (k === 'ember') this.emit('ember', 1, this.r() * 1920, 1100, { dir: -Math.PI / 2, cone: 0.8, speed: 140, life: 3.5, size: 3, col: o.col ?? '#ff8a3a' });
      else if (k === 'petal' || k === 'ash' || k === 'feather' || k === 'talisman') this.emit(k, 1, this.r() * 2400 - 300, -30, { dir: Math.PI / 2, cone: 1, speed: 60, life: 9, size: o.size ?? 9, col: o.col ?? '#ffb7d5' });
      else if (k === 'mote') this.emit('mote', 1, this.r() * 1920, this.r() * 1080, { speed: 20, life: 4, size: 3, col: o.col ?? '#fff3c0' });
      else if (k === 'star') this.emit('star', 1, this.r() * 1920, this.r() * 700, { speed: 0, life: 3, size: 2, col: '#ffffff' });
    }
  }
  update(dt: number, t: number) {
    const gustW = this.wind + Math.sin(t * 0.7) * this.gust + (noise2(t * 0.5, 3) - 0.5) * this.gust;
    const out: P[] = [];
    for (const p of this.list) {
      p.life -= dt; if (p.life <= 0) continue;
      const S = SPEC[p.k];
      p.px = p.x; p.py = p.y;
      // forces
      let ax = 0, ay = S.g + S.buoy;
      const rvx = p.vx - gustW, sp = Math.hypot(rvx, p.vy);
      ax -= rvx * sp * S.drag * 0.004 * (1 / Math.max(0.5, p.size * 0.15)); ay -= p.vy * sp * S.drag * 0.004 * (1 / Math.max(0.5, p.size * 0.15));
      if (S.flutter) {   // paper / petals: lift depends on tilt -> falling leaf zig-zag
        const tilt = Math.sin(p.rot);
        ax += tilt * 90 * S.flutter; ay -= Math.abs(tilt) * 40 * S.flutter;
        p.vr += (Math.sin(t * 2 + p.seed) * 6 - p.vr) * dt * 2;
      }
      if (p.k === 'ember') { ax += Math.sin(t * 3 + p.seed) * 60; }
      p.vx += ax * dt; p.vy += ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      // ground
      if (p.y > this.ground && p.vy > 0) {
        if (p.k === 'rain') { if (this.r() < 0.35) this.emit('splash', 2, p.x, this.ground, { dir: -Math.PI / 2, cone: 1.6, speed: 160, life: 0.25, size: 1.5, col: p.col }); continue; }
        if (S.bounce > 0) { p.y = this.ground; p.vy *= -S.bounce; p.vx *= 0.7; p.vr *= 0.6; if (Math.abs(p.vy) < 30) { p.vy = 0; p.vx *= 0.9; } }
        else if (p.k !== 'ember' && p.k !== 'dust') { p.y = this.ground; p.vy = 0; p.vx *= 0.8; }
      }
      out.push(p);
    }
    this.list = out;
  }
  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.list) {
      const a = Math.min(1, p.life / Math.min(0.5, p.max * 0.3)) * Math.min(1, (p.max - p.life) / 0.08 + 0.2);
      ctx.save(); ctx.globalAlpha = a;
      switch (p.k) {
        case 'rain': ctx.strokeStyle = alpha(p.col, 0.45 * p.z); ctx.lineWidth = p.z; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke(); break;
        case 'splash': ctx.fillStyle = alpha(p.col, 0.6); ctx.fillRect(p.x, p.y, 2, 2); break;
        case 'ember': case 'mote': ctx.globalCompositeOperation = 'lighter'; glow(ctx, p.x, p.y, p.size * 4, p.col, 0.6 * (0.6 + 0.4 * Math.sin(p.seed + p.life * 20))); ctx.fillStyle = '#fff6d0'; ctx.fillRect(p.x - 1, p.y - 1, 2, 2); break;
        case 'star': { const tw = 0.5 + 0.5 * Math.sin(p.seed + p.life * 6); ctx.fillStyle = alpha('#ffffff', tw); ctx.fillRect(p.x, p.y, 2, 2); break; }
        case 'spark': ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = p.col; ctx.lineWidth = p.size * 0.4; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke(); break;
        case 'debris': ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.strokeStyle = '#140c18'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-p.size, -p.size * 0.6); ctx.lineTo(p.size * 0.8, -p.size * 0.8); ctx.lineTo(p.size, p.size * 0.5); ctx.lineTo(-p.size * 0.6, p.size); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
        case 'dust': ctx.fillStyle = alpha(p.col, 0.25); ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + (p.max - p.life) * 2), 0, 6.28); ctx.fill(); break;
        case 'petal': case 'feather': case 'ash': ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.8 + 0.2); ctx.fillStyle = p.col; ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * (p.k === 'feather' ? 0.3 : 0.55), 0, 0, 6.28); ctx.fill(); if (p.k !== 'ash') { ctx.strokeStyle = alpha('#3a2458', 0.4); ctx.lineWidth = 1; ctx.stroke(); } break;
        case 'talisman': ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(Math.cos(p.rot * 1.3), 1); ctx.fillStyle = '#fbf6e8'; ctx.fillRect(-p.size * 0.5, -p.size * 1.3, p.size, p.size * 2.6); ctx.strokeStyle = '#c0283a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(0, p.size); ctx.moveTo(-p.size * 0.3, -p.size * 0.4); ctx.lineTo(p.size * 0.3, -p.size * 0.4); ctx.stroke(); break;
      }
      ctx.restore();
    }
  }
}
