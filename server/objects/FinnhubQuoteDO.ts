import type { Bindings } from "../utils/types";

const WATCHLIST = ["RUM", "TIRX", "AITX", "FAT", "DJT", "AAPL", "TSLA"];
const QUOTE_CACHE_PREFIX = "quote:v1:";
const WS_BASE_URL = "wss://ws.finnhub.io?token=";
const MAX_BACKOFF_MS = 30000;
const INITIAL_BACKOFF_MS = 1000;
const HEARTBEAT_MS = 15000;

const roundPrice = (value: number) => Math.max(0.01, Math.round(value * 100) / 100);

export class FinnhubQuoteDO {
  private state: DurableObjectState;
  private env: Bindings;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
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
          lastConnectAt: this.lastConnectAt
        }),
        {
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }

    return new Response("Not found", { status: 404 });
  }

  private async ensureConnection() {
    if (!this.env.FINNHUB_API_KEY) {
      return { ok: false, error: "missing FINNHUB_API_KEY" };
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return { ok: true, connected: true };
    }

    if (this.connecting) {
      return { ok: true, connecting: true };
    }

    await this.connect();
    return { ok: true, connecting: true };
  }

  private async connect() {
    if (!this.env.FINNHUB_API_KEY) return;

    this.connecting = true;
    this.lastConnectAt = new Date().toISOString();

    const ws = new WebSocket(`${WS_BASE_URL}${this.env.FINNHUB_API_KEY}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.connecting = false;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.tickCount = 0;
      this.lastTickLogAt = Date.now();
      console.info("FinnhubQuoteDO connected; subscribing to symbols.");
      this.subscribeAll();
      this.startHeartbeat();
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      this.handleDisconnect("close");
    });

    ws.addEventListener("error", () => {
      this.handleDisconnect("error");
    });
  }

  private subscribeAll() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const symbol of WATCHLIST) {
      this.ws.send(JSON.stringify({ type: "subscribe", symbol }));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    if (!this.ws) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, HEARTBEAT_MS) as unknown as number;
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleDisconnect(reason: string) {
    console.warn(`FinnhubQuoteDO disconnected (${reason}).`);
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
    if (this.reconnectTimer !== null) return;

    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnection();
    }, delay) as unknown as number;
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
          price: roundPrice(price),
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
          console.info("FinnhubQuoteDO ticks received", {
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
