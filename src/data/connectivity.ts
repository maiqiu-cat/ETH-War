import type { VenueState } from './market';

/**
 * Whether live data is reaching the page, for the HUD's network notice:
 * - `ok`: a spot exchange sent a trade recently
 * - `checking`: still making the first connections (no notice yet)
 * - `offline`: the browser reports no network at all
 * - `unreachable`: online, but no exchange is sending trades (blocked, proxy down, all sockets failing)
 */
export type NetState = 'ok' | 'checking' | 'offline' | 'unreachable';

/** The first connections can take a while on slow networks or behind proxies. */
export const NET_GRACE_MS = 12_000;
/** Spot ETH trades several times a second across the venues: this much silence means no data. */
export const NET_QUIET_MS = 20_000;

export function netState(venues: Iterable<VenueState>, now: number, startedAt: number, online = true): NetState {
  if (!online) return 'offline';
  let freshest = 0;
  // Options (Deribit) do not move the price; only spot trades count.
  for (const v of venues) if (v.ex !== 'deribit') freshest = Math.max(freshest, v.lastTradeAt);
  if (freshest && now - freshest < NET_QUIET_MS) return 'ok';
  if (!freshest && now - startedAt < NET_GRACE_MS) return 'checking';
  return 'unreachable';
}
