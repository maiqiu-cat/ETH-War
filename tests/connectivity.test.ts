import { describe, expect, it } from 'vitest';
import { NET_GRACE_MS, NET_QUIET_MS, netState } from '../src/data/connectivity';
import type { VenueState } from '../src/data/market';
import type { ExchangeId } from '../src/data/types';

const venue = (ex: ExchangeId, lastTradeAt: number): VenueState => ({
  ex,
  quote: 'USD',
  lastTradeAt,
  notionalPerMin: 0,
  firstTradeAt: lastTradeAt,
  recent: [],
  recentSum: 0,
  trades: lastTradeAt ? 1 : 0,
  channels: {},
});

describe('netState', () => {
  const start = 1_000_000;

  it('reports offline whenever the browser has no network', () => {
    expect(netState([venue('coinbase', start + 1000)], start + 2000, start, false)).toBe('offline');
  });

  it('waits out the first connections before warning', () => {
    expect(netState([], start + NET_GRACE_MS - 1, start)).toBe('checking');
    expect(netState([venue('okx', 0)], start + 5000, start)).toBe('checking');
  });

  it('warns when no exchange has sent a trade after the grace period', () => {
    expect(netState([], start + NET_GRACE_MS, start)).toBe('unreachable');
    expect(netState([venue('kraken', 0), venue('binance', 0)], start + NET_GRACE_MS + 1, start)).toBe('unreachable');
  });

  it('is ok while any spot exchange trades', () => {
    const now = start + 60_000;
    expect(netState([venue('kraken', 0), venue('coinbase', now - 500)], now, start)).toBe('ok');
  });

  it('warns when trades stop arriving mid-session', () => {
    const now = start + 120_000;
    expect(netState([venue('coinbase', now - NET_QUIET_MS + 1)], now, start)).toBe('ok');
    expect(netState([venue('coinbase', now - NET_QUIET_MS)], now, start)).toBe('unreachable');
  });

  it('does not count options trades as live price data', () => {
    const now = start + 60_000;
    expect(netState([venue('deribit', now - 100)], now, start)).toBe('unreachable');
  });
});
