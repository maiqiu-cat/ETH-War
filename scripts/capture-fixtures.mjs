/**
 * Capture real WebSocket messages from every public feed, for parser fixtures.
 *
 *   pnpm capture:fixtures            # 40 s, writes tests/fixtures/_capture/*.json
 *   pnpm capture:fixtures 90         # longer window (more chance of liquidations / option prints)
 *
 * Output is grouped by message kind (first 3 samples per kind, arrays trimmed to 12 items).
 * It deliberately does NOT overwrite tests/fixtures/*.json: diff the new files, then copy
 * the ones you want. tests/parsers.test.ts reads specific kinds (e.g. "books:snapshot",
 * "live_trades_ethusd:"[1]); check those keys still exist before replacing a fixture.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('tests/fixtures/_capture');
const DUR = (Number(process.argv[2]) || 40) * 1000;

const feeds = [
  ['okx', 'wss://ws.okx.com:8443/ws/v5/public', [{ op: 'subscribe', args: [{ channel: 'trades', instId: 'ETH-USDT' }, { channel: 'books', instId: 'ETH-USDT' }, { channel: 'tickers', instId: 'ETH-USDT' }, { channel: 'liquidation-orders', instType: 'SWAP' }] }]],
  ['coinbase', 'wss://ws-feed.exchange.coinbase.com', [{ type: 'subscribe', product_ids: ['ETH-USD'], channels: ['matches', 'ticker'] }]],
  ['coinbase-adv', 'wss://advanced-trade-ws.coinbase.com', [{ type: 'subscribe', product_ids: ['ETH-USD'], channel: 'level2' }, { type: 'subscribe', channel: 'heartbeats' }]],
  ['kraken', 'wss://ws.kraken.com/v2', [{ method: 'subscribe', params: { channel: 'book', symbol: ['ETH/USD'], depth: 100 } }, { method: 'subscribe', params: { channel: 'trade', symbol: ['ETH/USD'] } }, { method: 'subscribe', params: { channel: 'ticker', symbol: ['ETH/USD', 'USDT/USD'] } }]],
  ['bitstamp', 'wss://ws.bitstamp.net', [{ event: 'bts:subscribe', data: { channel: 'live_trades_ethusd' } }, { event: 'bts:subscribe', data: { channel: 'order_book_ethusd' } }]],
  ['bybit-spot', 'wss://stream.bybit.com/v5/public/spot', [{ op: 'subscribe', args: ['publicTrade.ETHUSDT', 'orderbook.200.ETHUSDT', 'tickers.ETHUSDT'] }]],
  ['bybit-linear', 'wss://stream.bybit.com/v5/public/linear', [{ op: 'subscribe', args: ['allLiquidation.ETHUSDT'] }]],
  // `.raw` channels require auth on Deribit; `100ms` is public.
  ['deribit', 'wss://www.deribit.com/ws/api/v2', [{ jsonrpc: '2.0', id: 1, method: 'public/subscribe', params: { channels: ['trades.option.ETH.100ms'] } }]],
  // public-market-data host; stream.binance.com answers 451 from restricted regions
  ['binance', 'wss://data-stream.binance.vision/stream?streams=ethusdt@aggTrade/ethusdt@depth20@100ms/ethusdt@ticker', []],
];

const kindOf = (m) =>
  m.arg?.channel
    ? `${m.arg.channel}:${m.action || m.event || 'data'}`
    : m.channel
      ? `${m.channel}:${m.type || m.events?.[0]?.type || ''}`
      : m.topic
        ? `${m.topic.split('.')[0]}:${m.type}`
        : m.event
          ? `ev:${m.event}:${m.channel || ''}`
          : m.stream
            ? `stream:${m.stream}`
            : m.type
              ? `type:${m.type}`
              : m.method
                ? `method:${m.method}:${m.params?.channel || ''}`
                : 'other';

fs.mkdirSync(OUT, { recursive: true });
await Promise.all(
  feeds.map(
    ([name, url, subs]) =>
      new Promise((resolve) => {
        const kinds = new Map();
        let done = false;
        let ws;
        const finish = (why) => {
          if (done) return;
          done = true;
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
          fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(Object.fromEntries(kinds), null, 1));
          console.log(`${name.padEnd(13)} ${why.padEnd(8)} ${[...kinds].map(([k, v]) => `${k}:${v.length}`).join(' ')}`);
          resolve();
        };
        setTimeout(() => finish('ok'), DUR);
        try {
          ws = new WebSocket(url);
        } catch (e) {
          return finish(`error ${e}`);
        }
        ws.onopen = () => subs.forEach((s) => ws.send(JSON.stringify(s)));
        ws.onmessage = (e) => {
          let m;
          try {
            m = JSON.parse(String(e.data));
          } catch {
            return;
          }
          const k = kindOf(m);
          const arr = kinds.get(k) ?? [];
          if (arr.length < 3) {
            arr.push(JSON.parse(JSON.stringify(m, (_k, v) => (Array.isArray(v) && v.length > 12 ? v.slice(0, 12) : v))));
            kinds.set(k, arr);
          }
        };
        ws.onerror = () => finish('error');
      }),
  ),
);
console.log(`\nWritten to ${path.relative(process.cwd(), OUT)}/`);
// Some sockets linger after close(); exit explicitly.
process.exit(0);
