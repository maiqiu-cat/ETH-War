import type { Round } from './battle';

export const FIELD_WIDTH = 220; // along x (price axis)
export const FIELD_DEPTH = 120; // along z
/** Extra price room behind each base, as a fraction of the round range. */
export const BASE_MARGIN = 0.2;

/** Maps prices to x on the battlefield. Low prices (bids, bulls) on -x, high prices (asks, bears) on +x. */
export class FieldMap {
  readonly minPrice: number;
  readonly maxPrice: number;

  constructor(
    readonly round: Pick<Round, 'bearsWinAt' | 'bullsWinAt'>,
    readonly width = FIELD_WIDTH,
    readonly depth = FIELD_DEPTH,
  ) {
    const range = round.bullsWinAt - round.bearsWinAt;
    this.minPrice = round.bearsWinAt - range * BASE_MARGIN;
    this.maxPrice = round.bullsWinAt + range * BASE_MARGIN;
  }

  x(price: number) {
    return ((price - this.minPrice) / (this.maxPrice - this.minPrice) - 0.5) * this.width;
  }

  price(x: number) {
    return this.minPrice + (x / this.width + 0.5) * (this.maxPrice - this.minPrice);
  }

  /** World units per USD of price. */
  get scale() {
    return this.width / (this.maxPrice - this.minPrice);
  }

  /** The bull base sits at the low end; bears win when price reaches it. */
  get bullBaseX() {
    return this.x(this.round.bearsWinAt);
  }

  get bearBaseX() {
    return this.x(this.round.bullsWinAt);
  }

  /** Price tick step giving roughly `target` labelled ticks across the field. */
  tickStep(target = 12) {
    const raw = (this.maxPrice - this.minPrice) / target;
    const pow = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow;
    return 10 * pow;
  }
}

/**
 * Wobble of the front line along z. Must match `frontWave` in the terrain shader
 * (render/terrain.ts) so troops stand exactly on the visible line.
 */
export function frontWave(z: number, t: number, amp: number) {
  return (
    amp *
    (0.55 * Math.sin(z * 0.07 + t * 0.35) + 0.3 * Math.sin(z * 0.17 - t * 0.6 + 1.3) + 0.15 * Math.sin(z * 0.31 + t * 0.9))
  );
}

export const FRONT_WAVE_GLSL = /* glsl */ `
float frontWave(float z, float t, float amp) {
  return amp * (0.55 * sin(z * 0.07 + t * 0.35) + 0.3 * sin(z * 0.17 - t * 0.6 + 1.3) + 0.15 * sin(z * 0.31 + t * 0.9));
}`;
