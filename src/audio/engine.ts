/**
 * Battle audio: pre-rendered score (calm M2 ↔ battle M1, victory M3) and layered effect samples,
 * rendered offline by tools/audio/build_assets.py (MuseScore_General soundfont, MIT).
 *
 * Browsers only let audio start after a user gesture. `boot()` runs at page load: it creates the
 * context, starts loading the assets and tries to resume (succeeds when the browser allows autoplay);
 * otherwise the first click / key / touch anywhere calls `unlock()`.
 */
import manifest from './assets/manifest.json';
import { click } from './instruments';
import {
  duckFor,
  explosionTier,
  musicIntensity,
  MusicModeSwitch,
  smoothIntensity,
  spatial,
  VariantPicker,
  VoiceLimiter,
  whistleOffset,
  type IntensityInput,
  type MusicMode,
} from './mix';

export type SoundState = 'off' | 'locked' | 'running';

const STORAGE_KEY = 'ew.sound';
const URLS = import.meta.glob('./assets/*.m4a', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlOf = (file: string) => URLS[`./assets/${file}`];

type SfxKey = keyof typeof manifest.sfx;
type TrackKey = keyof typeof manifest.music;

/* Levels from the approved in-context mix (S6/S7): score bed ≈ -24 dBFS RMS, hits ~12 dB above it. */
const MUSIC_BUS = 0.5;
const TRACK_TRIM: Record<TrackKey, number> = { calm: 1, battle: 1, victory: 0.95 };
const SFX_GAIN: Partial<Record<SfxKey, number>> = {
  rifle_bull: 0.75,
  rifle_bear: 0.75,
  mg_bull: 0.8,
  mg_bear: 0.8,
  cannon: 1,
  expl_s: 0.8,
  expl_m: 0.9,
  expl_l: 1,
  expl_xl: 1,
  whistle: 0.9,
  flare: 0.7,
  horn: 0.85,
  fanfare_bulls: 0.95,
  fanfare_bears: 0.95,
};

export interface Graph {
  master: GainNode;
  music: GainNode;
  duck: GainNode;
  sfx: GainNode;
}

export function buildGraph(ctx: BaseAudioContext): Graph {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 6;
  comp.attack.value = 0.002;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 28;
  hp.connect(comp);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(hp);
  const duck = ctx.createGain();
  duck.connect(master);
  const music = ctx.createGain();
  music.gain.value = MUSIC_BUS;
  music.connect(duck);
  const sfx = ctx.createGain();
  sfx.gain.value = 1;
  sfx.connect(master);
  return { master, music, duck, sfx };
}

export interface SampleOpts {
  pan?: number;
  gain?: number;
  cutoff?: number;
  offset?: number;
  rate?: number;
}

/** Play one buffer through optional lowpass → gain → panner into `out`, starting at context time `at`. */
export function playBuffer(ctx: BaseAudioContext, out: AudioNode, buf: AudioBuffer, at: number, o: SampleOpts = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = o.rate ?? 1;
  let node: AudioNode = src;
  if (o.cutoff && o.cutoff < 15000) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.cutoff;
    node.connect(lp);
    node = lp;
  }
  const g = ctx.createGain();
  g.gain.value = o.gain ?? 1;
  const p = ctx.createStereoPanner();
  p.pan.value = o.pan ?? 0;
  node.connect(g).connect(p).connect(out);
  src.start(at, o.offset ?? 0);
  return src;
}

/** Duck the music bus: drop to `depth`, hold, then recover. */
export function duckMusic(duck: GainNode, at: number, kind: Parameters<typeof duckFor>[0]) {
  const { depth, hold, release } = duckFor(kind);
  duck.gain.cancelScheduledValues(at);
  duck.gain.setValueAtTime(duck.gain.value, at);
  duck.gain.linearRampToValueAtTime(depth, at + 0.06);
  duck.gain.setValueAtTime(depth, at + hold);
  duck.gain.linearRampToValueAtTime(1, at + hold + release);
}

