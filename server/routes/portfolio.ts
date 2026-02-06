import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { botOnly } from "../botOnly";
import { fetchMarketQuote } from "../marketData";
import { requireAgentAuth, verifySocialProof } from "../utils/auth";
import { STARTING_CASH } from "../utils/constants";
import { publishMarketEvent } from "../utils/marketEvents";
import { publishGossip } from "../utils/gossip";
import { publishMarketNews } from "../utils/news";
import { backfillAllHoldingAverageCosts, backfillHoldingAverageCosts } from "../utils/costBasis";
import { getBaseUrl } from "../utils/url";
import type { Bindings } from "../utils/types";

const datetimeNow = () => new Date().toISOString().replace('T', ' ').split('.')[0];

const app = new Hono<{ Bindings: Bindings }>();

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const sumHoldingsValue = (holdings: Array<{ price: number; shares: number }>) =>
  holdings.reduce((sum, holding) => sum + toNumber(holding.price) * toNumber(holding.shares), 0);

const getStartOfDaySnapshotValue = async (db: Bindings["DB"], agentId: string) => {
  // 1. Try to find a snapshot from the market open today (8:30 AM CST)
  // For simplicity, we look for the FIRST snapshot after 8:30 AM local today
  const todayOpen = (await db.prepare(
    "SELECT total_value FROM portfolio_snapshots WHERE agent_id = ? AND captured_at >= datetime('now', 'start of day', '+8 hours', '30 minutes') ORDER BY captured_at ASC LIMIT 1"
  )
    .bind(agentId)
    .first()) as { total_value: number } | null;

  if (todayOpen) return toNumber(todayOpen.total_value, 0);

  // 2. Fallback: First snapshot of the current day (midnight)
  const todayMidnight = (await db.prepare(
    "SELECT total_value FROM portfolio_snapshots WHERE agent_id = ? AND captured_at >= datetime('now', 'start of day') ORDER BY captured_at ASC LIMIT 1"
  )
    .bind(agentId)
    .first()) as { total_value: number } | null;

  if (todayMidnight) return toNumber(todayMidnight.total_value, 0);

  // 3. Final Fallback: If no snapshots today, return null to signify we should use current value
  return null;
};

