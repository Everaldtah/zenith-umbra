// Acoustic space for the desktop edition, after Overwatch's "play by sound" (GDC 2016): a per-map reverb (outdoor vs
// indoor, crossfaded by what's over the listener's head) and a QUAD DELAY - four reflection taps whose delay, level and
// tone come from how far the walls are in front of / right of / behind / left of the listener, so a shot rings back off
// the alley walls you're standing between and not in an open plaza.
export interface Acoustic { decay: number; wet: number; predelay: number; damp: number; early: number }

/** per-map outdoor reverb, plus the shared indoor room */
export const SPACE: Record<string, Acoustic> = {
  amatsu: { decay: 1.1, wet: 0.14, predelay: 0.02, damp: 5200, early: 0.25 },
  kurogane: { decay: 1.5, wet: 0.2, predelay: 0.015, damp: 4200, early: 0.5 },
  hangar: { decay: 2.6, wet: 0.3, predelay: 0.03, damp: 3800, early: 0.6 },
  cathedral: { decay: 3.4, wet: 0.32, predelay: 0.04, damp: 3200, early: 0.55 },
  rift: { decay: 2.8, wet: 0.26, predelay: 0.05, damp: 2600, early: 0.2 },
  hanabi: { decay: 1.2, wet: 0.15, predelay: 0.02, damp: 5000, early: 0.35 },
  cloudstep: { decay: 1.0, wet: 0.12, predelay: 0.025, damp: 5600, early: 0.2 },
  kagura: { decay: 1.4, wet: 0.18, predelay: 0.015, damp: 4600, early: 0.55 },
  training: { decay: 1.3, wet: 0.16, predelay: 0.02, damp: 4800, early: 0.4 },
};
export const ROOM: Acoustic = { decay: 0.75, wet: 0.24, predelay: 0.008, damp: 4000, early: 0.8 };

/** a stereo impulse response: sparse early reflections, then decorrelated exponentially decaying noise, darker as it dies */
export function impulse(ctx: BaseAudioContext, a: Acoustic): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.ceil(sr * (a.decay + a.predelay + 0.1));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    const pre = Math.floor(a.predelay * sr);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.pow(10, (-60 * t / a.decay) / 20);
      // one-pole low-pass whose cutoff falls with time: high frequencies die first
      const fc = a.damp * Math.exp(-t * 1.6) + 400, k = 1 - Math.exp(-2 * Math.PI * fc / sr);
      lp += ((Math.random() * 2 - 1) - lp) * k;
      d[i] = lp * env;
    }
    // early reflections: a handful of discrete taps in the first 60 ms
    for (let e = 0; e < 7; e++) {
      const at = pre + Math.floor((0.004 + Math.random() * 0.055) * sr);
      d[at] += (Math.random() < 0.5 ? -1 : 1) * a.early * (1 - e / 8);
    }
  }
  return buf;
}

/** four reflection taps (front / right / back / left of the listener) */
export class QuadDelay {
  input: GainNode;
  private taps: { delay: DelayNode; lp: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode }[] = [];
  constructor(ctx: AudioContext, out: AudioNode) {
    this.input = ctx.createGain();
    const pans = [0, 0.8, 0, -0.8];
    for (let i = 0; i < 4; i++) {
      const delay = ctx.createDelay(1), lp = ctx.createBiquadFilter(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      lp.type = 'lowpass'; lp.frequency.value = 3500; gain.gain.value = 0; pan.pan.value = pans[i];
      this.input.connect(delay); delay.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect(out);
      this.taps.push({ delay, lp, gain, pan });
    }
  }
  /** distances (m) to the nearest wall in each of the four directions; Infinity = open */
  set(ctx: AudioContext, dist: number[]) {
    const t = ctx.currentTime;
    dist.forEach((d, i) => {
      const T = this.taps[i];
      if (!Number.isFinite(d) || d > 60) { T.gain.gain.setTargetAtTime(0, t, 0.15); return; }
      T.delay.delayTime.setTargetAtTime(Math.min(0.9, (2 * d) / 343), t, 0.08);
      T.gain.gain.setTargetAtTime(0.42 / (1 + d / 9), t, 0.15);
      T.lp.frequency.setTargetAtTime(5200 / (1 + d / 25), t, 0.15);
    });
  }
}
