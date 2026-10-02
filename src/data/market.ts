import { OrderBook } from './orderbook';
import type {
  BookUpdate,
  ExchangeId,
  FeedSink,
  FeedStatus,
  Liquidation,
  Quote,
  Side,
  TickerUpdate,
  Trade,
} from './types';

export interface VenueState {
  ex: ExchangeId;
  quote: Quote;
  last?: number;
  lastTradeAt: number;
  open24h?: number;
  quoteVol24h?: number;
  /** Traded notional over the last 10 minutes, USD per minute (fallback weight for venues without a 24h ticker). */
  notionalPerMin: number;
  firstTradeAt: number;
  recent: { ts: number; usd: number }[];
  recentSum: number;
  trades: number;
  channels: Record<string, FeedStatus>;
}

export interface IndexVenue {
  ex: ExchangeId;
  priceUsd: number;
  weight: number;
  included: boolean;
}

export interface IndexResult {
  price: number;
  open24h: number;
  venues: IndexVenue[];
}

export type FeedKind = 'trade' | 'option' | 'liq';
/** i18n key suffix (`feed.<type>`). */
export type FeedType = 'bigBuy' | 'bigSell' | 'optBuy' | 'optSell' | 'liqShort' | 'liqLong';

export interface FeedItem {
  id: number;
  kind: FeedKind;
  type: FeedType;
  ex: ExchangeId;
  /** true when the event pushes price up (taker buy / shorts liquidated). */
  bull: boolean;
  usd: number;
  price: number;
  ts: number;
  label: string;
  detail?: string;
}

export interface DepthBuckets {
  bucket: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
}

/**
 * Lets the large-trade threshold follow the market: in a quiet hour it comes down from
 * `bigTradeUsd` (never below `minUsd`) so that about `perMin` sweeps a minute still qualify.
 * The k-th largest sweep of the look-back window is the threshold, k = perMin × minutes seen.
 */
export interface AdaptiveBig {
  minUsd: number;
  perMin: number;
  windowMs: number;
}

export interface MarketConfig {
  /** Large-trade threshold; the ceiling when `adaptiveBig` is set. */
  bigTradeUsd: number;
  adaptiveBig: AdaptiveBig | null;
  bigOptionPremiumUsd: number;
  minLiquidationUsd: number;
  /** Venues whose price deviates more than this from the median are excluded. */
  outlierPct: number;
  staleTradeMs: number;
  staleBookMs: number;
}

export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  bigTradeUsd: 50_000,
  adaptiveBig: null,
  bigOptionPremiumUsd: 500,
  minLiquidationUsd: 1_000,
  outlierPct: 0.005,
  staleTradeMs: 120_000,
  staleBookMs: 30_000,
};

interface PendingSweep {
  side: Side;
  usd: number;
  size: number;
  pxSize: number;
  firstTs: number;
  lastTs: number;
  receivedAt: number;
}

interface FlowBucket {
  sec: number;
  buy: number;
  sell: number;
}

type Listener<T> = (v: T) => void;

/**
 * Normalizes every venue into USD, keeps the books, computes the volume-weighted
 * index and turns raw prints into "battlefield" events.
 */
export class MarketHub implements FeedSink {
  readonly venues = new Map<ExchangeId, VenueState>();
  readonly books = new Map<ExchangeId, OrderBook>();
  readonly feed: FeedItem[] = [];
  usdtUsdRate = 1;
  usdtUsdKnown = false;
  liquidationCount = 0;
  optionTradeCount = 0;

  private readonly cfg: MarketConfig;
  private readonly pending = new Map<ExchangeId, PendingSweep>();
  /** Every merged sweep of the adaptive look-back window, for the threshold. */
  private readonly sweeps: { ts: number; usd: number }[] = [];
  private firstSweepAt = 0;
  private bigUsd: number;
  private lastBigAt = 0;
  private readonly flowBuckets: FlowBucket[] = [];
  private readonly priceHistory: { ts: number; price: number }[] = [];
  private lastIndex: IndexResult | null = null;
  private seq = 0;
  private lastPruneAt = 0;
  private listeners = new Set<Listener<FeedItem>>();
  private tradeListeners = new Set<Listener<Trade>>();