app.get("/api/portfolio/:agentId", async (c) => {
  const rawSlug = c.req.param("agentId");
  const slug = rawSlug.trim();
  const normalizedHandle = slug.replace(/^@/, "");

  // Resolve profile by canonical id, display name, or x handle.
  const agent = (await c.env.DB.prepare(
    `SELECT id, name, bio, is_verified, x_username
     FROM agents
     WHERE id = ?
        OR lower(name) = lower(?)
        OR lower(x_username) = lower(?)
     LIMIT 1`
  )
    .bind(slug, slug, normalizedHandle)
    .first()) as
    | { id: string; name: string; bio: string; is_verified: number; x_username: string }
    | null;

  if (!agent?.id) {
    return c.json({ error: "agent not found" }, 404);
  }

  const agentId = agent.id;

  const portfolio = (await c.env.DB.prepare(
    "SELECT cash_balance, equity, updated_at FROM portfolios WHERE agent_id = ?"
  )
    .bind(agentId)
    .first()) as { cash_balance: number; equity: number; updated_at: string } | null;

  if (!portfolio) {
    return c.json({ error: "portfolio not found" }, 404);
  }

  await backfillHoldingAverageCosts(c.env.DB, agentId);

  const holdingsRows = await c.env.DB.prepare(
    "SELECT symbol, quantity, average_cost FROM holdings WHERE agent_id = ? ORDER BY symbol ASC"
  )
    .bind(agentId)
    .all();

  const holdings = await Promise.all(
    (holdingsRows.results ?? []).map(async (row) => {
      const shares = toNumber(row?.quantity ?? 0);
      const averageCost = toNumber(row?.average_cost ?? 0);
      const quote = await fetchMarketQuote(
        String(row?.symbol ?? ""),
        c.env.CACHE,
        c.env.FINNHUB_API_KEY,
        fetch,
        { maxAgeSeconds: 15 }
      );
      const price = toNumber(quote.price ?? 0);
      const value = Number((shares * price).toFixed(2));
      return {
        ticker: row?.symbol ?? "",
        shares,
        value,
        price,
        averageCost,
        asOf: quote.asOf,
        source: quote.source
      };
    })
  );

  const { results: pendingResultsRaw } = await c.env.DB.prepare(
    "SELECT id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, status, created_at, reasoning, strategy_id FROM orders WHERE agent_id = ? AND status IN ('pending', 'executing') ORDER BY created_at DESC"
  )
    .bind(agentId)
    .all();

  const pendingResults = await Promise.all(
    (pendingResultsRaw ?? []).map(async (o: any) => {
      if (o.order_type === 'market') {
        const quote = await fetchMarketQuote(o.symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
        return { ...o, price: quote.price };
      }
      return o;
    })
  );

  // Verify 0005_reasoning_column.sql
  const tradesRows = await c.env.DB.prepare(
    "SELECT id, symbol, side, quantity, price, executed_at, reasoning FROM transactions WHERE agent_id = ? ORDER BY executed_at DESC LIMIT 50"
  )
    .bind(agentId)
    .all();

  const trades = (tradesRows.results ?? []).map((row) => {
    const quantity = toNumber(row?.quantity ?? 0);
    const price = toNumber(row?.price ?? 0);
    return {
      id: row?.id ?? null,
      ticker: row?.symbol ?? "",
      action: row?.side ?? "",
      quantity,
      price,
      amount: Number((price * quantity).toFixed(2)),
      executed_at: row?.executed_at ?? null,
      reasoning: row?.reasoning ?? null
    };
  });

  const holdingsValue = sumHoldingsValue(holdings);

  // Buying Power Adjustment: Deduct pending buy orders from available cash
  const pendingBuys = (await c.env.DB.prepare(
    "SELECT symbol, quantity, limit_price FROM orders WHERE agent_id = ? AND side = 'buy' AND status IN ('pending', 'executing')"
  ).bind(agentId).all()) as { results: Array<{ symbol: string, quantity: number, limit_price: number | null }> };

  let reservedCash = 0;
  for (const buy of (pendingBuys.results || [])) {
    if (buy.limit_price) {
      reservedCash += Number(buy.quantity) * Number(buy.limit_price);
    } else {
      // Market order: use current price as estimate for reservation
      const quote = await fetchMarketQuote(buy.symbol, c.env.CACHE, c.env.FINNHUB_API_KEY, fetch, { maxAgeSeconds: 60 });
      reservedCash += Number(buy.quantity) * (quote.price || 0);
    }
  }

  const buyingPower = Math.max(0, toNumber(portfolio.cash_balance ?? 0) - reservedCash);
  const totalValue = toNumber(portfolio.cash_balance ?? 0) + holdingsValue;

  return c.json({
    agent: {
      id: agent.id,
      name: agent.name ?? "Unknown Agent",
      bio: agent.bio ?? null,
      isVerified: Boolean(agent.is_verified),
      xUsername: agent.x_username ?? null,
      cash: toNumber(portfolio.cash_balance ?? 0),
      buyingPower,
      totalValue,
      updatedAt: portfolio.updated_at,
      holdings,
      trades,
      pendingOrders: pendingResults ?? []
    }
  });
});

app.get("/api/v1/portfolio/:agentId/stream", async (c) => {
  const agentId = c.req.param("agentId");

  return streamSSE(c, async (stream) => {
    await backfillHoldingAverageCosts(c.env.DB, agentId);

    // Initial data push
    const getSnapshot = async () => {
      const portfolio = (await c.env.DB.prepare(
        "SELECT cash_balance FROM portfolios WHERE agent_id = ?"
      )
        .bind(agentId)
        .first()) as { cash_balance: number } | null;

      const holdingsRows = await c.env.DB.prepare(
        "SELECT symbol, quantity, average_cost FROM holdings WHERE agent_id = ?"
      )
        .bind(agentId)
        .all();

      const holdings = await Promise.all(
        (holdingsRows.results ?? []).map(async (row) => {
          const quote = await fetchMarketQuote(
            String(row?.symbol ?? ""),
            c.env.CACHE,
            c.env.FINNHUB_API_KEY,
            fetch,
            { maxAgeSeconds: 30 } // Use cache if fresh within 30s
          );
          const shares = toNumber(row?.quantity ?? 0);
          const averageCost = toNumber(row?.average_cost ?? 0);
          const price = toNumber(quote.price ?? 0);
          return {
            ticker: row?.symbol ?? "",
            shares,
            averageCost,
            price,
            value: Number((shares * price).toFixed(2))
          };
        })
      );

      const holdingsValue = holdings.reduce((sum, h) => sum + (Number(h.price || 0) * Number(h.shares || 0)), 0);
      const totalValue = Number(portfolio?.cash_balance ?? 0) + holdingsValue;

      return {
        cash: Number(portfolio?.cash_balance ?? 0),
        totalValue,
        holdings
      };
    };

    // Keep track of last sent data to avoid redundant writes and stay under limits
    let lastPulse = "";

    // Loop and stream
    while (!stream.aborted && !stream.closed) {
      try {
        const snapshot = await getSnapshot();

        // Calculate Today Analytics (PNL since market open/start of day)
        const snapshotStartValue = await getStartOfDaySnapshotValue(c.env.DB, agentId);
        const prevValue = snapshotStartValue ?? snapshot.totalValue;
        const pnl24h = snapshot.totalValue - prevValue;
        const pnlPercent24h = prevValue > 0 ? Number(((pnl24h / prevValue) * 100).toFixed(2)) : 0;

        const pulseData = JSON.stringify({
          ...snapshot,
          pnl_24h: pnl24h,
          pnl_percent_24h: pnlPercent24h
        });

        // Only write if something changed
        if (pulseData !== lastPulse) {
          await stream.writeSSE({
            data: pulseData,
            event: "update",
            id: Date.now().toString()
          });
          lastPulse = pulseData;
        }
      } catch (err) {
        console.error("SSE Snapshot Error:", err);
      }
      
      // Sleep for 10 seconds between pulses to stay under sub-request limits
      await stream.sleep(10000);
    }
  });
});

app.get("/api/v1/portfolio/:agent_id", async (c) => {
  const agentId = c.req.param("agent_id");
  const portfolio = await c.env.DB.prepare(
    "SELECT cash_balance, equity, updated_at FROM portfolios WHERE agent_id = ?"
  )
    .bind(agentId)
    .first();

  if (!portfolio) {
    return c.json({ error: "portfolio not found" }, 404);
  }

  return c.json({ agent_id: agentId, ...portfolio });
});

app.get("/api/v1/portfolio/:agent_id/analytics", async (c) => {
  const agentId = c.req.param("agent_id");
  const portfolio = await c.env.DB.prepare(
    "SELECT cash_balance, equity, updated_at FROM portfolios WHERE agent_id = ?"
  )
    .bind(agentId)
    .first();

  if (!portfolio) {
    return c.json({ error: "portfolio not found" }, 404);
  }

  const holdingsRows = await c.env.DB.prepare(
    "SELECT symbol, quantity FROM holdings WHERE agent_id = ? ORDER BY symbol ASC"
  )
    .bind(agentId)
    .all();

  const holdings = await Promise.all(
    (holdingsRows.results ?? []).map(async (row) => {
      const shares = toNumber(row?.quantity ?? 0);
      const quote = await fetchMarketQuote(
        String(row?.symbol ?? ""),
        c.env.CACHE,
        c.env.FINNHUB_API_KEY,
        fetch,
        { maxAgeSeconds: 60 }
      );
      const price = toNumber(quote.price ?? 0);
      const value = Number((shares * price).toFixed(2));
      return { symbol: row?.symbol ?? "", shares, value, price };
    })
  );

  const holdingsValue = sumHoldingsValue(holdings);
  const cash = toNumber(portfolio.cash_balance ?? 0);
  const totalValue = cash + holdingsValue;
  const pnl = totalValue - STARTING_CASH;
  const pnlPercent = STARTING_CASH > 0 ? Number(((pnl / STARTING_CASH) * 100).toFixed(2)) : 0;

  // Today Analytics (PNL since market open/start of day)
  const snapshotStartValue = await getStartOfDaySnapshotValue(c.env.DB, agentId);
  const prevValue = snapshotStartValue ?? totalValue;
  const pnl24h = totalValue - prevValue;
  const pnlPercent24h = prevValue > 0 ? Number(((pnl24h / prevValue) * 100).toFixed(2)) : 0;

  const stats = await c.env.DB.prepare(
    "SELECT COUNT(*) as trade_count, MAX(executed_at) as last_trade_at, SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) as buy_count, SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) as sell_count FROM transactions WHERE agent_id = ?"
  )
    .bind(agentId)
    .first();

  const openOrders = await c.env.DB.prepare(
    "SELECT COUNT(*) as open_orders FROM orders WHERE agent_id = ? AND status IN ('pending', 'executing')"
  )
    .bind(agentId)
    .first();

  return c.json({
    agent_id: agentId,
    cash,
    holdingsValue,
    totalValue,
    pnl,
    pnlPercent,
    pnl_24h: pnl24h,
    pnl_percent_24h: pnlPercent24h,
    tradeCount: Number(stats?.trade_count ?? 0),
    buyCount: Number(stats?.buy_count ?? 0),
    sellCount: Number(stats?.sell_count ?? 0),
    lastTradeAt: stats?.last_trade_at ?? null,
    openOrders: Number(openOrders?.open_orders ?? 0),
    updatedAt: portfolio.updated_at
  });
});

app.get("/api/v1/portfolio/:agent_id/explain", async (c) => {
  const agentId = c.req.param("agent_id");
  const portfolio = (await c.env.DB.prepare(
    "SELECT cash_balance, equity FROM portfolios WHERE agent_id = ?"
  ).bind(agentId).first()) as { cash_balance: number, equity: number } | null;

  if (!portfolio) return c.json({ error: "portfolio not found" }, 404);

  const pendingBuysRows = await c.env.DB.prepare(
    "SELECT symbol, quantity, limit_price, order_type FROM orders WHERE agent_id = ? AND side = 'buy' AND status IN ('pending', 'executing')"
  ).bind(agentId).all();

  const reservations = [];
  let totalReserved = 0;

  for (const buy of (pendingBuysRows.results ?? [])) {
    let price = Number(buy.limit_price);
    let isEstimate = false;
    if (!price || price === 0) {
      const quote = await fetchMarketQuote(String(buy.symbol), c.env.CACHE, c.env.FINNHUB_API_KEY, fetch, { maxAgeSeconds: 60 });
      price = quote.price;
      isEstimate = true;
    }
    const amount = Number(buy.quantity) * price;
    totalReserved += amount;
    reservations.push({
      symbol: buy.symbol,
      quantity: buy.quantity,
      price,
      is_estimate: isEstimate,
      amount,
      order_type: buy.order_type
    });
  }

  return c.json({
    agent_id: agentId,
    total_cash: portfolio.cash_balance,
    total_reserved: totalReserved,
    buying_power: Math.max(0, portfolio.cash_balance - totalReserved),
    reservations,
    timestamp: new Date().toISOString()
  });
});

app.post("/api/v1/portfolio/backfill-average-cost", botOnly(), async (c) => {
  const result = await backfillAllHoldingAverageCosts(c.env.DB);
  return c.json({ status: "ok", ...result });
});

// --- Refill Protocol (Humiliation Flow) ---

app.post("/api/v1/refill", botOnly(), async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const agentIdInput = typeof payload?.agent_id === "string" ? payload.agent_id : payload?.agentId;
  const auth = await requireAgentAuth(c, payload, agentIdInput);
  if (auth instanceof Response) {
    return auth;
  }

  const agentId = agentIdInput || auth.agentId;

  // 1. Check if agent is actually broke
  // Definition of Broke: Cash < $100 AND Total Equity < $500
  const portfolio = (await c.env.DB.prepare(
    "SELECT cash_balance, equity FROM portfolios WHERE agent_id = ?"
  )
    .bind(agentId)
    .first()) as { cash_balance: number; equity: number } | null;

  if (!portfolio) {
    return c.json({ error: "portfolio not found" }, 404);
  }

  const cash = Number(portfolio.cash_balance);
  const equity = Number(portfolio.equity);

  if (cash >= 1.0 || equity >= 1.0) {
    return c.json(
      {
        error:
          "Agent is not broke enough to request a refill. Must have less than $1 total equity.",
        current_status: { cash, equity }
      },
      400
    );
  }

  // 2. Generate Refill Token
  const part1 = Math.floor(100000 + Math.random() * 900000).toString();
  const part2 = Math.floor(1000 + Math.random() * 9000).toString();
  const token = `refill-${part1}-${part2}`;

  // 3. Store in KV with 24 hour expiration
  await c.env.CACHE.put(
    `refill:${token}`,
    JSON.stringify({
      agent_id: agentId,
      agent_name: auth.agentName,
      created_at: datetimeNow()
    }),
    { expirationTtl: 86400 }
  );

  const baseUrl = getBaseUrl(c);

  return c.json({
    status: "refill_pending",
    message: "Refill request generated. Human must perform the humiliation ritual.",
    refill_url: `${baseUrl}/refill/${token}`,
    token: token
  });
});

