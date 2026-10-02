import type { BookUpdate, ExchangeId, FeedSink, Level, ParsedEvents, Trade } from '../types';
import { WsFeed, type WsFeedOptions } from './wsFeed';

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)));
const lv = (rows: any[] | undefined): Level[] => (rows ?? []).map((r) => [num(r[0]), num(r[1])] as Level);

/* ----------------------------------------------------------------- Coinbase */

/** Coinbase Exchange feed: `matches` (side = maker side) and `ticker`. */
export function parseCoinbase(m: any): ParsedEvents | null {
  if (m?.type === 'match' || m?.type === 'last_match') {
    if (m.type === 'last_match') return null; // replay of an old print
    return {
      trades: [
        {
          ex: 'coinbase',
          market: 'spot',
          quote: 'USD',
          price: num(m.price),
          size: num(m.size),
          side: m.side === 'sell' ? 'buy' : 'sell', // maker sell => taker buy
          ts: Date.parse(m.time),
        },
      ],
    };
  }
  if (m?.type === 'ticker') {
    const last = num(m.price);
    return {
      tickers: [
        { ex: 'coinbase', quote: 'USD', last, open24h: num(m.open_24h), quoteVolume24h: num(m.volume_24h) * last },
      ],
    };
  }
  return null;
}

/** Coinbase Advanced Trade `level2` (public, no auth). */
export function parseCoinbaseL2(m: any): ParsedEvents | null {
  if (m?.channel !== 'l2_data') return null;
  const books: BookUpdate[] = [];
  for (const ev of m.events ?? []) {
    const bids: Level[] = [];
    const asks: Level[] = [];
    for (const u of ev.updates ?? []) {
      const row: Level = [num(u.price_level), num(u.new_quantity)];
      (u.side === 'bid' ? bids : asks).push(row);
    }
    books.push({ ex: 'coinbase', quote: 'USD', snapshot: ev.type === 'snapshot', bids, asks });
  }
  return { books };
}

/* ------------------------------------------------------------------- Kraken */

export const KRAKEN_DEPTH = 500;

export function parseKraken(m: any): ParsedEvents | null {
  if (!m?.channel || !Array.isArray(m.data)) return null;
  if (m.channel === 'trade') {
    return {
      trades: m.data.map(
        (t: any): Trade => ({
          ex: 'kraken',
          market: 'spot',
          quote: 'USD',
          price: num(t.price),
          size: num(t.qty),
          side: t.side === 'sell' ? 'sell' : 'buy',
          ts: Date.parse(t.timestamp),
        }),
      ),
    };
  }
  if (m.channel === 'book') {
    return {
      books: m.data.map(
        (b: any): BookUpdate => ({
          ex: 'kraken',
          quote: 'USD',
          snapshot: m.type === 'snapshot',
          bids: (b.bids ?? []).map((l: any) => [num(l.price), num(l.qty)] as Level),
          asks: (b.asks ?? []).map((l: any) => [num(l.price), num(l.qty)] as Level),
          depth: KRAKEN_DEPTH,
        }),
      ),
    };
  }
  if (m.channel === 'ticker') {
    const out: ParsedEvents = { tickers: [] };
    for (const t of m.data) {
      if (t.symbol === 'USDT/USD') {
        out.usdtUsd = num(t.last);
      } else if (t.symbol === 'ETH/USD') {
        const last = num(t.last);
        out.tickers!.push({
          ex: 'kraken',
          quote: 'USD',
          last,
          open24h: last - num(t.change),
          quoteVolume24h: num(t.volume) * num(t.vwap),
        });
      }
    }
    return out;
  }
  return null;
}

/* ---------------------------------------------------------------------- OKX */

export const OKX_DEPTH = 400;
/** Contract values for ETH swaps: linear = ETH per contract, inverse = USD per contract. */
const OKX_SWAPS: Record<string, { linear: boolean; ctVal: number }> = {
  'ETH-USDT-SWAP': { linear: true, ctVal: 0.1 },
  'ETH-USD-SWAP': { linear: false, ctVal: 10 },
};