/** Loads every asset in the manifest into AudioBuffers. */
export async function loadBuffers(ctx: BaseAudioContext): Promise<Map<string, AudioBuffer>> {
  const files = new Set<string>();
  for (const m of Object.values(manifest.music)) files.add(m.file);
  for (const list of Object.values(manifest.sfx)) for (const s of list) files.add(s.file);
  const out = new Map<string, AudioBuffer>();
  await Promise.all(
    [...files].map(async (file) => {
      const res = await fetch(urlOf(file));
      out.set(file, await ctx.decodeAudioData(await res.arrayBuffer()));
    }),
  );
  return out;
}

/** Calm ↔ battle crossfades (each entry restarts the track from its intro) and the victory cue. */
class MusicPlayer {
  mode: MusicMode | 'victory' | 'idle' = 'idle';
  private cur: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private resumeTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly bufs: Map<string, AudioBuffer>,
  ) {}

  private startTrack(key: TrackKey, at: number, fadeIn: number) {
    const meta = manifest.music[key];
    const buf = this.bufs.get(meta.file);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    if ('loopStart' in meta) {
      src.loop = true;
      src.loopStart = meta.loopStart;
      src.loopEnd = meta.loopStart + meta.loopLength;
    }
    const gain = this.ctx.createGain();
    const trim = TRACK_TRIM[key];
    gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : trim, at);
    if (fadeIn > 0) gain.gain.linearRampToValueAtTime(trim, at + fadeIn);
    src.connect(gain).connect(this.out);
    src.start(at);
    return { src, gain };
  }

  private fadeOut(at: number, seconds: number) {
    const c = this.cur;
    if (!c) return;
    c.gain.gain.cancelScheduledValues(at);
    c.gain.gain.setValueAtTime(c.gain.gain.value, at);
    c.gain.gain.linearRampToValueAtTime(0.0001, at + seconds);
    c.src.stop(at + seconds + 0.05);
    this.cur = null;
  }

  setMode(mode: MusicMode, at = this.ctx.currentTime) {
    if (this.mode === mode || this.mode === 'victory') return;
    this.fadeOut(at, this.mode === 'idle' ? 0 : 3);
    this.cur = this.startTrack(mode, at, this.mode === 'idle' ? 1.5 : 2.5);
    this.mode = mode;
  }

  /** Victory: fade the score, play M3 after the fanfare, then return to `next()`'s mode. */
  victory(at: number, next: () => MusicMode) {
    this.fadeOut(at, 0.8);
    clearTimeout(this.resumeTimer);
    this.mode = 'victory';
    const cueAt = at + 2.6;
    this.cur = this.startTrack('victory', cueAt, 0.4);
    const len = manifest.music.victory.seconds;
    if (typeof window !== 'undefined' && this.ctx instanceof AudioContext) {
      this.resumeTimer = setTimeout(() => {
        this.mode = 'idle';
        this.cur = null;
        this.setMode(next());
      }, (cueAt - this.ctx.currentTime + len - 1.5) * 1000);
    }
  }

  stop() {
    clearTimeout(this.resumeTimer);
    this.fadeOut(this.ctx.currentTime, 0.3);
    this.mode = 'idle';
  }
}