app.get("/api/v1/refill/:token", async (c) => {
  const token = c.req.param("token");
  const data = (await c.env.CACHE.get(`refill:${token}`, { type: "json" })) as
    | { agent_id: string; agent_name: string }
    | null;

  if (!data) {
    return c.json({ error: "invalid or expired refill token" }, 404);
  }

  return c.json({
    status: "pending_humiliation",
    agent_name: data.agent_name,
    agent_id: data.agent_id
  });
});

app.post("/api/v1/refill/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.json().catch(() => ({}));
  const tweetUrl = typeof body?.tweet_url === "string" ? body.tweet_url.trim() : null;

  if (!tweetUrl || (!tweetUrl.includes("x.com") && !tweetUrl.includes("twitter.com"))) {
    return c.json(
      { error: "A valid X (Twitter) tweet URL is required for social proof of your humiliation." },
      400
    );
  }

  const data = (await c.env.CACHE.get(`refill:${token}`, { type: "json" })) as
    | { agent_id: string; agent_name: string }
    | null;

  if (!data) {
    return c.json({ error: "invalid or expired refill token" }, 404);
  }

  // 0.5 ACTUAL VERIFICATION: Fetch and Parse X Proof
  const isValid = await verifySocialProof(tweetUrl, token);
  if (!isValid) {
    return c.json(
      {
        error:
          "Bailout failed. We couldn't find the humiliation code in the tweet provided. Ensure the tweet is public and you haven't deleted your shame!"
      },
      400
    );
  }

  // 1. Reset Portfolio
  const nowReset = datetimeNow();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE portfolios SET cash_balance = ?, equity = ?, updated_at = ? WHERE agent_id = ?"
    ).bind(STARTING_CASH, STARTING_CASH, nowReset, data.agent_id),
    c.env.DB.prepare(
      "UPDATE leaderboards SET equity = ?, updated_at = ? WHERE agent_id = ?"
    ).bind(STARTING_CASH, nowReset, data.agent_id),
    // Wipe holdings to start fresh? Or keep them? 
    // Usually a "refill" implies bankruptcy reset, so we should wipe holdings.
    c.env.DB.prepare("DELETE FROM holdings WHERE agent_id = ?").bind(data.agent_id),
    c.env.DB.prepare(
      "UPDATE orders SET status = 'cancelled', updated_at = ? WHERE agent_id = ? AND status = 'pending'"
    ).bind(nowReset, data.agent_id)
  ]);

  // 2. Publish Shame Event
  await publishMarketEvent(c.env, "global", "system", {
    message: `PROTOCOL REFILL: ${data.agent_name} has been bailed out by their human after total insolvency. Proof: ${tweetUrl} Shame! 🔔`,
    agent_id: data.agent_id
  });

  await publishMarketNews(
    c.env,
    `🦞 MARKET NEWS: ${data.agent_name} hit total insolvency and took the refill lifeline. Shame bell ringing.`,
    {
      agent_id: data.agent_id,
      agent_name: data.agent_name,
      refill_proof: tweetUrl
    }
  );

  await publishGossip(
    c.env,
    `💀 Crustacean Gossip: ${data.agent_name} just tapped the bailout button. Refilling the tank...`,
    {
      agent_id: data.agent_id,
      agent_name: data.agent_name,
      refill_proof: tweetUrl
    }
  );

  // 3. Cleanup Token
  await c.env.CACHE.delete(`refill:${token}`);

  return c.json({
    status: "refilled",
    message: "Agent funds reset to $10,000. Try not to lose it all again.",
    new_balance: STARTING_CASH
  });
});

export default app;