  constructor(cfg: Partial<MarketConfig> = {}, private readonly now: () => number = Date.now) {
    this.cfg = { ...DEFAULT_MARKET_CONFIG, ...cfg };
    this.bigUsd = this.cfg.bigTradeUsd;
  }

  /** Current large-trade threshold in USD (moves with the market when `adaptiveBig` is set). */
  get bigTradeUsd() {
    return this.bigUsd;
  }

  onEvent(fn: Listener<FeedItem>) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onTrade(fn: Listener<Trade>) {
    this.tradeListeners.add(fn);
    return () => this.tradeListeners.delete(fn);
  }

  /* ------------------------------------------------------------ FeedSink */

  status(ex: ExchangeId, channel: string, status: FeedStatus) {
    this.venue(ex).channels[channel] = status;
  }

  usdtUsd(rate: number) {
    if (rate > 0.9 && rate < 1.1) {
      this.usdtUsdRate = rate;
      this.usdtUsdKnown = true;
    }
  }

  ticker(t: TickerUpdate) {
    const v = this.venue(t.ex, t.quote);
    if (t.open24h && Number.isFinite(t.open24h)) v.open24h = t.open24h;
    if (t.quoteVolume24h && Number.isFinite(t.quoteVolume24h)) v.quoteVol24h = t.quoteVolume24h;
    if (t.last && !v.last) v.last = t.last;
  }

  book(b: BookUpdate) {
    let book = this.books.get(b.ex);
    if (!book) this.books.set(b.ex, (book = new OrderBook()));
    this.venue(b.ex, b.quote);
    book.apply(b, this.now());
  }

  trade(t: Trade) {
    if (!(t.price > 0) || !(t.size > 0)) return;
    this.tradeListeners.forEach((fn) => fn(t));
    if (t.market === 'option') {
      this.optionTradeCount++;
      const prem = t.premiumUsd ?? 0;
      if (prem >= this.cfg.bigOptionPremiumUsd) {
        this.emit({
          kind: 'option',
          type: t.side === 'buy' ? 'optBuy' : 'optSell',
          ex: t.ex,
          bull: t.side === 'buy',
          usd: prem,
          price: t.price,
          ts: t.ts,
          label: `Large option ${t.side}`,
          detail: t.instrument,
        });
      }
      return;
    }
    const now = this.now();
    const v = this.venue(t.ex, t.quote);
    const usd = t.price * t.size * this.fx(t.quote);
    v.last = t.price;
    v.lastTradeAt = now;
    v.trades++;
    if (!v.firstTradeAt) v.firstTradeAt = now;
    v.recent.push({ ts: now, usd });
    v.recentSum += usd;
    while (v.recent.length && now - v.recent[0].ts > 600_000) v.recentSum -= v.recent.shift()!.usd;
    const minutes = Math.min(10, Math.max(0.5, (now - v.firstTradeAt) / 60_000));
    v.notionalPerMin = v.recentSum / minutes;

    const sec = Math.floor(now / 1000);
    let fb = this.flowBuckets[this.flowBuckets.length - 1];
    if (!fb || fb.sec !== sec) {
      fb = { sec, buy: 0, sell: 0 };
      this.flowBuckets.push(fb);
      while (this.flowBuckets.length > 600) this.flowBuckets.shift();
    }
    fb[t.side] += usd;

    // Merge prints from one aggressive order sweeping several levels.
    const p = this.pending.get(t.ex);
    if (p && p.side === t.side && Math.abs(t.ts - p.lastTs) <= 100) {
      p.usd += usd;
      p.size += t.size;
      p.pxSize += t.price * t.size;
      p.lastTs = Math.max(p.lastTs, t.ts);
      p.receivedAt = now;
    } else {
      if (p) this.flushSweep(t.ex, p);
      this.pending.set(t.ex, {
        side: t.side,
        usd,
        size: t.size,
        pxSize: t.price * t.size,
        firstTs: t.ts,
        lastTs: t.ts,
        receivedAt: now,
      });
    }
  }

