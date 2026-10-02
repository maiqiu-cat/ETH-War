import type { FeedSink, Level } from './types';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Order and trade sizes are drawn in "BTC-like" units, then scaled so ETH notional (USD) stays realistic. */
const SIZE_SCALE = 20;

/**
 * Offline market generator (?sim=1). Emits the same normalized events as the
 * live adapters, so the whole pipeline can be exercised without network.
 */
export class SimFeed {
  price: number;
  private rand: () => number;
  private timers: ReturnType<typeof setInterval>[] = [];
  private drift = 0;
  private walls: { price: number; size: number }[] = [];
  private readonly open24h: number;

  constructor(
    private readonly sink: FeedSink,
    seed = 7,
    start = 2_720,
    private readonly speed = 1,
  ) {
    this.rand = mulberry32(seed);
    this.price = start;
    this.open24h = start * 0.988;
  }

  private gauss() {
    const u = Math.max(1e-9, this.rand());
    const v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  start() {
    this.sink.status('sim', 'sim', 'open');
    this.sink.usdtUsd(1);
    this.respawnWalls();
    this.timers.push(setInterval(() => this.step(), 100 / this.speed));
    this.timers.push(setInterval(() => this.emitBook(), 250 / this.speed));
    this.timers.push(
      setInterval(() => this.sink.ticker({ ex: 'sim', quote: 'USD', open24h: this.open24h, quoteVolume24h: 1.2e9 }), 2000),
    );
    this.emitBook();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private respawnWalls() {
    this.walls = [];
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      this.walls.push({ price: this.price * (1 + dir * (0.0006 + this.rand() * 0.004)), size: (8 + this.rand() * 30) * SIZE_SCALE });
    }
  }

  private step() {
    // Regime switches: occasional pushes in one direction.
    if (this.rand() < 0.01) this.drift = (this.rand() - 0.5) * 0.00012;
    this.drift *= 0.995;
    const ret = this.drift + this.gauss() * 0.00006;
    const prev = this.price;
    this.price *= Math.exp(ret);
    const now = Date.now();

    const n = this.rand() < 0.8 ? 1 + Math.floor(this.rand() * 3) : 0;
    for (let i = 0; i < n; i++) {
      const side = this.rand() < 0.5 + Math.sign(this.price - prev) * 0.2 ? 'buy' : 'sell';
      let size = Math.exp(this.gauss() * 1.4 - 3.2) * SIZE_SCALE;
      if (this.rand() < 0.004) size = (2 + this.rand() * 20) * SIZE_SCALE; // whale
      this.sink.trade({ ex: 'sim', market: 'spot', quote: 'USD', price: this.price, size, side, ts: now });
    }
    if (this.rand() < 0.006 + Math.abs(ret) * 40) {
      const liquidated = this.price > prev ? 'short' : 'long';
      this.sink.liquidation({ ex: 'sim', liquidated, price: this.price, usd: Math.exp(this.gauss() * 1.3 + 10.5), ts: now });
    }
    if (this.rand() < 0.01) {
      const premiumUsd = Math.exp(this.gauss() + 8);
      this.sink.trade({
        ex: 'sim',
        market: 'option',
        quote: 'USD',
        price: this.price,
        size: 1,
        side: this.rand() < 0.5 ? 'buy' : 'sell',
        ts: now,
        premiumUsd,
        instrument: `ETH-SIM-${Math.round(this.price / 50) * 50}-${this.rand() < 0.5 ? 'C' : 'P'}`,
      });
    }
  }

  private emitBook() {
    const p = this.price;
    // Walls that got crossed are "eaten" and respawn further away.
    for (const w of this.walls) {
      const crossed = Math.abs(w.price / p - 1) < 0.00005;
      if (crossed) {
        const dir = this.rand() < 0.5 ? 1 : -1;
        w.price = p * (1 + dir * (0.001 + this.rand() * 0.004));
        w.size = (8 + this.rand() * 30) * SIZE_SCALE;
      }
    }
    const bids: Level[] = [];
    const asks: Level[] = [];
    for (let i = 1; i <= 900; i++) {
      const d = i * 0.0000222; // ~$0.06 steps out to 2%
      const base = (0.05 + Math.pow(i, 0.6) * 0.035) * SIZE_SCALE;
      const bp = Math.round(p * (1 - d) * 100) / 100;
      const ap = Math.round(p * (1 + d) * 100) / 100;
      bids.push([bp, base * (0.4 + this.rand() * 1.2)]);
      asks.push([ap, base * (0.4 + this.rand() * 1.2)]);
    }
    for (const w of this.walls) {
      if (w.price < p) bids.push([Math.round(w.price * 100) / 100, w.size]);
      else asks.push([Math.round(w.price * 100) / 100, w.size]);
    }
    this.sink.book({ ex: 'sim', quote: 'USD', snapshot: true, bids, asks });
  }
}