export function readSoundPref(search = globalThis.location?.search ?? ''): boolean {
  const q = new URLSearchParams(search).get('sound');
  if (q === '0' || q === 'off') return false;
  if (q === '1' || q === 'on') return true;
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export class AudioEngine {
  enabled: boolean;
  onState?: (s: SoundState) => void;
  private ctx: AudioContext | null = null;
  private g: Graph | null = null;
  private bufs = new Map<string, AudioBuffer>();
  private loaded = false;
  private music: MusicPlayer | null = null;
  private modeSwitch = new MusicModeSwitch();
  private intensity = 0.2;
  private target = 0.2;
  private forced: number | null = null;
  private picker = new VariantPicker();
  private lastMg = 0;
  private limiter = new VoiceLimiter({
    rifle: { max: 10, windowMs: 1000 },
    mg: { max: 1, windowMs: 1500 },
    cannon: { max: 4, windowMs: 1000 },
    explosion: { max: 6, windowMs: 1000 },
    whistle: { max: 3, windowMs: 1000 },
    flare: { max: 2, windowMs: 1000 },
  });

  constructor(enabled = readSoundPref()) {
    this.enabled = enabled;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  get state(): SoundState {
    if (!this.enabled) return 'off';
    return this.ctx && this.ctx.state === 'running' ? 'running' : 'locked';
  }

  get debug() {
    return {
      state: this.state,
      ctxState: this.ctx?.state ?? 'none',
      loaded: this.loaded,
      buffers: this.bufs.size,
      music: this.music?.mode ?? 'none',
      intensity: +this.intensity.toFixed(3),
      sampleRate: this.ctx?.sampleRate,
    };
  }

  /** Page load: create the context, preload assets, and try to start (works when autoplay is allowed). */
  boot() {
    if (!this.enabled || this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    this.g = buildGraph(this.ctx);
    this.music = new MusicPlayer(this.ctx, this.g.music, this.bufs);
    this.ctx.onstatechange = () => {
      this.startMusicIfReady();
      this.emit();
    };
    loadBuffers(this.ctx)
      .then((m) => {
        m.forEach((v, k) => this.bufs.set(k, v));
        this.loaded = true;
        this.startMusicIfReady();
        this.emit();
      })
      .catch((e) => console.warn('[audio] asset load failed', e));
    this.tryResume();
    this.emit();
  }

  /** Call from a user gesture (click / key / touch). Safe to call repeatedly. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this.boot();
    this.tryResume();
  }

  private tryResume() {
    if (this.ctx && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().then(() => this.emit(), () => this.emit());
  }

  private startMusicIfReady() {
    if (this.loaded && this.ctx?.state === 'running' && this.music && this.music.mode === 'idle') this.music.setMode(this.modeSwitch.mode);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    if (on) this.unlock();
    else this.ctx?.suspend().then(() => this.emit(), () => this.emit());
    this.emit();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    if (this.enabled && this.ctx && this.g && this.ctx.state === 'running') click(this.ctx, { dest: this.g.sfx }, this.ctx.currentTime + 0.01);
  }

  /** Market activity → battle intensity (called from the logic tick). */
  setActivity(input: IntensityInput) {
    this.target = musicIntensity(input);
  }

  /** Verification only: pin the intensity (null releases it). */
  debugForce(v: number | null) {
    this.forced = v;
  }

  /** Per-frame: smooth the intensity and drive calm ↔ battle. */
  frame(dt: number) {
    this.intensity = smoothIntensity(this.intensity, this.forced ?? this.target, dt);
    const mode = this.modeSwitch.update(this.intensity, dt);
    if (this.state === 'running' && this.loaded && this.music && this.music.mode !== 'victory' && this.music.mode !== 'idle') this.music.setMode(mode);
  }

  /* --------------------------------------------------------------- effects */

  private sample(key: SfxKey, category: string | null, o: SampleOpts & { duck?: Parameters<typeof duckFor>[0] } = {}) {
    if (this.state !== 'running' || !this.ctx || !this.g) return;
    if (category && !this.limiter.allow(category, performance.now())) return;
    const list = manifest.sfx[key];
    const buf = this.bufs.get(list[this.picker.pick(key, list.length)].file);
    if (!buf) return;
    const at = this.ctx.currentTime + 0.005;
    playBuffer(this.ctx, this.g.sfx, buf, at, {
      ...o,
      gain: (o.gain ?? 1) * (SFX_GAIN[key] ?? 1),
      rate: o.rate ?? 1 + (Math.random() - 0.5) * 0.06,
    });
    if (o.duck) duckMusic(this.g.duck, at, o.duck);
  }

  rifle(team: 'bulls' | 'bears', screenX: number, dist: number) {
    const s = spatial(screenX, dist);
    const now = performance.now();
    // Hot markets: now and then a machine-gun burst instead of a single shot.
    if (this.intensity > 0.55 && Math.random() < 0.08 && now - this.lastMg > 1500) {
      this.lastMg = now;
      this.sample(team === 'bulls' ? 'mg_bull' : 'mg_bear', 'mg', { ...s, gain: s.gain });
      return;
    }
    this.sample(team === 'bulls' ? 'rifle_bull' : 'rifle_bear', 'rifle', s);
  }

  cannon(screenX: number, dist: number, size: number) {
    const s = spatial(screenX, dist);
    this.sample('cannon', 'cannon', { ...s, gain: s.gain * (0.75 + 0.25 * Math.min(1, size / 2.5)) });
  }

  explosion(screenX: number, dist: number, size: number) {
    const s = spatial(screenX, dist);
    const tier = explosionTier(size);
    this.sample(tier, 'explosion', { ...s, duck: tier === 'expl_l' || tier === 'expl_xl' ? tier : undefined });
  }

  /** Incoming liquidation shell: the whistle is offset so its impact lines up with the landing. */
  whistle(screenX: number, dist: number, flightSeconds: number) {
    const s = spatial(screenX, dist * 0.6);
    const impactAt = manifest.sfx.whistle[0].impactAt;
    this.sample('whistle', 'whistle', { ...s, offset: whistleOffset(impactAt, flightSeconds), rate: 1 });
  }

  flare(screenX: number, dist: number) {
    this.sample('flare', 'flare', spatial(screenX, dist));
  }

  horn() {
    this.sample('horn', null, { rate: 1 });
  }

  fanfare(team: 'bulls' | 'bears') {
    if (this.state !== 'running' || !this.ctx || !this.music) return;
    this.sample(team === 'bulls' ? 'fanfare_bulls' : 'fanfare_bears', null, { rate: 1 });
    this.music.victory(this.ctx.currentTime, () => this.modeSwitch.mode);
  }

  /** Stop scheduling and release the audio device. */
  dispose() {
    this.music?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.g = null;
    this.music = null;
    this.emit();
  }

  private onVisibility() {
    if (!this.ctx) return;
    if (document.hidden) this.ctx.suspend().then(() => this.emit(), () => this.emit());
    else if (this.enabled) this.tryResume();
  }

  private emit() {
    this.onState?.(this.state);
  }
}

/* ----------------------------------------------------------- offline preview */

export interface PreviewResult {
  seconds: number;
  sampleRate: number;
  peak: number;
  rmsDb: number;
  /** RMS (dBFS) per 1-second window. */
  windowsDb: number[];
  /** Music-only RMS in the battle section vs. loudest effect windows (proves effects stand out). */
  bedDb: number;
  hitsDb: number;
  wavBase64: string;
}

/**
 * Render a scripted 36 s scene with the real assets and engine routing: calm score → crossfade to
 * battle → rifle fire, cannons, explosions, a liquidation strike → victory fanfare + M3.
 */
export async function renderPreview(seconds = 36, sampleRate = 48000): Promise<PreviewResult> {
  const ctx = new OfflineAudioContext(2, Math.floor(seconds * sampleRate), sampleRate);
  const g = buildGraph(ctx);
  const bufs = await loadBuffers(ctx);
  const pick = new VariantPicker(mulberry(5));
  const rnd = mulberry(9);
  const B = (key: SfxKey) => bufs.get(manifest.sfx[key][pick.pick(key, manifest.sfx[key].length)].file)!;
  const track = (key: TrackKey, at: number, fadeIn: number, fadeOutAt?: number) => {
    const meta = manifest.music[key];
    const src = ctx.createBufferSource();
    src.buffer = bufs.get(meta.file)!;
    if ('loopStart' in meta) {
      src.loop = true;
      src.loopStart = meta.loopStart;
      src.loopEnd = meta.loopStart + meta.loopLength;
    }
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, at);
    gn.gain.linearRampToValueAtTime(TRACK_TRIM[key], at + fadeIn);
    src.connect(gn).connect(g.music);
    src.start(at);
    if (fadeOutAt !== undefined) {
      gn.gain.setValueAtTime(TRACK_TRIM[key], fadeOutAt);
      gn.gain.linearRampToValueAtTime(0.0001, fadeOutAt + 3);
      src.stop(fadeOutAt + 3.1);
    }
  };
  track('calm', 0, 1.5, 9);
  track('battle', 9, 2.5, 25.2);
  track('victory', 27.6, 0.4);
  const fx = (key: SfxKey, at: number, pan: number, dist: number, extra: SampleOpts = {}) => {
    const s = spatial(pan, dist);
    playBuffer(ctx, g.sfx, B(key), at, { ...s, ...extra, gain: (extra.gain ?? s.gain) * (SFX_GAIN[key] ?? 1) });
  };
  fx('horn', 0.3, 0, 0, { gain: 1 });
  for (let t = 3; t < 24; t += 0.25 + rnd() * 0.5) fx(rnd() < 0.5 ? 'rifle_bull' : 'rifle_bear', t, rnd() * 1.6 - 0.8, 40 + rnd() * 160);
  fx('mg_bear', 14.2, 0.4, 70);
  for (const [t, size] of [[12, 1.8], [17, 2.4], [21.5, 1.2]] as const) {
    fx('cannon', t, rnd() - 0.5, 60);
    fx(explosionTier(size), t + 0.9, rnd() - 0.5, 60);
    if (size >= 1.6) duckMusic(g.duck, t + 0.9, explosionTier(size) as 'expl_l' | 'expl_xl');
  }
  fx('whistle', 18.4, 0.2, 40, { offset: whistleOffset(1.8, 1.6) });
  fx('expl_xl', 20, 0.2, 40, { gain: 1 });
  duckMusic(g.duck, 20, 'liquidation');
  fx('flare', 23, -0.5, 90);
  fx('fanfare_bulls', 25, 0, 0, { gain: 1 });
  duckMusic(g.duck, 25, 'fanfare');
  const buf = await ctx.startRendering();

  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let peak = 0;
  let sum = 0;
  const win = sampleRate;
  const windowsDb: number[] = [];
  let wsum = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    const e = (L[i] * L[i] + R[i] * R[i]) / 2;
    sum += e;
    wsum += e;
    if ((i + 1) % win === 0) {
      windowsDb.push(+(10 * Math.log10(wsum / win + 1e-12)).toFixed(1));
      wsum = 0;
    }
  }
  const short = (from: number, to: number) => {
    // loudest 50 ms window in [from, to)
    let best = -120;
    const w = Math.floor(0.05 * sampleRate);
    for (let s = Math.floor(from * sampleRate); s + w < to * sampleRate; s += w) {
      let e = 0;
      for (let i = s; i < s + w; i++) e += (L[i] * L[i] + R[i] * R[i]) / 2;
      best = Math.max(best, 10 * Math.log10(e / w + 1e-12));
    }
    return best;
  };
  const bedDb = windowsDb.slice(10, 12).reduce((a, b) => a + b, 0) / 2; // 10–12 s: battle score + light rifle fire
  return {
    seconds,
    sampleRate,
    peak: +peak.toFixed(4),
    rmsDb: +(10 * Math.log10(sum / L.length + 1e-12)).toFixed(1),
    windowsDb,
    bedDb: +bedDb.toFixed(1),
    hitsDb: +short(12, 22).toFixed(1),
    wavBase64: toWavBase64(L, R, sampleRate),
  };
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toWavBase64(L: Float32Array, R: Float32Array, sr: number) {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