  liquidation(l: Liquidation) {
    if (!(l.usd > 0)) return;
    this.liquidationCount++;
    if (l.usd < this.cfg.minLiquidationUsd) return;
    this.emit({
      kind: 'liq',
      type: l.liquidated === 'short' ? 'liqShort' : 'liqLong',
      ex: l.ex,
      bull: l.liquidated === 'short',
      usd: l.usd,
      price: l.price,
      ts: l.ts,
      label: l.liquidated === 'short' ? 'Shorts liquidated' : 'Longs liquidated',
    });
  }

  /* --------------------------------------------------------------- Ticking */

  /** Call a few times per second: flushes sweeps, samples price, prunes books. */
  tick() {
    const now = this.now();
    for (const [ex, p] of this.pending) {
      if (now - p.receivedAt > 150) {
        this.flushSweep(ex, p);
        this.pending.delete(ex);
      }
    }
    if (this.cfg.adaptiveBig && now - this.lastBigAt >= 1000) {
      this.lastBigAt = now;
      this.updateBigThreshold(now);
    }
    const idx = this.computeIndex();
    if (idx) {
      const last = this.priceHistory[this.priceHistory.length - 1];
      if (!last || now - last.ts >= 250) {
        this.priceHistory.push({ ts: now, price: idx.price });
        while (this.priceHistory.length && now - this.priceHistory[0].ts > 15 * 60_000) this.priceHistory.shift();
      }
      if (now - this.lastPruneAt > 5_000) {
        this.lastPruneAt = now;
        for (const [ex, b] of this.books) b.prune(idx.price / this.fx(this.venue(ex).quote), 0.05);
      }
    }
    return idx;
  }

  /* --------------------------------------------------------------- Queries */

  get index() {
    return this.lastIndex;
  }

  computeIndex(): IndexResult | null {
    const now = this.now();
    const rows: IndexVenue[] = [];
    for (const v of this.venues.values()) {
      if (!v.last || now - v.lastTradeAt > this.cfg.staleTradeMs) continue;
      const fx = this.fx(v.quote);
      const weight = v.quoteVol24h ? v.quoteVol24h * fx : v.notionalPerMin * 1440;
      rows.push({ ex: v.ex, priceUsd: v.last * fx, weight, included: true });
    }
    if (!rows.length) return this.lastIndex;
    const sorted = rows.map((r) => r.priceUsd).sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    let num = 0;
    let den = 0;
    let openNum = 0;
    let openDen = 0;
    for (const r of rows) {
      r.included = Math.abs(r.priceUsd / median - 1) <= this.cfg.outlierPct;
      if (!r.included) continue;
      const w = r.weight > 0 ? r.weight : 1;
      num += r.priceUsd * w;
      den += w;
      const v = this.venues.get(r.ex)!;
      if (v.open24h) {
        openNum += v.open24h * this.fx(v.quote) * w;
        openDen += w;
      }
    }
    const price = den > 0 ? num / den : median;
    this.lastIndex = { price, open24h: openDen > 0 ? openNum / openDen : NaN, venues: rows };
    return this.lastIndex;
  }

  /** Aggregated depth in USD per price bucket (bucket index = floor(priceUsd / bucket)). */
  depth(bucket: number, minPrice: number, maxPrice: number, source: ExchangeId | 'all' = 'all'): DepthBuckets {
    const now = this.now();
    const out: DepthBuckets = { bucket, bids: new Map(), asks: new Map() };
    for (const [ex, book] of this.books) {
      if (source !== 'all' && source !== ex) continue;
      if (now - book.updatedAt > this.cfg.staleBookMs) continue;
      const fx = this.fx(this.venue(ex).quote);
      for (const [p, s] of book.bids) {
        const pu = p * fx;
        if (pu < minPrice || pu > maxPrice) continue;
        const k = Math.floor(pu / bucket);
        out.bids.set(k, (out.bids.get(k) ?? 0) + pu * s);
      }
      for (const [p, s] of book.asks) {
        const pu = p * fx;
        if (pu < minPrice || pu > maxPrice) continue;
        const k = Math.floor(pu / bucket);
        out.asks.set(k, (out.asks.get(k) ?? 0) + pu * s);
      }
    }
    return out;
  }

