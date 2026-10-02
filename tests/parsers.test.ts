import { describe, expect, it } from 'vitest';
import {
  parseBinance,
  parseBitstamp,
  parseBybitLiq,
  parseBybitSpot,
  parseCoinbase,
  parseCoinbaseL2,
  parseDeribit,
  parseKraken,
  parseOkx,
} from '../src/data/feeds/exchanges';
import okx from './fixtures/okx.json';
import coinbase from './fixtures/coinbase.json';
import coinbaseAdv from './fixtures/coinbase-adv.json';
import kraken from './fixtures/kraken.json';
import bybitSpot from './fixtures/bybit-spot.json';
import bitstamp from './fixtures/bitstamp.json';
import binance from './fixtures/binance.json';
import deribit from './fixtures/deribit.json';

// Fixtures are real messages captured from the public ETH feeds on 2026-10-02.
const f = (o: any, k: string) => o[k] as any[];

describe('OKX', () => {
  it('parses spot trades with taker side', () => {
    const msg = f(okx, 'trades:data')[0];
    const out = parseOkx(msg)!;
    expect(out.trades![0]).toMatchObject({ ex: 'okx', quote: 'USDT', market: 'spot' });
    expect(out.trades![0].price).toBeCloseTo(parseFloat(msg.data[0].px));
    expect(out.trades![0].side).toBe(msg.data[0].side);
  });

  it('parses book snapshot and updates with 400-level depth', () => {
    const snap = parseOkx(f(okx, 'books:snapshot')[0])!.books![0];
    expect(snap.snapshot).toBe(true);
    expect(snap.depth).toBe(400);
    expect(snap.bids.length).toBeGreaterThan(0);
    const upd = parseOkx(f(okx, 'books:update')[0])!.books![0];
    expect(upd.snapshot).toBe(false);
  });

  it('parses ticker volume in quote currency', () => {
    const t = parseOkx(f(okx, 'tickers:data')[0])!.tickers![0];
    expect(t.quoteVolume24h).toBeGreaterThan(1e6);
    expect(t.open24h).toBeGreaterThan(1000);
  });

  it('ignores non-ETH liquidations and sizes ETH swaps correctly', () => {
    expect(parseOkx(f(okx, 'liquidation-orders:data')[0])!.liquidations).toEqual([]);
    const linear = parseOkx({
      arg: { channel: 'liquidation-orders', instType: 'SWAP' },
      data: [
        {
          instId: 'ETH-USDT-SWAP',
          details: [{ bkPx: '2700', posSide: 'net', side: 'buy', sz: '50', ts: '1' }],
        },
        {
          instId: 'ETH-USD-SWAP',
          details: [{ bkPx: '2700', posSide: 'long', side: 'sell', sz: '10', ts: '2' }],
        },
      ],
    })!.liquidations!;
    expect(linear[0]).toMatchObject({ liquidated: 'short', usd: 50 * 0.1 * 2700 });
    expect(linear[1]).toMatchObject({ liquidated: 'long', usd: 100 });
  });

  it('ignores subscribe acks and pong strings', () => {
    expect(parseOkx(f(okx, 'trades:subscribe')[0])).toBeNull();
    expect(parseOkx('pong')).toBeNull();
  });
});

describe('Coinbase', () => {
  it('inverts maker side for matches', () => {
    const m = f(coinbase, 'type:match')[0];
    const t = parseCoinbase(m)!.trades![0];
    expect(t.side).toBe(m.side === 'sell' ? 'buy' : 'sell');
    expect(t.quote).toBe('USD');
  });

  it('skips last_match replays', () => {
    expect(parseCoinbase(f(coinbase, 'type:last_match')[0])).toBeNull();
  });

  it('derives quote volume from the ticker', () => {
    const m = f(coinbase, 'type:ticker')[0];
    const t = parseCoinbase(m)!.tickers![0];
    expect(t.quoteVolume24h).toBeCloseTo(parseFloat(m.volume_24h) * parseFloat(m.price));
  });

  it('parses advanced-trade level2 snapshot and updates', () => {
    const snap = parseCoinbaseL2(f(coinbaseAdv, 'l2_data:snapshot')[0])!.books![0];
    expect(snap.snapshot).toBe(true);
    expect(snap.bids.length + snap.asks.length).toBeGreaterThan(0);
    const upd = parseCoinbaseL2(f(coinbaseAdv, 'l2_data:update')[0])!.books![0];
    expect(upd.snapshot).toBe(false);
    expect(parseCoinbaseL2(f(coinbaseAdv, 'heartbeats:')[0])).toBeNull();
  });
});

describe('Kraken', () => {
  it('parses book, trades and both tickers', () => {
    const book = parseKraken(f(kraken, 'book:snapshot')[0])!.books![0];
    expect(book).toMatchObject({ ex: 'kraken', snapshot: true, depth: 500 });
    expect(book.bids[0][0]).toBeGreaterThan(1000);
    const trade = parseKraken(f(kraken, 'trade:update')[0])!.trades![0];
    expect(['buy', 'sell']).toContain(trade.side);
    const snaps = f(kraken, 'ticker:snapshot').map((m) => parseKraken(m)!);
    const usdt = snaps.find((s) => s.usdtUsd);
    const eth = snaps.find((s) => s.tickers?.length);
    expect(usdt!.usdtUsd).toBeGreaterThan(0.95);
    expect(eth!.tickers![0].quoteVolume24h).toBeGreaterThan(1e6);
    expect(parseKraken(f(kraken, 'heartbeat:')[0])).toBeNull();
  });
});

