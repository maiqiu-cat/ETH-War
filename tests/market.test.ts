import { describe, expect, it } from 'vitest';
import { MarketHub } from '../src/data/market';
import { OrderBook } from '../src/data/orderbook';
import type { Trade } from '../src/data/types';

describe('OrderBook', () => {
  it('applies snapshots, deltas and deletions', () => {
    const b = new OrderBook();
    b.apply({ ex: 'okx', quote: 'USD', snapshot: true, bids: [[100, 1], [99, 2]], asks: [[101, 1], [102, 3]] });
    b.apply({ ex: 'okx', quote: 'USD', snapshot: false, bids: [[100, 0], [99.5, 4]], asks: [] });
    expect(b.bestBid()).toBe(99.5);
    expect(b.bestAsk()).toBe(101);
    expect(b.bids.has(100)).toBe(false);
  });

  it('truncates to venue depth', () => {
    const b = new OrderBook();
    const bids = Array.from({ length: 10 }, (_, i) => [100 - i, 1] as [number, number]);
    b.apply({ ex: 'kraken', quote: 'USD', snapshot: true, bids, asks: [[101, 1]], depth: 3 });
    expect([...b.bids.keys()].sort((a, c) => c - a)).toEqual([100, 99, 98]);
  });

  it('removes stale crossing levels from the side that did not update', () => {
    const b = new OrderBook();
    b.apply({ ex: 'okx', quote: 'USD', snapshot: true, bids: [[100, 1]], asks: [[101, 1], [102, 1]] });
    // bids moved up through stale asks
    b.apply({ ex: 'okx', quote: 'USD', snapshot: false, bids: [[101.5, 1]], asks: [] });
    expect(b.bestAsk()).toBe(102);
    expect(b.bestBid()).toBe(101.5);
  });
});

function hubAt(t: { now: number }) {
  return new MarketHub({ bigTradeUsd: 50_000 }, () => t.now);
}

const trade = (p: Partial<Trade>): Trade => ({
  ex: 'coinbase',
  market: 'spot',
  quote: 'USD',
  price: 80_000,
  size: 0.1,
  side: 'buy',
  ts: 0,
  ...p,
});

describe('MarketHub index', () => {
  it('volume-weights venues after converting USDT to USD', () => {
    const clock = { now: 1_000_000 };
    const hub = hubAt(clock);
    hub.usdtUsd(0.999);
    hub.ticker({ ex: 'coinbase', quote: 'USD', quoteVolume24h: 300e6 });
    hub.ticker({ ex: 'okx', quote: 'USDT', quoteVolume24h: 100e6 });
    hub.trade(trade({ ex: 'coinbase', price: 80_000 }));
    hub.trade(trade({ ex: 'okx', quote: 'USDT', price: 80_080 }));
    const idx = hub.computeIndex()!;
    const okxUsd = 80_080 * 0.999; // 79_999.92
    const okxW = 100e6 * 0.999;
    expect(idx.price).toBeCloseTo((80_000 * 300e6 + okxUsd * okxW) / (300e6 + okxW), 6);
  });

  it('excludes outliers and stale venues', () => {
    const clock = { now: 1_000_000 };
    const hub = hubAt(clock);
    hub.trade(trade({ ex: 'coinbase', price: 80_000 }));
    hub.trade(trade({ ex: 'kraken', price: 80_010 }));
    hub.trade(trade({ ex: 'bitstamp', price: 81_500 })); // +1.9% => outlier
    let idx = hub.computeIndex()!;
    expect(idx.venues.find((v) => v.ex === 'bitstamp')!.included).toBe(false);
    expect(idx.price).toBeGreaterThan(79_999);
    expect(idx.price).toBeLessThan(80_011);
    clock.now += 200_000;
    hub.trade(trade({ ex: 'kraken', price: 80_020 }));
    idx = hub.computeIndex()!;
    expect(idx.venues.map((v) => v.ex)).toEqual(['kraken']);
    expect(idx.price).toBe(80_020);
  });
});

