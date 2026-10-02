import type { BookUpdate } from './types';

/** L2 book for one venue: price -> size (ETH), in the venue's quote currency. */
export class OrderBook {
  readonly bids = new Map<number, number>();
  readonly asks = new Map<number, number>();
  updatedAt = 0;

  apply(u: BookUpdate, now = Date.now()) {
    if (u.snapshot) {
      this.bids.clear();
      this.asks.clear();
    }
    for (const [p, s] of u.bids) s > 0 ? this.bids.set(p, s) : this.bids.delete(p);
    for (const [p, s] of u.asks) s > 0 ? this.asks.set(p, s) : this.asks.delete(p);
    if (u.depth) this.truncate(u.depth);
    this.uncross(u.bids.length > 0, u.asks.length > 0);
    this.updatedAt = now;
  }

  bestBid() {
    let b = -Infinity;
    for (const p of this.bids.keys()) if (p > b) b = p;
    return b;
  }

  bestAsk() {
    let a = Infinity;
    for (const p of this.asks.keys()) if (p < a) a = p;
    return a;
  }

  mid() {
    const b = this.bestBid();
    const a = this.bestAsk();
    return Number.isFinite(b) && Number.isFinite(a) ? (a + b) / 2 : NaN;
  }

  /** Keep the best `depth` levels per side (venues stop sending updates beyond it). */
  truncate(depth: number) {
    if (this.bids.size > depth) {
      const keys = [...this.bids.keys()].sort((x, y) => y - x);
      for (let i = depth; i < keys.length; i++) this.bids.delete(keys[i]);
    }
    if (this.asks.size > depth) {
      const keys = [...this.asks.keys()].sort((x, y) => x - y);
      for (let i = depth; i < keys.length; i++) this.asks.delete(keys[i]);
    }
  }

  /** Drop levels further than `pct` from mid, to bound memory on full-depth feeds. */
  prune(mid: number, pct: number) {
    const lo = mid * (1 - pct);
    const hi = mid * (1 + pct);
    for (const p of this.bids.keys()) if (p < lo) this.bids.delete(p);
    for (const p of this.asks.keys()) if (p > hi) this.asks.delete(p);
  }

  /**
   * A crossed book means stale levels on the side that did not just update.
   * Remove them; if both sides updated, trust neither stale extreme and trim asks.
   */
  private uncross(bidsTouched: boolean, asksTouched: boolean) {
    const b = this.bestBid();
    const a = this.bestAsk();
    if (!(b >= a)) return;
    if (bidsTouched && !asksTouched) {
      for (const p of [...this.asks.keys()]) if (p <= b) this.asks.delete(p);
    } else if (asksTouched && !bidsTouched) {
      for (const p of [...this.bids.keys()]) if (p >= a) this.bids.delete(p);
    } else {
      for (const p of [...this.asks.keys()]) if (p <= b) this.asks.delete(p);
    }
  }
}