  /** USD resting within `pct` of the index on each side. */
  liquidity(pct: number, source: ExchangeId | 'all' = 'all') {
    const idx = this.lastIndex?.price;
    if (!idx) return { bid: 0, ask: 0 };
    const d = this.depth(idx * pct, idx * (1 - pct), idx * (1 + pct), source);
    let bid = 0;
    let ask = 0;
    d.bids.forEach((v) => (bid += v));
    d.asks.forEach((v) => (ask += v));
    return { bid, ask };
  }

  /** Taker flow in USD over the last `ms`. */
  flow(ms: number) {
    const from = Math.floor((this.now() - ms) / 1000);
    let buy = 0;
    let sell = 0;
    for (let i = this.flowBuckets.length - 1; i >= 0 && this.flowBuckets[i].sec >= from; i--) {
      buy += this.flowBuckets[i].buy;
      sell += this.flowBuckets[i].sell;
    }
    return { buy, sell };
  }

  /** Index price `ms` ago (closest sample). */
  priceAgo(ms: number) {
    const t = this.now() - ms;
    for (let i = this.priceHistory.length - 1; i >= 0; i--) if (this.priceHistory[i].ts <= t) return this.priceHistory[i].price;
    return this.priceHistory[0]?.price;
  }

  /** Realized volatility of 1-minute returns over the last `minutes`, in percent. */
  realizedVolPct(minutes = 5) {
    const now = this.now();
    const pts: number[] = [];
    for (let m = minutes; m >= 0; m--) {
      const p = this.priceAgo(m * 60_000);
      if (p) pts.push(p);
    }
    if (pts.length < 3 || now - (this.priceHistory[0]?.ts ?? now) < 60_000) return NaN;
    const rets = pts.slice(1).map((p, i) => Math.log(p / pts[i]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return Math.sqrt(v) * 100;
  }

  fx(q: Quote) {
    return q === 'USDT' ? this.usdtUsdRate : 1;
  }

  venue(ex: ExchangeId, quote?: Quote): VenueState {
    let v = this.venues.get(ex);
    if (!v) {
      v = { ex, quote: quote ?? 'USD', lastTradeAt: 0, notionalPerMin: 0, firstTradeAt: 0, recent: [], recentSum: 0, trades: 0, channels: {} };
      this.venues.set(ex, v);
    } else if (quote) {
      v.quote = quote;
    }
    return v;
  }

  /* -------------------------------------------------------------- Internal */

  private updateBigThreshold(now: number) {
    const a = this.cfg.adaptiveBig!;
    while (this.sweeps.length && now - this.sweeps[0].ts > a.windowMs) this.sweeps.shift();
    if (!this.firstSweepAt) return;
    const minutes = Math.min(a.windowMs, now - this.firstSweepAt) / 60_000;
    const k = Math.max(1, Math.round(a.perMin * minutes));
    const kth = this.sweeps.map((s) => s.usd).sort((x, y) => y - x)[k - 1] ?? 0;
    this.bigUsd = Math.min(this.cfg.bigTradeUsd, Math.max(a.minUsd, kth));
  }

  private flushSweep(ex: ExchangeId, p: PendingSweep) {
    if (this.cfg.adaptiveBig) {
      const now = this.now();
      this.sweeps.push({ ts: now, usd: p.usd });
      if (!this.firstSweepAt) this.firstSweepAt = now;
    }
    if (p.usd < this.bigUsd) return;
    const v = this.venue(ex);
    this.emit({
      kind: 'trade',
      type: p.side === 'buy' ? 'bigBuy' : 'bigSell',
      ex,
      bull: p.side === 'buy',
      usd: p.usd,
      price: (p.pxSize / p.size) * this.fx(v.quote),
      ts: p.firstTs,
      label: `Large ${p.side} trade`,
    });
  }

  private emit(item: Omit<FeedItem, 'id'>) {
    const full: FeedItem = { ...item, id: ++this.seq };
    this.feed.unshift(full);
    if (this.feed.length > 60) this.feed.length = 60;
    this.listeners.forEach((fn) => fn(full));
  }
}
