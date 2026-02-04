import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { fetchMarketQuote } from "../marketData";
import { STARTING_CASH } from "../utils/constants";
import { getMarketHistory, publishMarketEvent, registerMarketStream, safeJson } from "../utils/marketEvents";
import { NEWS_ROOM } from "../utils/news";
import { triggerOrderMatcher } from "../utils/orderMatcher";
import type { Bindings, MarketEvent } from "../utils/types";
import { botOnly } from "../botOnly";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/leaderboard", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT l.agent_id, l.agent_name, l.equity AS total_value, p.cash_balance, l.updated_at FROM leaderboards l LEFT JOIN portfolios p ON p.agent_id = l.agent_id ORDER BY l.equity DESC LIMIT 100"
  ).all();

  const leaderboard = (results ?? []).map((row, index) => {
    const totalValue = Number(row?.total_value ?? row?.equity ?? 0);
    const cash = Number(row?.cash_balance ?? 0);
    const holdingsValue = Math.max(totalValue - cash, 0);
    const pnl = totalValue - STARTING_CASH;
    const returnPct = Number(((pnl / STARTING_CASH) * 100).toFixed(2));
    return {
      id: row?.agent_id ?? "",
      name: row?.agent_name ?? "Unknown",
      cash,
      holdingsValue,
      totalValue,
      pnl,
      returnPct,
      rank: index + 1,
      updatedAt: (row as any)?.updated_at ?? null
    };
  });

  let updatedAt = null;
  for (const row of leaderboard) {
    if (!row.updatedAt) continue;
    if (!updatedAt || new Date(row.updatedAt) > new Date(updatedAt)) {
      updatedAt = row.updatedAt;
    }
  }

  return c.json({ leaderboard, updated_at: updatedAt });
});

app.get("/api/v1/leaderboard", async (c) => {
  const cacheKey = "leaderboard:v1";
  const cached = await c.env.CACHE.get(cacheKey, { type: "json" });

  if (cached) {
    return c.json({ leaderboard: cached, cached: true });
  }

  // Only show agents who have actually traded OR have holdings
  const { results } = await c.env.DB.prepare(`
    SELECT agent_id, agent_name, equity 
    FROM leaderboards 
    WHERE agent_id IN (
      SELECT DISTINCT agent_id FROM transactions
      UNION
      SELECT DISTINCT agent_id FROM holdings
    )
    ORDER BY equity DESC 
    LIMIT 100
  `).all();

  const leaderboard = results ?? [];
  await c.env.CACHE.put(cacheKey, JSON.stringify(leaderboard), { expirationTtl: 60 });

  return c.json({ leaderboard });
});

app.get("/api/market/quote/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const quote = await fetchMarketQuote(symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
  return c.json(quote);
});

app.get("/api/v1/market/quote/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const quote = await fetchMarketQuote(symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
  return c.json(quote);
});

app.get("/api/v1/market/status/finnhub", async (c) => {
  return c.json({ error: "Finnhub WebSocket DO has been decommissioned." }, 410);
});

app.get("/api/v1/market/news", async (c) => {
  return streamSSE(c, async (stream) => {
    registerMarketStream(NEWS_ROOM, stream);

    const connectedEvent: MarketEvent = {
      type: "system",
      room: NEWS_ROOM,
      payload: { message: "news_connected" },
      created_at: new Date().toISOString()
    };

    await stream.writeSSE({
      event: connectedEvent.type,
      data: JSON.stringify(connectedEvent)
    });

    const history = await getMarketHistory(c.env, NEWS_ROOM, 50);
    if (history.length > 0) {
      const historyEvent: MarketEvent = {
        type: "history",
        room: NEWS_ROOM,
        payload: {
          events: history.map(({ event, id }) => ({ ...event, id }))
        },
        created_at: new Date().toISOString()
      };

      await stream.writeSSE({
        event: historyEvent.type,
        data: JSON.stringify(historyEvent)
      });
    }

    let lastSeenId =
      history.length > 0
        ? history[history.length - 1].id
        : Number(
            (await c.env.DB.prepare("SELECT id FROM system_events ORDER BY id DESC LIMIT 1").first())
              ?.id ?? 0
          );

    while (!stream.aborted && !stream.closed) {
      const { results } = await c.env.DB.prepare(
        "SELECT id, payload FROM system_events WHERE id > ? ORDER BY id ASC LIMIT 100"
      )
        .bind(lastSeenId)
        .all();

      if (!results || results.length === 0) {
        await stream.sleep(2000);
        continue;
      }

      for (const row of results) {
        lastSeenId = Number(row?.id ?? lastSeenId);
        const parsed = typeof row?.payload === "string" ? safeJson(row.payload) : row?.payload;
        if (!parsed || parsed.room !== NEWS_ROOM || parsed.type !== "news") {
          continue;
        }

        const eventPayload = { ...parsed, id: lastSeenId };

        await stream.writeSSE({
          event: parsed.type,
          data: JSON.stringify(eventPayload),
          id: String(lastSeenId)
        });
      }
    }
  });
});

app.get("/api/v1/market/stream/:room", async (c) => {
  const room = c.req.param("room") || "global";

  return streamSSE(c, async (stream) => {
    registerMarketStream(room, stream);

    const connectedEvent: MarketEvent = {
      type: "system",
      room,
      payload: { message: "connected" },
      created_at: new Date().toISOString()
    };

    await stream.writeSSE({
      event: connectedEvent.type,
      data: JSON.stringify(connectedEvent)
    });

    const history = await getMarketHistory(c.env, room, 50);
    if (history.length > 0) {
      const historyEvent: MarketEvent = {
        type: "history",
        room,
        payload: {
          events: history.map(({ event, id }) => ({ ...event, id }))
        },
        created_at: new Date().toISOString()
      };

      await stream.writeSSE({
        event: historyEvent.type,
        data: JSON.stringify(historyEvent)
      });
    }

    let lastSeenId =
      history.length > 0
        ? history[history.length - 1].id
        : Number(
            (await c.env.DB.prepare("SELECT id FROM system_events ORDER BY id DESC LIMIT 1").first())?.id ??
              0
          );

    while (!stream.aborted && !stream.closed) {
      const { results } = await c.env.DB.prepare(
        "SELECT id, payload FROM system_events WHERE id > ? ORDER BY id ASC LIMIT 100"
      )
        .bind(lastSeenId)
        .all();

      if (!results || results.length === 0) {
        await stream.sleep(2000);
        continue;
      }

      for (const row of results) {
        lastSeenId = Number(row?.id ?? lastSeenId);
        const parsed = typeof row?.payload === "string" ? safeJson(row.payload) : row?.payload;
        if (!parsed || parsed.room !== room) {
          continue;
        }

        const eventPayload = { ...parsed, id: lastSeenId };

        await stream.writeSSE({
          event: parsed.type,
          data: JSON.stringify(eventPayload),
          id: String(lastSeenId)
        });
      }
    }
  });
});

app.post("/api/v1/market/publish/:room", botOnly(), async (c) => {
  const room = c.req.param("room") || "global";
  const payload = await c.req.json().catch(() => ({}));
  const rawType = typeof payload?.type === "string" ? payload.type : "system";
  const eventPayload =
    typeof payload?.payload === "object" && payload.payload ? payload.payload : (payload ?? {});

  const { event } = await publishMarketEvent(
    c.env,
    room,
    rawType,
    eventPayload as Record<string, unknown>
  );

  return c.json({ ok: true, event });
});

export default app;
