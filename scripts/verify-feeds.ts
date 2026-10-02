/**
 * Live data verification: runs the real exchange adapters in Node for N seconds
 * and checks that the aggregated index, books and event streams are sane.
 *
 *   pnpm verify:feeds            # 45 s
 *   pnpm verify:feeds 90         # custom duration
 */
import { writeFileSync } from 'node:fs';
import { createFeeds } from '../src/data/feeds/exchanges';
import { MarketHub, type FeedItem } from '../src/data/market';
import type { ExchangeId } from '../src/data/types';

const seconds = Number(process.argv[2] ?? 45);
const hub = new MarketHub();
const feeds = createFeeds(hub);
const events: FeedItem[] = [];
hub.onEvent((e) => events.push(e));
const crossed: string[] = [];

feeds.forEach((f) => f.start());
const t0 = Date.now();
const samples: number[] = [];
const ticker = setInterval(() => {
  const idx = hub.tick();
  if (idx) samples.push(idx.price);
  for (const [ex, b] of hub.books) {
    const bb = b.bestBid();
    const ba = b.bestAsk();
    if (Number.isFinite(bb) && Number.isFinite(ba) && bb >= ba) crossed.push(`${ex} ${bb}>=${ba}`);
  }
}, 250);

const progress = setInterval(() => {
  const idx = hub.index;
  process.stdout.write(
    `\r${Math.round((Date.now() - t0) / 1000)}s  index=${idx ? idx.price.toFixed(2) : '-'}  events=${events.length}  liqs(all sizes)=${hub.liquidationCount}  options=${hub.optionTradeCount}   `,
  );
}, 1000);

setTimeout(() => {
  clearInterval(ticker);
  clearInterval(progress);
  feeds.forEach((f) => f.stop());
  report();
  // Sockets may linger; exit explicitly.
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}, seconds * 1000);

function report() {
  console.log('\n');
  const idx = hub.computeIndex();
  const rows: Record<string, unknown>[] = [];
  const spotVenues: ExchangeId[] = ['coinbase', 'kraken', 'okx', 'bybit', 'bitstamp', 'binance'];
  for (const ex of [...spotVenues, 'deribit' as ExchangeId]) {
    const v = hub.venues.get(ex);
    const conns = feeds.filter((f) => f.ex === ex);
    const book = hub.books.get(ex);
    const iv = idx?.venues.find((r) => r.ex === ex);
    rows.push({
      venue: ex,
      sockets: conns.map((c) => `${c.opts.channel}:${c.connects}x${c.errorLog.length ? `[${c.errorLog.length} drop]` : ''}`).join(' '),
      msgs: conns.reduce((a, c) => a + c.messages, 0),
      trades: v?.trades ?? 0,
      bookLv: book ? `${book.bids.size}/${book.asks.size}` : '-',
      spreadUsd: book ? +(book.bestAsk() - book.bestBid()).toFixed(2) : '-',
      priceUsd: iv ? +iv.priceUsd.toFixed(2) : '-',
      vsIndexBps: iv && idx ? +((iv.priceUsd / idx.price - 1) * 1e4).toFixed(1) : '-',
      weight: iv && idx ? `${((iv.weight / idx.venues.filter((r) => r.included).reduce((a, r) => a + r.weight, 0)) * 100).toFixed(1)}%` : '-',
    });
  }
  console.table(rows);
  for (const f of feeds) if (f.errorLog.length) console.log(`  ${f.ex}/${f.opts.channel} disconnects: ${f.errorLog.join(' | ')}`);

  const liq = hub.liquidity(0.01);
  const flow = hub.flow(seconds * 1000);
  const range = samples.length ? [Math.min(...samples), Math.max(...samples)] : [NaN, NaN];
  console.log(`USDT/USD: ${hub.usdtUsdRate} (${hub.usdtUsdKnown ? 'live from Kraken' : 'default'})`);
  console.log(`Index: ${idx?.price.toFixed(2)}  range ${range[0]?.toFixed(2)} .. ${range[1]?.toFixed(2)}  24h open ${idx?.open24h.toFixed(2)}`);
  console.log(`Liquidity ±1%: bids $${(liq.bid / 1e6).toFixed(1)}M  asks $${(liq.ask / 1e6).toFixed(1)}M`);
  console.log(`Taker flow: buy $${(flow.buy / 1e6).toFixed(2)}M  sell $${(flow.sell / 1e6).toFixed(2)}M`);
  console.log(`ETH liquidations seen (all sizes): ${hub.liquidationCount}; option trades: ${hub.optionTradeCount}`);
  console.log(`Feed events (${events.length}):`);
  for (const e of events.slice(0, 15)) console.log(`  ${new Date(e.ts).toISOString().slice(11, 19)} ${e.ex.padEnd(8)} ${e.label.padEnd(18)} $${Math.round(e.usd).toLocaleString()} ${e.detail ?? ''}`);

  // Checks
  const live = idx?.venues.filter((r) => r.included) ?? [];
  const checks: [string, boolean, string][] = [
    ['>= 3 spot venues in index', live.length >= 3, `${live.length}: ${live.map((r) => r.ex).join(', ')}`],
    ['every included venue within 30 bps of index', live.every((r) => Math.abs(r.priceUsd / idx!.price - 1) < 0.003), ''],
    ['USDT/USD rate received', hub.usdtUsdKnown, String(hub.usdtUsdRate)],
    ['>= 3 books populated', [...hub.books.values()].filter((b) => b.bids.size > 20 && b.asks.size > 20).length >= 3, ''],
    ['no crossed books observed', crossed.length === 0, crossed.slice(0, 3).join('; ')],
    ['aggregated depth ±1% > $5M per side', liq.bid > 5e6 && liq.ask > 5e6, ''],
  ];
  console.log('\nChecks:');
  let ok = true;
  for (const [name, pass, info] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
    ok &&= pass;
  }
  writeFileSync(
    'verification/feeds-report.json',
    JSON.stringify({ at: new Date().toISOString(), seconds, rows, index: idx, liq, flow, events: events.slice(0, 30), checks, crossed: crossed.slice(0, 20) }, null, 1),
  );
  if (!ok) process.exitCode = 1;
}
