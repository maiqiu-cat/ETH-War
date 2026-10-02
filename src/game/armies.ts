import type { DepthBuckets } from '../data/market';
import type { Team } from './battle';
import type { FieldMap } from './field';

export type UnitKind = 'soldier' | 'tank';

export interface UnitTarget {
  key: string;
  team: Team;
  kind: UnitKind;
  /** Static x for field units; ignored for front-line units (computed from the live front). */
  x: number;
  z: number;
  /** Front-line row (0 = touching the line); undefined for field units. */
  frontRow?: number;
}

export interface SideSummary {
  frontUsd: number;
  fieldUsd: number;
  reserveUsd: number;
  soldiers: number;
  tanks: number;
  reserveSoldiers: number;
  reserveTanks: number;
}

export interface LayoutResult {
  units: UnitTarget[];
  bulls: SideSummary;
  bears: SideSummary;
}

export interface LayoutOptions {
  usdPerSoldier: number;
  usdPerTank: number;
  /** Liquidity within this USD distance of price forms the front line. */
  frontZoneUsd: number;
  frontCols: number;
  frontRows: number;
  maxFieldSoldiersPerSide: number;
  maxTanksPerSide: number;
  maxReserveSoldiers: number;
  maxReserveTanks: number;
}

export const DEFAULT_LAYOUT: Omit<LayoutOptions, 'usdPerSoldier' | 'usdPerTank' | 'frontZoneUsd'> = {
  frontCols: 128,
  frontRows: 6,
  maxFieldSoldiersPerSide: 1200,
  maxTanksPerSide: 40,
  maxReserveSoldiers: 80,
  maxReserveTanks: 8,
};