describe('Bybit', () => {
  it('parses spot trades, book and ticker', () => {
    const t = parseBybitSpot(f(bybitSpot, 'publicTrade:snapshot')[0])!.trades![0];
    expect(t).toMatchObject({ ex: 'bybit', quote: 'USDT' });
    const b = parseBybitSpot(f(bybitSpot, 'orderbook:snapshot')[0])!.books![0];
    expect(b).toMatchObject({ snapshot: true, depth: 200 });
    const d = parseBybitSpot(f(bybitSpot, 'orderbook:delta')[0])!.books![0];
    expect(d.snapshot).toBe(false);
    expect(d.bids.some(([, s]) => s === 0) || d.asks.some(([, s]) => s === 0)).toBe(true);
    const tk = parseBybitSpot(f(bybitSpot, 'tickers:snapshot')[0])!.tickers![0];
    expect(tk.quoteVolume24h).toBeGreaterThan(1e6);
  });

  it('maps allLiquidation position side', () => {
    const out = parseBybitLiq({
      topic: 'allLiquidation.ETHUSDT',
      data: [
        { T: 1, s: 'ETHUSDT', S: 'Buy', v: '5', p: '2700' },
        { T: 2, s: 'ETHUSDT', S: 'Sell', v: '10', p: '2710' },
      ],
    })!.liquidations!;
    expect(out[0]).toMatchObject({ liquidated: 'long', usd: 13500 });
    expect(out[1]).toMatchObject({ liquidated: 'short', usd: 27100 });
  });
});

describe('Bitstamp', () => {
  it('parses trades (type 0 = buy) and top-100 snapshots', () => {
    const msg = f(bitstamp, 'live_trades_ethusd:')[1];
    const t = parseBitstamp(msg)!.trades![0];
    expect(t.side).toBe(msg.data.type === 0 ? 'buy' : 'sell');
    const b = parseBitstamp(f(bitstamp, 'order_book_ethusd:')[1])!.books![0];
    expect(b.snapshot).toBe(true);
    expect(parseBitstamp(f(bitstamp, 'live_trades_ethusd:')[0])).toBeNull();
  });
});

describe('Binance', () => {
  it('parses real aggTrade (buyer maker = taker sell), depth20 and ticker messages', () => {
    const m = f(binance, 'stream:ethusdt@aggTrade')[0];
    const t = parseBinance(m)!.trades![0];
    expect(t).toMatchObject({ ex: 'binance', quote: 'USDT', side: m.data.m ? 'sell' : 'buy' });
    expect(t.price).toBeCloseTo(parseFloat(m.data.p));
    const b = parseBinance(f(binance, 'stream:ethusdt@depth20@100ms')[0])!.books![0];
    expect(b.snapshot).toBe(true);
    expect(b.bids.length).toBeGreaterThan(0);
    expect(b.bids[0][0]).toBeGreaterThan(1000);
    const tk = parseBinance(f(binance, 'stream:ethusdt@ticker')[0])!.tickers![0];
    expect(tk.quoteVolume24h).toBeGreaterThan(1e6);
    expect(tk.open24h).toBeGreaterThan(1000);
  });

  it('maps forceOrder to the liquidated side', () => {
    const l = parseBinance({
      stream: 'ethusdt@forceOrder',
      data: { e: 'forceOrder', o: { s: 'ETHUSDT', S: 'SELL', q: '5', p: '2690', ap: '2691', T: 3 } },
    })!;
    expect(l.liquidations![0]).toMatchObject({ liquidated: 'long', usd: 5 * 2691 });
  });
});

describe('Deribit', () => {
  it('computes option premium in USD', () => {
    const out = parseDeribit({
      jsonrpc: '2.0',
      method: 'subscription',
      params: {
        channel: 'trades.option.ETH.100ms',
        data: [
          { instrument_name: 'ETH-2OCT26-2700-C', price: 0.01, amount: 20, direction: 'buy', index_price: 2700, timestamp: 5 },
        ],
      },
    })!;
    expect(out.trades![0]).toMatchObject({ market: 'option', side: 'buy', premiumUsd: 0.01 * 20 * 2700 });
  });

  it('parses real option trades (1 contract = 1 ETH, price quoted in ETH)', () => {
    const msg = f(deribit, 'method:subscription:trades.option.ETH.100ms')[0];
    const d = msg.params.data[0];
    const t = parseDeribit(msg)!.trades![0];
    expect(t).toMatchObject({ ex: 'deribit', market: 'option', instrument: d.instrument_name });
    expect(t.premiumUsd).toBeCloseTo(d.price * d.amount * d.index_price);
    expect(parseDeribit(f(deribit, 'other')[0])).toBeNull();
  });

  it('ignores other currencies', () => {
    expect(parseDeribit({ method: 'subscription', params: { channel: 'trades.option.BTC.100ms', data: [] } })).toBeNull();
  });
});