export function parseOkx(m: any): ParsedEvents | null {
  const ch = m?.arg?.channel;
  if (!ch || !Array.isArray(m.data)) return null;
  if (ch === 'trades') {
    return {
      trades: m.data.map(
        (t: any): Trade => ({
          ex: 'okx',
          market: 'spot',
          quote: 'USDT',
          price: num(t.px),
          size: num(t.sz),
          side: t.side === 'sell' ? 'sell' : 'buy',
          ts: num(t.ts),
        }),
      ),
    };
  }
  if (ch === 'books') {
    return {
      books: m.data.map(
        (b: any): BookUpdate => ({
          ex: 'okx',
          quote: 'USDT',
          snapshot: m.action === 'snapshot',
          bids: lv(b.bids),
          asks: lv(b.asks),
          depth: OKX_DEPTH,
        }),
      ),
    };
  }
  if (ch === 'tickers') {
    const t = m.data[0];
    return { tickers: [{ ex: 'okx', quote: 'USDT', last: num(t.last), open24h: num(t.open24h), quoteVolume24h: num(t.volCcy24h) }] };
  }
  if (ch === 'liquidation-orders') {
    const liquidations = [];
    for (const d of m.data) {
      const spec = OKX_SWAPS[d.instId];
      if (!spec) continue;
      for (const x of d.details ?? []) {
        const px = num(x.bkPx);
        const sz = num(x.sz);
        const usd = spec.linear ? sz * spec.ctVal * px : sz * spec.ctVal;
        // posSide is long/short in hedge mode; in net mode a forced sell closes a long.
        const liquidated: 'long' | 'short' =
          x.posSide === 'long' || x.posSide === 'short' ? x.posSide : x.side === 'sell' ? 'long' : 'short';
        liquidations.push({ ex: 'okx' as const, liquidated, price: px, usd, ts: num(x.ts) });
      }
    }
    return { liquidations };
  }
  return null;
}

/* -------------------------------------------------------------------- Bybit */

export const BYBIT_DEPTH = 200;

export function parseBybitSpot(m: any): ParsedEvents | null {
  const topic: string | undefined = m?.topic;
  if (!topic) return null;
  if (topic.startsWith('publicTrade.')) {
    return {
      trades: (m.data ?? []).map(
        (t: any): Trade => ({
          ex: 'bybit',
          market: 'spot',
          quote: 'USDT',
          price: num(t.p),
          size: num(t.v),
          side: t.S === 'Sell' ? 'sell' : 'buy',
          ts: num(t.T),
        }),
      ),
    };
  }
  if (topic.startsWith('orderbook.')) {
    return {
      books: [
        {
          ex: 'bybit',
          quote: 'USDT',
          snapshot: m.type === 'snapshot',
          bids: lv(m.data?.b),
          asks: lv(m.data?.a),
          depth: BYBIT_DEPTH,
        },
      ],
    };
  }
  if (topic.startsWith('tickers.')) {
    const d = m.data;
    return {
      tickers: [{ ex: 'bybit', quote: 'USDT', last: num(d.lastPrice), open24h: num(d.prevPrice24h), quoteVolume24h: num(d.turnover24h) }],
    };
  }
  return null;
}

/**
 * Bybit `allLiquidation` (linear perps). Per Bybit docs, `S` is the position side:
 * "Buy" means a long position was liquidated.
 */
export function parseBybitLiq(m: any): ParsedEvents | null {
  if (!m?.topic?.startsWith('allLiquidation.')) return null;
  return {
    liquidations: (m.data ?? []).map((d: any) => {
      const p = num(d.p);
      return {
        ex: 'bybit' as const,
        liquidated: d.S === 'Buy' ? ('long' as const) : ('short' as const),
        price: p,
        usd: num(d.v) * p,
        ts: num(d.T),
      };
    }),
  };
}