describe('MarketHub events', () => {
  it('merges a sweep of prints into one large trade', () => {
    const clock = { now: 1_000_000 };
    const hub = hubAt(clock);
    const seen: string[] = [];
    hub.onEvent((e) => seen.push(`${e.label}:${Math.round(e.usd)}`));
    for (let i = 0; i < 5; i++) hub.trade(trade({ ex: 'kraken', size: 0.2, price: 80_000 + i, ts: 10 + i * 10 }));
    expect(seen).toEqual([]); // still pending
    clock.now += 500;
    hub.tick();
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatch(/^Large buy trade:800/);
  });

  it('does not merge opposite sides or far-apart prints', () => {
    const clock = { now: 1_000_000 };
    const hub = hubAt(clock);
    const seen: number[] = [];
    hub.onEvent((e) => seen.push(e.usd));
    hub.trade(trade({ ex: 'okx', size: 0.5, ts: 0 }));
    hub.trade(trade({ ex: 'okx', size: 0.5, side: 'sell', ts: 10 }));
    hub.trade(trade({ ex: 'okx', size: 0.5, side: 'sell', ts: 1000 }));
    clock.now += 500;
    hub.tick();
    expect(seen).toEqual([]); // each sweep is only $40K
  });

  it('emits liquidations with bull/bear direction', () => {
    const hub = hubAt({ now: 0 });
    const seen: any[] = [];
    hub.onEvent((e) => seen.push(e));
    hub.liquidation({ ex: 'okx', liquidated: 'short', price: 80_000, usd: 250_000, ts: 0 });
    hub.liquidation({ ex: 'okx', liquidated: 'long', price: 80_000, usd: 100, ts: 0 }); // below min
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ bull: true, label: 'Shorts liquidated' });
  });
});

describe('MarketHub adaptive large-trade threshold', () => {
  const adaptiveHub = (clock: { now: number }) =>
    new MarketHub({ bigTradeUsd: 10_000, adaptiveBig: { minUsd: 2_000, perMin: 6, windowMs: 60_000 } }, () => clock.now);
  /** One sweep of `usd` per `everyMs`, each flushed by the next tick. */
  const stream = (hub: MarketHub, clock: { now: number }, usd: number, n: number, everyMs: number) => {
    for (let i = 0; i < n; i++) {
      hub.trade(trade({ ex: 'okx', price: usd, size: 1, ts: clock.now }));
      clock.now += everyMs;
      hub.tick();
    }
  };

  it('comes down in a quiet market and climbs back when it gets busy', () => {
    const clock = { now: 1_000_000 };
    const hub = adaptiveHub(clock);
    const seen: number[] = [];
    hub.onEvent((e) => seen.push(Math.round(e.usd)));
    expect(hub.bigTradeUsd).toBe(10_000);
    stream(hub, clock, 3_000, 12, 5_000); // a minute of $3K sweeps, nothing near $10K
    expect(hub.bigTradeUsd).toBe(3_000);
    expect(seen.length).toBeGreaterThan(0);
    stream(hub, clock, 8_000, 20, 1_000); // then 20 $8K sweeps in 20 s
    expect(hub.bigTradeUsd).toBe(8_000); // 6th largest of the window
  });

  it('never goes below the floor or above the ceiling', () => {
    const quiet = { now: 1_000_000 };
    const low = adaptiveHub(quiet);
    const seen: number[] = [];
    low.onEvent((e) => seen.push(e.usd));
    stream(low, quiet, 500, 10, 2_000);
    expect(low.bigTradeUsd).toBe(2_000);
    expect(seen).toEqual([]);

    const busy = { now: 1_000_000 };
    const high = adaptiveHub(busy);
    const big: number[] = [];
    high.onEvent((e) => big.push(e.usd));
    stream(high, busy, 50_000, 10, 1_000);
    expect(high.bigTradeUsd).toBe(10_000);
    expect(big).toHaveLength(10);
  });

  it('stays fixed without adaptiveBig', () => {
    const clock = { now: 1_000_000 };
    const hub = hubAt(clock);
    stream(hub, clock, 3_000, 12, 5_000);
    expect(hub.bigTradeUsd).toBe(50_000);
  });
});

describe('MarketHub depth', () => {
  it('buckets all venues in USD and drops stale books', () => {
    const clock = { now: 1_000_000 };
    const hub = hubAt(clock);
    hub.usdtUsd(1.001);
    hub.book({ ex: 'coinbase', quote: 'USD', snapshot: true, bids: [[99.5, 2]], asks: [[100.5, 1]] });
    hub.book({ ex: 'okx', quote: 'USDT', snapshot: true, bids: [[99.4, 1]], asks: [[100.4, 1]] });
    const d = hub.depth(1, 90, 110);
    expect(d.bids.get(99)).toBeCloseTo(99.5 * 2 + 99.4 * 1.001);
    expect(d.asks.get(100)).toBeCloseTo(100.5 + 100.4 * 1.001);
    clock.now += 60_000;
    hub.book({ ex: 'okx', quote: 'USDT', snapshot: true, bids: [[99.4, 1]], asks: [[100.4, 1]] });
    expect(hub.depth(1, 90, 110).bids.get(99)).toBeCloseTo(99.4 * 1.001);
  });
});