/** Deterministic hash -> [0,1). */
export function hash01(a: number, b: number, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function bitReverse(v: number, bits: number) {
  let r = 0;
  for (let i = 0; i < bits; i++) r = (r << 1) | ((v >> i) & 1);
  return r;
}

/** Column fill order that keeps partially-filled rows evenly spread along the front. */
export function frontColumnOrder(cols: number) {
  const bits = Math.ceil(Math.log2(cols));
  const out: number[] = [];
  for (let i = 0; i < 1 << bits; i++) {
    const c = bitReverse(i, bits);
    if (c < cols) out.push(c);
  }
  return out;
}

/** Round to 1/2/2.5/5 x 10^n so the HUD can say "1 soldier = $25K". */
export function niceUsd(v: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

const emptySide = (): SideSummary => ({
  frontUsd: 0,
  fieldUsd: 0,
  reserveUsd: 0,
  soldiers: 0,
  tanks: 0,
  reserveSoldiers: 0,
  reserveTanks: 0,
});

/**
 * Turns aggregated depth into unit placements:
 *  - liquidity right at the price → dense rows hugging the front line,
 *  - liquidity inside the field → squads (and tanks for walls) at their price,
 *  - liquidity beyond the win line → reserves parked at the base.
 */
export function layoutArmies(depth: DepthBuckets, price: number, field: FieldMap, o: LayoutOptions): LayoutResult {
  const units: UnitTarget[] = [];
  const out: LayoutResult = { units, bulls: emptySide(), bears: emptySide() };
  const zHalf = field.depth / 2;
  const colOrder = frontColumnOrder(o.frontCols);
  const colSpacing = (field.depth * 0.94) / o.frontCols;

  for (const team of ['bulls', 'bears'] as const) {
    const buckets = team === 'bulls' ? depth.bids : depth.asks;
    const sum = out[team];
    const dir = team === 'bulls' ? 1 : -1; // direction of attack along x
    const winLine = team === 'bulls' ? field.round.bearsWinAt : field.round.bullsWinAt;
    const tid = team === 'bulls' ? 1 : 2;

    // Nearest-first so carry and caps favour liquidity closest to the fight.
    const keys = [...buckets.keys()].sort((a, b) => (team === 'bulls' ? b - a : a - b));
    let carry = 0;
    let fieldSoldiers = 0;
    let tanks = 0;

    for (const k of keys) {
      const usd = buckets.get(k)!;
      const mid = (k + 0.5) * depth.bucket;
      if (team === 'bulls' ? mid > price : mid < price) continue; // crossed/stale level
      const dist = Math.abs(price - mid);
      const beyondWin = team === 'bulls' ? mid < winLine : mid > winLine;

      if (beyondWin) {
        sum.reserveUsd += usd;
        continue;
      }
      if (dist <= o.frontZoneUsd) {
        sum.frontUsd += usd;
        continue;
      }
      sum.fieldUsd += usd;

      let rest = usd;
      const x = field.x(mid);
      if (usd >= o.usdPerTank && tanks < o.maxTanksPerSide) {
        const n = Math.min(3, Math.floor(usd / o.usdPerTank), o.maxTanksPerSide - tanks);
        for (let j = 0; j < n; j++) {
          const z = (hash01(k, j, tid * 7 + 1) - 0.5) * 2 * zHalf * 0.85;
          units.push({ key: `T${tid}:${k}:${j}`, team, kind: 'tank', x: x - dir * j * 0.6, z });
        }
        tanks += n;
        rest -= n * o.usdPerTank * 0.6;
      }

      const exact = rest / o.usdPerSoldier + carry;
      let n = Math.floor(exact);
      carry = exact - n;
      n = Math.min(n, o.maxFieldSoldiersPerSide - fieldSoldiers);
      if (n <= 0) continue;
      fieldSoldiers += n;
      // Squad formation, wide along z, a few ranks deep along x.
      const cols = Math.max(2, Math.ceil(Math.sqrt(n * 2.5)));
      const cz = (hash01(k, 0, tid) - 0.5) * 2 * (zHalf * 0.85 - cols * 0.35);
      for (let j = 0; j < n; j++) {
        const c = j % cols;
        const r = Math.floor(j / cols);
        units.push({
          key: `S${tid}:${k}:${j}`,
          team,
          kind: 'soldier',
          x: x - dir * r * 0.7 + (hash01(k, j, 99) - 0.5) * 0.25,
          z: cz + (c - (cols - 1) / 2) * 0.7 + (hash01(k, j, 98) - 0.5) * 0.25,
        });
      }
    }

    // Front line: fixed slot grid that follows the live (wavy) front.
    const frontN = Math.min(o.frontCols * o.frontRows, Math.round(sum.frontUsd / o.usdPerSoldier));
    for (let i = 0; i < frontN; i++) {
      const row = Math.floor(i / o.frontCols);
      const col = colOrder[i % o.frontCols];
      units.push({
        key: `F${tid}:${i}`,
        team,
        kind: 'soldier',
        x: 0,
        z: -zHalf * 0.94 + (col + 0.5) * colSpacing,
        frontRow: row,
      });
    }

    // Reserves parked in front of the base.
    const rs = Math.min(o.maxReserveSoldiers, Math.round(sum.reserveUsd / o.usdPerSoldier));
    const rt = Math.min(o.maxReserveTanks, Math.floor(sum.reserveUsd / o.usdPerTank));
    const baseX = team === 'bulls' ? field.bullBaseX : field.bearBaseX;
    for (let i = 0; i < rs; i++) {
      const c = i % 10;
      const r = Math.floor(i / 10);
      units.push({
        key: `R${tid}:${i}`,
        team,
        kind: 'soldier',
        x: baseX - dir * (4 + r * 0.8),
        z: -20 + (c - 4.5) * 0.8,
      });
    }
    for (let i = 0; i < rt; i++) {
      units.push({ key: `RT${tid}:${i}`, team, kind: 'tank', x: baseX - dir * (5 + (i % 2) * 3.2), z: 14 + Math.floor(i / 2) * 3.4 });
    }

    sum.soldiers = fieldSoldiers + frontN;
    sum.tanks = tanks;
    sum.reserveSoldiers = Math.round(sum.reserveUsd / o.usdPerSoldier);
    sum.reserveTanks = Math.floor(sum.reserveUsd / o.usdPerTank);
  }
  return out;
}