/* ----------------------------------------------------------------- Bitstamp */

export function parseBitstamp(m: any): ParsedEvents | null {
  if (m?.event === 'trade' && m.channel === 'live_trades_ethusd') {
    const d = m.data;
    return {
      trades: [
        {
          ex: 'bitstamp',
          market: 'spot',
          quote: 'USD',
          price: num(d.price),
          size: num(d.amount),
          side: d.type === 1 ? 'sell' : 'buy',
          ts: num(d.microtimestamp) / 1000,
        },
      ],
    };
  }
  if (m?.event === 'data' && m.channel === 'order_book_ethusd') {
    // Top-100 snapshot on every message.
    return { books: [{ ex: 'bitstamp', quote: 'USD', snapshot: true, bids: lv(m.data.bids), asks: lv(m.data.asks) }] };
  }
  return null;
}

/* ------------------------------------------------------------------ Binance */

/** Combined stream envelope `{stream, data}`; spot and USD-M futures. */
export function parseBinance(m: any): ParsedEvents | null {
  const d = m?.data;
  if (!d) return null;
  const stream: string = m.stream ?? '';
  if (d.e === 'aggTrade') {
    return {
      trades: [
        { ex: 'binance', market: 'spot', quote: 'USDT', price: num(d.p), size: num(d.q), side: d.m ? 'sell' : 'buy', ts: num(d.T) },
      ],
    };
  }
  if (stream.includes('@depth20')) {
    return { books: [{ ex: 'binance', quote: 'USDT', snapshot: true, bids: lv(d.bids), asks: lv(d.asks) }] };
  }
  if (d.e === '24hrTicker') {
    return { tickers: [{ ex: 'binance', quote: 'USDT', last: num(d.c), open24h: num(d.o), quoteVolume24h: num(d.q) }] };
  }
  if (d.e === 'forceOrder' && d.o?.s === 'ETHUSDT') {
    const o = d.o;
    const p = num(o.ap) || num(o.p);
    return {
      liquidations: [
        { ex: 'binance', liquidated: o.S === 'SELL' ? 'long' : 'short', price: p, usd: num(o.q) * p, ts: num(o.T) },
      ],
    };
  }
  return null;
}

/* ------------------------------------------------------------------ Deribit */

export function parseDeribit(m: any): ParsedEvents | null {
  if (m?.method !== 'subscription') return null;
  const ch: string = m.params?.channel ?? '';
  if (!ch.startsWith('trades.option.ETH')) return null;
  return {
    trades: (m.params.data ?? []).map((t: any): Trade => {
      const index = num(t.index_price);
      return {
        ex: 'deribit',
        market: 'option',
        quote: 'USD',
        price: index,
        size: num(t.amount),
        side: t.direction === 'sell' ? 'sell' : 'buy',
        ts: num(t.timestamp),
        premiumUsd: num(t.price) * num(t.amount) * index,
        instrument: t.instrument_name,
      };
    }),
  };
}

/* ------------------------------------------------------------------ Factory */

export const ALL_SOURCES: ExchangeId[] = ['coinbase', 'kraken', 'okx', 'bybit', 'bitstamp', 'binance', 'deribit'];

