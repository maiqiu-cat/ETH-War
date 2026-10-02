import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../src/audio/assets/manifest.json';
import { readSoundPref } from '../src/audio/engine';
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
} from '../src/audio/mix';

describe('spatial', () => {
  it('pans by screen position; far sounds are quieter and duller but never vanish', () => {
    expect(spatial(-2, 0).pan).toBeCloseTo(-0.85);
    const near = spatial(0, 20);
    const far = spatial(0, 300);
    expect(near.gain).toBeGreaterThan(far.gain);
    expect(near.cutoff).toBeGreaterThan(far.cutoff);
    expect(spatial(0, 1e6).gain).toBeGreaterThanOrEqual(0.12);
    expect(spatial(0, 150).gain).toBeGreaterThan(0.45); // overview camera distance stays clearly audible
  });
});

describe('VoiceLimiter', () => {
  it('caps voices per window and frees them as the window slides', () => {
    const l = new VoiceLimiter({ rifle: { max: 3, windowMs: 1000 } });
    expect([0, 10, 20, 30].map((t) => l.allow('rifle', t))).toEqual([true, true, true, false]);
    expect(l.allow('rifle', 1005)).toBe(true);
    expect(l.allow('unknown', 0)).toBe(true);
  });
});

describe('VariantPicker', () => {
  it('never repeats the previous variant and covers all of them', () => {
    const p = new VariantPicker();
    const seen = new Set<number>();
    let prev = -1;
    for (let i = 0; i < 200; i++) {
      const v = p.pick('rifle', 6);
      expect(v).not.toBe(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
      prev = v;
    }
    expect(seen.size).toBe(6);
    expect(p.pick('single', 1)).toBe(0);
  });
});

describe('intensity and calm ↔ battle switching', () => {
  const calm = { flowPerSec: 500, progress: 0.5, storming: false, eventsPerMin: 0 };
  it('maps market activity to 0..1', () => {
    expect(musicIntensity(calm)).toBeLessThan(0.25);
    expect(musicIntensity({ ...calm, storming: true })).toBeGreaterThanOrEqual(0.85);
    expect(musicIntensity({ ...calm, flowPerSec: 2e6 })).toBeGreaterThan(musicIntensity({ ...calm, flowPerSec: 5e4 }));
    expect(smoothIntensity(0, 1, 1)).toBeGreaterThan(1 - smoothIntensity(1, 0, 1));
  });
  it('needs sustained intensity to go to battle and a long calm to come back', () => {
    const s = new MusicModeSwitch(0.6, 0.4, 2, 12);
    expect(s.update(0.9, 1)).toBe('calm'); // only 1 s above
    expect(s.update(0.5, 1)).toBe('calm'); // dipped: timer resets
    expect(s.update(0.9, 1)).toBe('calm');
    expect(s.update(0.9, 1.1)).toBe('battle');
    for (let i = 0; i < 11; i++) expect(s.update(0.3, 1)).toBe('battle');
    expect(s.update(0.5, 1)).toBe('battle'); // between thresholds resets the calm timer
    for (let i = 0; i < 11; i++) s.update(0.3, 1);
    expect(s.update(0.3, 1.1)).toBe('calm');
  });
});

describe('effects mapping', () => {
  it('maps explosion size to tiers', () => {
    expect([0.5, 1.0, 2.0, 3.6].map(explosionTier)).toEqual(['expl_s', 'expl_m', 'expl_l', 'expl_xl']);
  });
  it('aligns the whistle impact with the shell landing', () => {
    expect(whistleOffset(1.8, 1.0)).toBeCloseTo(0.8);
    expect(whistleOffset(1.8, 3.0)).toBe(0);
    expect(whistleOffset(1.8, 0.1)).toBeCloseTo(1.6); // always leaves a short audible whistle
  });
  it('ducks the score more for bigger moments', () => {
    expect(duckFor('fanfare').depth).toBeLessThan(duckFor('liquidation').depth);
    expect(duckFor('liquidation').depth).toBeLessThan(duckFor('expl_l').depth);
  });
});

describe('asset manifest', () => {
  const dir = join(__dirname, '../src/audio/assets');
  it('every referenced file exists and is non-empty', () => {
    const files = [...Object.values(manifest.music).map((m) => m.file), ...Object.values(manifest.sfx).flatMap((l) => l.map((s) => s.file))];
    for (const f of files) {
      expect(existsSync(join(dir, f)), f).toBe(true);
      expect(statSync(join(dir, f)).size).toBeGreaterThan(1000);
    }
  });
  it('loops fit inside their files with the 1 s periodic extension', () => {
    for (const key of ['calm', 'battle'] as const) {
      const m = manifest.music[key];
      expect(m.loopStart).toBeGreaterThanOrEqual(0.5);
      expect(m.loopStart + m.loopLength).toBeLessThanOrEqual(m.seconds - 0.4);
      expect(m.loopLength).toBeGreaterThan(30);
    }
  });
  it('has enough variants for the frequent sounds', () => {
    expect(manifest.sfx.rifle_bull.length).toBeGreaterThanOrEqual(4);
    expect(manifest.sfx.rifle_bear.length).toBeGreaterThanOrEqual(4);
    for (const k of ['expl_s', 'expl_m', 'expl_l', 'expl_xl', 'cannon'] as const) expect(manifest.sfx[k].length).toBeGreaterThanOrEqual(2);
  });
});

describe('sound preference', () => {
  it('reads the URL override and defaults to on', () => {
    expect(readSoundPref('?sound=0')).toBe(false);
    expect(readSoundPref('?sound=off')).toBe(false);
    expect(readSoundPref('?sound=1')).toBe(true);
    expect(readSoundPref('')).toBe(true);
  });
});
