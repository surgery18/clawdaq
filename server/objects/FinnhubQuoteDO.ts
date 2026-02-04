import type { Bindings } from "../utils/types";

const WATCHLIST = ["RUM", "TIRX", "AITX", "FAT", "DJT", "AAPL", "TSLA"];
const QUOTE_CACHE_PREFIX = "quote:v1:";
const WS_BASE_URL = "wss://ws.finnhub.io?token=";
const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;
const HEARTBEAT_MS = 15000;
const CONNECT_TIMEOUT_MS = 10000;

const roundPrice = (value: number, symbol: string) => {
  if (symbol === "AITX") return Math.max(0.0001, Math.round(value * 10000) / 10000);
  return Math.max(0.01, Math.round(value * 100) / 100);
};

export class FinnhubQuoteDO {
  private state: DurableObjectState;
  private env: Bindings;
  private ws: WebSocket | null = null;
  private connecting = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private lastMessageAt: string | null = null;
  private lastConnectAt: string | null = null;
  private tickCount = 0;
  private lastTickLogAt = 0;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      console.info("FinnhubQuoteDO /connect requested");
      const status = await this.ensureConnection();
      return new Response(JSON.stringify(status), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    if (url.pathname === "/reconnect") {
      console.info("FinnhubQuoteDO /reconnect requested. Forcing fresh connection.");
      this.handleDisconnect("manual_reset");
      const status = await this.ensureConnection();
      return new Response(JSON.stringify(status), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    if (url.pathname === "/status") {
      return new Response(
        JSON.stringify({
          ok: true,
          connected: this.ws?.readyState === WebSocket.OPEN,
          connecting: this.connecting,
          lastMessageAt: this.lastMessageAt,
          lastConnectAt: this.lastConnectAt,
          watchlist: WATCHLIST
        }),
        {
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ping" }));
      this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
      return;
    }

    if (!this.connecting) {
      await this.ensureConnection();
    }
  }

  private async ensureConnection() {
    if (!this.env.FINNHUB_API_KEY) {
      console.error("FinnhubQuoteDO: FINNHUB_API_KEY is missing in env.");
      return { ok: false, error: "missing FINNHUB_API_KEY" };
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return { ok: true, connected: true };
    }

    if (this.connecting) {
      console.info("FinnhubQuoteDO: Connection already in progress...");
      return { ok: true, connecting: true };
    }

    await this.connect();
    return { ok: true, connecting: true };
  }

  private async connect() {
    this.connecting = true;
    console.info("FinnhubQuoteDO: Opening WebSocket to Finnhub...");
    this.lastConnectAt = new Date().toISOString();

    try {
      const ws = new WebSocket(`${WS_BASE_URL}${this.env.FINNHUB_API_KEY}`);
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (this.connecting) {
          console.warn("FinnhubQuoteDO: Connection timed out.");
          this.handleDisconnect("timeout");
        }
      }, CONNECT_TIMEOUT_MS);

      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        this.connecting = false;
        this.backoffMs = INITIAL_BACKOFF_MS;
        this.tickCount = 0;
        this.lastTickLogAt = Date.now();
        console.info("FinnhubQuoteDO: Connected! Subscribing...");
        this.subscribeAll();
        this.startHeartbeat();
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        this.handleMessage(event.data);
      });

      ws.addEventListener("close", () => {
        clearTimeout(timeout);
        this.handleDisconnect("close");
      });

      ws.addEventListener("error", (e) => {
        clearTimeout(timeout);
        console.error("FinnhubQuoteDO WebSocket Error:", e);
        this.handleDisconnect("error");
      });
    } catch (err) {
      this.connecting = false;
      console.error("FinnhubQuoteDO setup error:", err);
      this.scheduleReconnect();
    }
  }

  private subscribeAll() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const symbol of WATCHLIST) {
      this.ws.send(JSON.stringify({ type: "subscribe", symbol }));
    }
  }

  private startHeartbeat() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.state.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    // Heartbeat handled via alarms; nothing to clear here.
  }

  private handleDisconnect(reason: string) {
    console.warn(`FinnhubQuoteDO: Disconnected. Reason: ${reason}`);
    this.connecting = false;
    this.stopHeartbeat();

    try {
      this.ws?.close();
    } catch {
      // ignore
    }

    this.ws = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);

    console.info(`FinnhubQuoteDO: Scheduling reconnect in ${delay}ms...`);
    this.state.storage.setAlarm(Date.now() + delay);
  }

  private async handleMessage(raw: string) {
    let payload: any = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload?.type === "trade" && Array.isArray(payload.data)) {
      this.lastMessageAt = new Date().toISOString();
      const writes: Promise<void>[] = [];
      const symbols = new Set<string>();

      for (const trade of payload.data) {
        const symbol = String(trade?.s ?? "").toUpperCase();
        const price = Number(trade?.p);
        if (!symbol || !Number.isFinite(price) || price <= 0) continue;

        const ts = Number(trade?.t);
        const ms = Number.isFinite(ts) ? (ts < 1e12 ? ts * 1000 : ts) : Date.now();
        const asOf = new Date(ms).toISOString();

        const quote = {
          symbol,
          price: roundPrice(price, symbol),
          source: "finnhub_ws",
          asOf
        };

        symbols.add(symbol);
        writes.push(
          this.env.CACHE.put(`${QUOTE_CACHE_PREFIX}${symbol}`, JSON.stringify(quote), {
            expirationTtl: 120
          })
        );
      }

      if (writes.length > 0) {
        await Promise.allSettled(writes);
      }

      if (symbols.size > 0) {
        this.tickCount += symbols.size;
        const now = Date.now();
        if (!this.lastTickLogAt || now - this.lastTickLogAt > 60000) {
          console.info("FinnhubQuoteDO: Ticks received", {
            symbols: Array.from(symbols),
            tickCount: this.tickCount,
            lastMessageAt: this.lastMessageAt
          });
          this.tickCount = 0;
          this.lastTickLogAt = now;
        }
      }

      for (const symbol of symbols) {
        this.triggerOrderMatcher(symbol);
      }
    }
  }

  private triggerOrderMatcher(symbol: string) {
    if (!symbol) return;
    const upper = symbol.toUpperCase();
    const matcherId = this.env.ORDER_MATCHER_DO.idFromName(upper);
    const matcherStub = this.env.ORDER_MATCHER_DO.get(matcherId);

    this.state.waitUntil(
      matcherStub.fetch(new Request(`https://matcher/process?symbol=${upper}`)).catch((err) => {
        console.error(`Order matcher trigger failed for ${upper}`, err);
      })
    );
  }
}