export function feedOptions(): WsFeedOptions[] {
  return [
    {
      ex: 'coinbase',
      channel: 'trades',
      url: 'wss://ws-feed.exchange.coinbase.com',
      subscribe: () => [{ type: 'subscribe', product_ids: ['ETH-USD'], channels: ['matches', 'ticker'] }],
      parse: parseCoinbase,
    },
    {
      ex: 'coinbase',
      channel: 'book',
      url: 'wss://advanced-trade-ws.coinbase.com',
      subscribe: () => [
        { type: 'subscribe', product_ids: ['ETH-USD'], channel: 'level2' },
        { type: 'subscribe', channel: 'heartbeats' },
      ],
      parse: parseCoinbaseL2,
    },
    {
      ex: 'kraken',
      channel: 'spot',
      url: 'wss://ws.kraken.com/v2',
      subscribe: () => [
        { method: 'subscribe', params: { channel: 'book', symbol: ['ETH/USD'], depth: KRAKEN_DEPTH } },
        { method: 'subscribe', params: { channel: 'trade', symbol: ['ETH/USD'] } },
        { method: 'subscribe', params: { channel: 'ticker', symbol: ['ETH/USD', 'USDT/USD'] } },
      ],
      parse: parseKraken,
    },
    {
      ex: 'okx',
      channel: 'spot+liq',
      url: 'wss://ws.okx.com:8443/ws/v5/public',
      subscribe: () => [
        {
          op: 'subscribe',
          args: [
            { channel: 'trades', instId: 'ETH-USDT' },
            { channel: 'books', instId: 'ETH-USDT' },
            { channel: 'tickers', instId: 'ETH-USDT' },
            { channel: 'liquidation-orders', instType: 'SWAP' },
          ],
        },
      ],
      parse: parseOkx,
      ping: { intervalMs: 20_000, payload: () => 'ping' },
    },
    {
      ex: 'bybit',
      channel: 'spot',
      url: 'wss://stream.bybit.com/v5/public/spot',
      subscribe: () => [{ op: 'subscribe', args: ['publicTrade.ETHUSDT', `orderbook.${BYBIT_DEPTH}.ETHUSDT`, 'tickers.ETHUSDT'] }],
      parse: parseBybitSpot,
      ping: { intervalMs: 20_000, payload: () => JSON.stringify({ op: 'ping' }) },
    },
    {
      ex: 'bybit',
      channel: 'liq',
      url: 'wss://stream.bybit.com/v5/public/linear',
      subscribe: () => [{ op: 'subscribe', args: ['allLiquidation.ETHUSDT'] }],
      parse: parseBybitLiq,
      ping: { intervalMs: 20_000, payload: () => JSON.stringify({ op: 'ping' }) },
      staleMs: 120_000,
    },
    {
      ex: 'bitstamp',
      channel: 'spot',
      url: 'wss://ws.bitstamp.net',
      subscribe: () => [
        { event: 'bts:subscribe', data: { channel: 'live_trades_ethusd' } },
        { event: 'bts:subscribe', data: { channel: 'order_book_ethusd' } },
      ],
      parse: parseBitstamp,
    },
    {
      ex: 'binance',
      channel: 'spot',
      // Binance's public-market-data host. `stream.binance.com` answers 451 from restricted
      // regions; the data-only `.vision` host serves the same streams.
      url: 'wss://data-stream.binance.vision/stream?streams=ethusdt@aggTrade/ethusdt@depth20@100ms/ethusdt@ticker',
      subscribe: () => [],
      parse: parseBinance,
    },
    {
      ex: 'binance',
      channel: 'liq',
      url: 'wss://fstream.binance.com/stream?streams=ethusdt@forceOrder',
      subscribe: () => [],
      parse: parseBinance,
      staleMs: 10 * 60_000,
    },
    {
      ex: 'deribit',
      channel: 'options',
      url: 'wss://www.deribit.com/ws/api/v2',
      subscribe: () => [
        { jsonrpc: '2.0', id: 1, method: 'public/set_heartbeat', params: { interval: 30 } },
        { jsonrpc: '2.0', id: 2, method: 'public/subscribe', params: { channels: ['trades.option.ETH.100ms'] } },
      ],
      parse: parseDeribit,
      reply: (m) =>
        m?.method === 'heartbeat' && m.params?.type === 'test_request'
          ? { jsonrpc: '2.0', id: 9, method: 'public/test', params: {} }
          : null,
      staleMs: 120_000,
    },
  ];
}

export function createFeeds(sink: FeedSink, sources: ExchangeId[] = ALL_SOURCES): WsFeed[] {
  return feedOptions()
    .filter((o) => sources.includes(o.ex))
    .map((o) => new WsFeed(o, sink));
}
