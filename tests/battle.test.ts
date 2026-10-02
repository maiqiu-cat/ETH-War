import { describe, expect, it } from 'vitest';
import { layoutArmies, frontColumnOrder, niceUsd } from '../src/game/armies';
import { BattleEngine, narrate, type NarrationInput } from '../src/game/battle';
import { FieldMap, frontWave } from '../src/game/field';

describe('BattleEngine', () => {
  it('starts a round around the price and detects a bull win', () => {
    const b = new BattleEngine({ halfRange: 0.0025, intermissionMs: 1000 });
    const [start] = b.update(80_000, 0);
    expect(start.type).toBe('start');
    expect(b.round!.bullsWinAt).toBeCloseTo(80_200);
    expect(b.round!.bearsWinAt).toBeCloseTo(79_800);
    expect(b.progress(80_000)).toBeCloseTo(0.5);
    expect(b.update(80_150, 10)).toEqual([]);
    const [win] = b.update(80_201, 20);
    expect(win).toMatchObject({ type: 'win', winner: 'bulls' });
    expect(b.update(79_000, 500)).toEqual([]); // intermission: no double win
    const [next] = b.update(80_210, 1100);
    expect(next.type).toBe('start');
    expect(b.round!.startPrice).toBe(80_210);
    expect(b.score()).toEqual({ bulls: 1, bears: 0 });
  });

  it('detects a bear win', () => {
    const b = new BattleEngine();
    b.update(80_000, 0);
    expect(b.update(79_799, 1)[0]).toMatchObject({ winner: 'bears' });
  });
});

describe('narrate', () => {
  const base: NarrationInput = {
    progress: 0.5,
    progressBefore: 0.5,
    buyFlow: 1,
    sellFlow: 1,
    bidNear: 100,
    bidNearBefore: 100,
    askNear: 100,
    askNearBefore: 100,
    secondsSinceStart: 60,
  };
  it('reports the right situation', () => {
    expect(narrate({ ...base, secondsSinceStart: 2 })).toBe('deploying');
    expect(narrate({ ...base, progress: 0.9 })).toBe('bullsStorm');
    expect(narrate({ ...base, progress: 0.6, askNear: 50 })).toBe('askAbsorbed');
    expect(narrate({ ...base, progress: 0.6, buyFlow: 10 })).toBe('bullsCharging');
    expect(narrate({ ...base, progress: 0.6 })).toBe('bullsAdvancing');
    expect(narrate({ ...base, askNear: 150 })).toBe('askReinforced');
    expect(narrate({ ...base, progress: 0.4, sellFlow: 10 })).toBe('bearsCharging');
    expect(narrate(base)).toBe('skirmishes');
  });
});

describe('FieldMap', () => {
  const field = new FieldMap({ bearsWinAt: 79_800, bullsWinAt: 80_200 });
  it('maps prices symmetrically and inverts', () => {
    expect(field.x(80_000)).toBeCloseTo(0);
    expect(field.x(field.maxPrice)).toBeCloseTo(field.width / 2);
    expect(field.price(field.x(80_123))).toBeCloseTo(80_123);
    expect(field.bullBaseX).toBeLessThan(0);
    expect(field.bearBaseX).toBeGreaterThan(0);
  });
  it('picks round tick steps', () => {
    expect([10, 20, 25, 50, 100]).toContain(field.tickStep(12));
  });
  it('front wave is bounded by amplitude', () => {
    for (let z = -60; z <= 60; z += 3) expect(Math.abs(frontWave(z, 12.3, 2))).toBeLessThanOrEqual(2.0001);
  });
});

describe('layoutArmies', () => {
  const field = new FieldMap({ bearsWinAt: 79_800, bullsWinAt: 80_200 });
  const bucket = 5;
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (let p = 79_500; p < 80_000; p += bucket) bids.set(Math.floor(p / bucket), 100_000);
  for (let p = 80_000; p < 80_500; p += bucket) asks.set(Math.floor(p / bucket), 100_000);
  asks.set(Math.floor(80_100 / bucket), 3_000_000); // wall -> tanks
  const opts = {
    usdPerSoldier: 20_000,
    usdPerTank: 1_000_000,
    frontZoneUsd: 15,
    frontCols: 64,
    frontRows: 4,
    maxFieldSoldiersPerSide: 2000,
    maxTanksPerSide: 10,
    maxReserveSoldiers: 50,
    maxReserveTanks: 4,
  };
  const out = layoutArmies({ bucket, bids, asks }, 80_000, field, opts);

  it('produces unique keys', () => {
    const keys = new Set(out.units.map((u) => u.key));
    expect(keys.size).toBe(out.units.length);
  });

  it('splits liquidity into front, field and reserves', () => {
    // bids: buckets 79_995, 79_990, 79_985 are within $15 of price
    expect(out.bulls.frontUsd).toBe(300_000);
    expect(out.bulls.reserveUsd).toBeGreaterThan(0);
    const front = out.units.filter((u) => u.team === 'bulls' && u.frontRow !== undefined);
    expect(front).toHaveLength(15);
    expect(out.units.filter((u) => u.team === 'bears' && u.kind === 'tank').length).toBeGreaterThanOrEqual(3);
  });

  it('places field units on their own side of the front', () => {
    for (const u of out.units) {
      if (u.frontRow !== undefined || u.key.startsWith('R')) continue;
      if (u.team === 'bulls') expect(u.x).toBeLessThan(1);
      else expect(u.x).toBeGreaterThan(-1);
    }
  });

  it('is deterministic', () => {
    const again = layoutArmies({ bucket, bids, asks }, 80_000, field, opts);
    expect(again.units).toEqual(out.units);
  });

  it('column order is a permutation', () => {
    const order = frontColumnOrder(100);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it('nice USD rounding', () => {
    expect(niceUsd(17_000)).toBe(20_000);
    expect(niceUsd(23_000)).toBe(25_000);
    expect(niceUsd(40_000)).toBe(50_000);
  });
});
