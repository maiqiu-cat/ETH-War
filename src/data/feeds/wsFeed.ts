import type { ExchangeId, FeedSink, FeedStatus, ParsedEvents } from '../types';

export interface WsFeedOptions {
  ex: ExchangeId;
  /** Short label for the connection, e.g. "spot" or "liquidations". */
  channel: string;
  url: string;
  /** Messages sent right after the socket opens. */
  subscribe: () => unknown[];
  /** Pure parser: raw JSON (or string) message -> normalized events. */
  parse: (msg: any) => ParsedEvents | null;
  ping?: { intervalMs: number; payload: () => string };
  /** Reply to server-initiated heartbeats (e.g. Deribit test_request). */
  reply?: (msg: any) => unknown | null;
  /** Reconnect if no message arrives for this long. */
  staleMs?: number;
}

/**
 * One WebSocket connection with exponential-backoff reconnect, keepalive pings
 * and a watchdog. Works in browsers and Node >= 22 (global WebSocket).
 */
export class WsFeed {
  status: FeedStatus = 'idle';
  messages = 0;
  lastMessageAt = 0;
  lastError = '';
  /** Successful (re)connections and recent disconnect reasons, for diagnostics. */
  connects = 0;
  readonly errorLog: string[] = [];
  private ws?: WebSocket;
  private attempt = 0;
  private stopped = true;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pingTimer?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setInterval>;

  constructor(
    readonly opts: WsFeedOptions,
    private readonly sink: FeedSink,
  ) {}

  get ex() {
    return this.opts.ex;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.setStatus('closed');
  }

  private setStatus(s: FeedStatus) {
    if (this.status === s) return;
    this.status = s;
    this.sink.status(this.opts.ex, this.opts.channel, s);
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.pingTimer = this.watchdog = undefined;
  }

  private connect() {
    if (this.stopped) return;
    this.clearTimers();
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (e) {
      this.lastError = String(e);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let closed = false;

    ws.onopen = () => {
      this.attempt = 0;
      this.connects++;
      this.lastMessageAt = Date.now();
      this.setStatus('open');
      for (const m of this.opts.subscribe()) ws.send(typeof m === 'string' ? m : JSON.stringify(m));
      if (this.opts.ping) {
        const { intervalMs, payload } = this.opts.ping;
        this.pingTimer = setInterval(() => {
          if (ws.readyState === ws.OPEN) ws.send(payload());
        }, intervalMs);
      }
      const staleMs = this.opts.staleMs ?? 45_000;
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastMessageAt > staleMs) {
          this.lastError = 'stale';
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      }, 5_000);
    };

    ws.onmessage = (ev) => {
      this.messages++;
      this.lastMessageAt = Date.now();
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let msg: any = raw;
      if (raw.length && (raw[0] === '{' || raw[0] === '[')) {
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
      }
      const reply = this.opts.reply?.(msg);
      if (reply != null) ws.send(typeof reply === 'string' ? reply : JSON.stringify(reply));
      let out: ParsedEvents | null = null;
      try {
        out = this.opts.parse(msg);
      } catch (e) {
        this.lastError = `parse: ${String(e)}`;
        return;
      }
      if (out) dispatch(this.sink, out);
    };

    const onDown = (why: string) => {
      if (closed) return;
      closed = true;
      this.lastError = why;
      if (!this.stopped) {
        this.errorLog.push(`${new Date().toISOString().slice(11, 19)} ${why}`);
        if (this.errorLog.length > 10) this.errorLog.shift();
      }
      this.setStatus(this.attempt > 1 ? 'error' : 'closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => onDown('socket error');
    ws.onclose = (ev) => onDown(`closed ${ev.code}`);
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.clearTimers();
    const delay = Math.min(60_000, 1_000 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.timers.push(setTimeout(() => this.connect(), delay));
  }
}

export function dispatch(sink: FeedSink, out: ParsedEvents) {
  if (out.usdtUsd) sink.usdtUsd(out.usdtUsd);
  out.tickers?.forEach((t) => sink.ticker(t));
  out.books?.forEach((b) => sink.book(b));
  out.trades?.forEach((t) => sink.trade(t));
  out.liquidations?.forEach((l) => sink.liquidation(l));
}
