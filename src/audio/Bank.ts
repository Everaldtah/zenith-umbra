// The desktop edition's recorded sound bank (public/sfx, made by assetgen/audio_finish.py): every sfx id's variations and
// every hero's voice lines, decoded up front so a gunshot never waits on a fetch. The web edition never loads it and keeps
// the synthesised recipes in Sfx.ts.
export interface BankInfo {
  sfx: Record<string, { n: number; cat: string; loop?: boolean; ext?: string }>;
  vo: Record<string, Record<string, number>>;          // voice -> line key -> count
  subs?: Record<string, Record<string, string[]>>;      // voice -> line key -> the words of each take (subtitles)
  banks: Record<string, string>;                        // hero id -> voice bank (mechs speak through their pilots)
}

export class SampleBank {
  info: BankInfo | null = null;
  ready = false;
  private bufs = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();
  private idx = new WeakMap<AudioBuffer, number>();
  /** the words of a voice line buffer (subtitles), '' if unknown */
  words(voice: string, key: string, buf: AudioBuffer): string { const i = this.idx.get(buf); return i === undefined ? '' : this.info?.subs?.[voice]?.[key]?.[i] ?? ''; }

  async load(ctx: AudioContext, base: string, onProgress?: (k: number) => void) {
    this.loading = true;
    try {
      const r = await fetch(`${base}sfx/bank.json`);
      if (!r.ok) { this.loading = false; return; }
      this.info = await r.json() as BankInfo;
    } catch { this.loading = false; return; }
    const jobs: [string, string][] = [];
    // loops ship lossless (.flac: a sample-exact loop point), one-shots as Vorbis
    for (const [id, s] of Object.entries(this.info!.sfx)) for (let i = 0; i < s.n; i++) jobs.push([`sfx:${id}`, `${base}sfx/${id}/${i}.${s.ext ?? 'ogg'}`]);
    for (const [v, keys] of Object.entries(this.info!.vo)) for (const [k, n] of Object.entries(keys)) for (let i = 0; i < n; i++) jobs.push([`vo:${v}:${k}`, `${base}sfx/vo/${v}/${k}_${i}.ogg`]);
    let done = 0;
    const one = async ([key, url]: [string, string]) => {
      try {
        const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
        // each line remembers which take it is (decodes finish in any order): the subtitle is looked up by it
        const m = /_(\d+)\.ogg$/.exec(url); if (m) this.idx.set(buf, +m[1]);
        const list = this.bufs.get(key) ?? []; list.push(buf); this.bufs.set(key, list);
      } catch { /* a missing line just falls back */ }
      onProgress?.(++done / jobs.length);
    };
    // a few decodes in flight at once; heroes in the match jump the queue (prioritize)
    this.queue = [...jobs];
    if (this.want.size) this.prioritize([...this.want]);
    const q = this.queue;
    await Promise.all(Array.from({ length: 12 }, async () => { while (q.length) { this.inFlight++; try { await one(q.shift()!); } finally { this.inFlight--; } } }));
    this.ready = true; this.loading = false;
  }

  /** jobs still waiting to decode for these voices, plus every sound effect (the preloader waits on this) */
  pendingFor(voices: string[]) {
    if (!this.info) return this.loading ? 1 : 0;
    const hit = (k: string) => k.startsWith('sfx:') || voices.some(v => k.startsWith(`vo:${v}:`));
    return this.queue.filter(j => hit(j[0])).length + this.inFlight;
  }
  private loading = false;
  private inFlight = 0;
  private queue: [string, string][] = [];
  private want = new Set<string>();
  /** decode these voices' lines next (the heroes in the match that's starting): 580+ lines take ~30s to decode all */
  prioritize(voices: string[]) {
    for (const v of voices) this.want.add(v);
    const hit = (k: string) => voices.some(v => k.startsWith(`vo:${v}:`)) || k.startsWith('vo:announcer:');
    const first = this.queue.filter(j => hit(j[0])), rest = this.queue.filter(j => !hit(j[0]));
    this.queue.length = 0; this.queue.push(...first, ...rest);
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
