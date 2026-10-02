export type ExchangeId =
  | 'coinbase'
  | 'kraken'
  | 'okx'
  | 'bybit'
  | 'bitstamp'
  | 'binance'
  | 'deribit'
  | 'sim';

export type Side = 'buy' | 'sell';
export type Market = 'spot' | 'perp' | 'option';
/** Quote currency of a venue. USDT prices are converted to USD before aggregation. */
export type Quote = 'USD' | 'USDT';

export interface Trade {
  ex: ExchangeId;
  market: Market;
  quote: Quote;
  /** Price in the venue's quote currency (option trades: underlying index price). */
  price: number;
  /** Size in ETH (option trades: contracts, 1 contract = 1 ETH). */
  size: number;
  /** Taker side. */
  side: Side;
  ts: number;
  /** Option trades only: premium paid in USD and instrument name. */
  premiumUsd?: number;
  instrument?: string;
}

export interface Liquidation {
  ex: ExchangeId;
  /** Which position got liquidated. */
  liquidated: 'long' | 'short';
  price: number;
  usd: number;
  ts: number;
}

/** [price, sizeETH]; size 0 deletes the level. */
export type Level = [number, number];

export interface BookUpdate {
  ex: ExchangeId;
  quote: Quote;
  snapshot: boolean;
  bids: Level[];
  asks: Level[];
  /** Max levels the venue keeps per side; extra levels are truncated after each update. */
  depth?: number;
}

export interface TickerUpdate {
  ex: ExchangeId;
  quote: Quote;
  last?: number;
  open24h?: number;
  /** 24h traded volume in the quote currency. */
  quoteVolume24h?: number;
}

export type FeedStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface FeedSink {
  trade(t: Trade): void;
  liquidation(l: Liquidation): void;
  book(b: BookUpdate): void;
  ticker(t: TickerUpdate): void;
  /** USDT/USD reference rate. */
  usdtUsd(rate: number): void;
  status(ex: ExchangeId, channel: string, status: FeedStatus): void;
}

/** Normalized output of a pure message parser. */
export interface ParsedEvents {
  trades?: Trade[];
  liquidations?: Liquidation[];
  books?: BookUpdate[];
  tickers?: TickerUpdate[];
  usdtUsd?: number;
}
