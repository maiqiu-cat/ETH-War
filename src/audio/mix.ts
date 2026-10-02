/** Pure helpers for the audio system (no Web Audio here, so they can be unit-tested). */

/**
 * Stereo pan, gain and a distance lowpass for a sound at normalized screen x (-1..1) and camera
 * distance. Far sounds get quieter *and* duller, which reads as distance without vanishing.
 */
export function spatial(screenX: number, distance: number): { pan: number; gain: number; cutoff: number } {
  const pan = Math.max(-1, Math.min(1, screenX)) * 0.85;
  const d = Math.max(0, distance);
  const gain = Math.max(0.12, Math.min(1, 1 / (1 + d / 160)));
  const far = Math.min(1, d / 260);
  const cutoff = 16000 * (1 - far) + 2200 * far;
  return { pan, gain, cutoff };
}

/**
 * Caps how many sounds of one category may start within a sliding window, so a burst of
 * events (26 rifle shots per second per side) never turns into noise or overloads the graph.
 */
export class VoiceLimiter {
  private recent = new Map<string, number[]>();
  constructor(private readonly limits: Record<string, { max: number; windowMs: number }>) {}

  allow(category: string, nowMs: number): boolean {
    const lim = this.limits[category];
    if (!lim) return true;
    const arr = this.recent.get(category) ?? [];
    while (arr.length && nowMs - arr[0] >= lim.windowMs) arr.shift();
    if (arr.length >= lim.max) {
      this.recent.set(category, arr);
      return false;
    }
    arr.push(nowMs);
    this.recent.set(category, arr);
    return true;
  }
}

/** Random variant index that never repeats the previous pick for the same key. */
export class VariantPicker {
  private last = new Map<string, number>();
  constructor(private readonly rand: () => number = Math.random) {}

  pick(key: string, count: number): number {
    if (count <= 1) return 0;
    const prev = this.last.get(key);
    let i = Math.floor(this.rand() * count);
    if (i === prev) i = (i + 1 + Math.floor(this.rand() * (count - 1))) % count;
    this.last.set(key, i);
    return i;
  }
}

export interface IntensityInput {
  /** Taker flow, USD per second (both sides). */
  flowPerSec: number;
  /** Round progress 0..1 (0.5 = centre). */
  progress: number;
  /** True while a side is storming a base. */
  storming: boolean;
  /** Recent large events per minute (big trades + liquidations). */
  eventsPerMin: number;
}

/** Target battle intensity 0..1 from market activity. */
export function musicIntensity(i: IntensityInput): number {
  const flow = Math.min(1, Math.max(0, (Math.log10(1 + i.flowPerSec) - 3) / 3)); // $1K/s → 0, $1M/s → 1
  const edge = Math.min(1, Math.abs(i.progress - 0.5) * 2); // distance from the centre
  const events = Math.min(1, i.eventsPerMin / 12);
  let v = 0.15 + flow * 0.35 + edge * 0.25 + events * 0.25;
  if (i.storming) v = Math.max(v, 0.85);
  return Math.max(0, Math.min(1, v));
}

/** Smooth towards a target: fast attack, slow release (seconds). */
export function smoothIntensity(current: number, target: number, dt: number, attack = 3, release = 9) {
  const tau = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export type MusicMode = 'calm' | 'battle';

/**
 * Calm (M2) ↔ battle (M1) with hysteresis: intensity must stay ≥ `up` for `holdUp` seconds to go to
 * battle, and ≤ `down` for `holdDown` seconds to fall back to calm — no flip-flopping.
 */
export class MusicModeSwitch {
  mode: MusicMode = 'calm';
  private timer = 0;
  constructor(
    readonly up = 0.6,
    readonly down = 0.4,
    readonly holdUp = 2,
    readonly holdDown = 12,
  ) {}

  update(intensity: number, dt: number): MusicMode {
    if (this.mode === 'calm') {
      this.timer = intensity >= this.up ? this.timer + dt : 0;
      if (this.timer >= this.holdUp) {
        this.mode = 'battle';
        this.timer = 0;
      }
    } else {
      this.timer = intensity <= this.down ? this.timer + dt : 0;
      if (this.timer >= this.holdDown) {
        this.mode = 'calm';
        this.timer = 0;
      }
    }
    return this.mode;
  }
}

export type ExplosionTier = 'expl_s' | 'expl_m' | 'expl_l' | 'expl_xl';

/** Map the battlefield explosion size (0.5 … 3.6) to a sample tier. */
export function explosionTier(size: number): ExplosionTier {
  if (size < 0.9) return 'expl_s';
  if (size < 1.6) return 'expl_m';
  if (size < 2.6) return 'expl_l';
  return 'expl_xl';
}

/** Start offset into the whistle sample so its impact lines up with the shell's landing. */
export function whistleOffset(impactAt: number, flightSeconds: number) {
  return Math.max(0, Math.min(impactAt - 0.2, impactAt - flightSeconds));
}

/** Music ducking under big moments: depth (gain multiplier) and how long to hold before recovering. */
export function duckFor(kind: 'expl_l' | 'expl_xl' | 'liquidation' | 'fanfare'): { depth: number; hold: number; release: number } {
  switch (kind) {
    case 'fanfare':
      return { depth: 0.15, hold: 2.4, release: 0.8 };
    case 'expl_xl':
    case 'liquidation':
      return { depth: 0.35, hold: 0.4, release: 1.8 };
    default:
      return { depth: 0.55, hold: 0.25, release: 1.4 };
  }
}
