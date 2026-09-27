// The desktop edition's recorded sound bank (public/sfx, made by assetgen/audio_finish.py): every sfx id's variations and
// every hero's voice lines, decoded up front so a gunshot never waits on a fetch. The web edition never loads it and keeps
// the synthesised recipes in Sfx.ts.
export interface BankInfo {
  sfx: Record<string, { n: number; cat: string; loop?: boolean }>;
  vo: Record<string, Record<string, number>>;          // voice -> line key -> count
  banks: Record<string, string>;                        // hero id -> voice bank (mechs speak through their pilots)
}

export class SampleBank {
  info: BankInfo | null = null;
  ready = false;
  private bufs = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();

  async load(ctx: AudioContext, base: string, onProgress?: (k: number) => void) {
    try {
      const r = await fetch(`${base}sfx/bank.json`);
      if (!r.ok) return;
      this.info = await r.json() as BankInfo;
    } catch { return; }
    const jobs: [string, string][] = [];
    for (const [id, s] of Object.entries(this.info!.sfx)) for (let i = 0; i < s.n; i++) jobs.push([`sfx:${id}`, `${base}sfx/${id}/${i}.ogg`]);
    for (const [v, keys] of Object.entries(this.info!.vo)) for (const [k, n] of Object.entries(keys)) for (let i = 0; i < n; i++) jobs.push([`vo:${v}:${k}`, `${base}sfx/vo/${v}/${k}_${i}.ogg`]);
    let done = 0;
    const one = async ([key, url]: [string, string]) => {
      try {
        const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
        const list = this.bufs.get(key) ?? []; list.push(buf); this.bufs.set(key, list);
      } catch { /* a missing line just falls back */ }
      onProgress?.(++done / jobs.length);
    };
    // a few decodes in flight at once
    const q = [...jobs];
    await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) await one(q.shift()!); }));
    this.ready = true;
  }

  has(id: string) { return this.bufs.has(`sfx:${id}`); }
  /** a variation of the sound, never the same one twice in a row */
  sfx(id: string): AudioBuffer | null { return this.pick(`sfx:${id}`); }
  hasLine(voice: string, key: string) { return this.bufs.has(`vo:${voice}:${key}`); }
  line(voice: string, key: string): AudioBuffer | null { return this.pick(`vo:${voice}:${key}`); }
  meta(id: string) { return this.info?.sfx[id]; }
  voiceOf(heroId: string) { return this.info?.banks?.[heroId] ?? heroId; }

  private pick(key: string): AudioBuffer | null {
    const l = this.bufs.get(key);
    if (!l?.length) return null;
    if (l.length === 1) return l[0];
    let i = Math.floor(Math.random() * l.length);
    if (i === this.last.get(key)) i = (i + 1) % l.length;
    this.last.set(key, i);
    return l[i];
  }
}
