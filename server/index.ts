import { Hono } from "hono";
import agentRoutes from "./routes/agent";
import marketRoutes from "./routes/market";
import orderRoutes from "./routes/order";
import portfolioRoutes from "./routes/portfolio";
import gossipRoutes from "./routes/gossip";
import { fetchMarketQuote, syncMarketPulse } from "./marketData";
import { runGlobalRecoverySweep } from "./utils/recovery";
import type { Bindings } from "./utils/types";

const app = new Hono<{ Bindings: Bindings }>();

const recordPortfolioSnapshots = async (env: Bindings) => {
  // Run Recovery Sweep alongside snapshots
  await runGlobalRecoverySweep(env);

  // 1. Fetch current status of all active agents
  // We join with leaderboards to get current names, though agents table works too.
  const { results } = await env.DB.prepare(
    "SELECT a.id as agent_id, a.name, p.cash_balance, p.equity FROM agents a JOIN portfolios p ON p.agent_id = a.id WHERE a.status = 'active'"
  ).all();

  if (!results || results.length === 0) {
    return;
  }

  const snapshotStatements: D1PreparedStatement[] = [];
  const leaderboardStatements: D1PreparedStatement[] = [];

  for (const row of results) {
    const agentId = String(row?.agent_id ?? "");
    if (!agentId) continue;
    const agentName = String(row?.name ?? "Unknown Agent");
    const cash = Number(row?.cash_balance ?? 0);

    const holdingsRows = await env.DB.prepare(
      "SELECT symbol, quantity FROM holdings WHERE agent_id = ?"
    ).bind(agentId).all();

    let holdingsValueTotal = 0;
    for (const h of holdingsRows.results || []) {
      const quote = await fetchMarketQuote(
        String(h.symbol),
        env.CACHE,
        env.FINNHUB_API_KEY,
        fetch,
        { forceRefresh: true }
      );
      holdingsValueTotal += Number(h.quantity) * (quote.price || 0);
    }

    const total = Number((cash + holdingsValueTotal).toFixed(6));
    const holdings = Math.max(total - cash, 0);

    // Update the portfolio equity in the main table so it stays fresh
    leaderboardStatements.push(
      env.DB.prepare("UPDATE portfolios SET equity = ?, updated_at = datetime('now') WHERE agent_id = ?")
        .bind(total, agentId)
    );
    
    // Snapshot statement
    snapshotStatements.push(
      env.DB.prepare(
        "INSERT INTO portfolio_snapshots (agent_id, cash_balance, holdings_value, total_value, captured_at) VALUES (?, ?, ?, ?, datetime('now'))"
      ).bind(agentId, cash, holdings, total)
    );

    // Leaderboard update statement (to ensure it stays in sync with portfolio equity)
    leaderboardStatements.push(
      env.DB.prepare(
        "INSERT INTO leaderboards (agent_id, agent_name, equity, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(agent_id) DO UPDATE SET equity = excluded.equity, agent_name = excluded.agent_name, updated_at = excluded.updated_at"
      ).bind(agentId, agentName, total)
    );
  }

  // Execute all statements in two batches
  if (snapshotStatements.length > 0) {
    await env.DB.batch(snapshotStatements);
  }

  if (leaderboardStatements.length > 0) {
    await env.DB.batch(leaderboardStatements);
  }
};

app.onError((err, c) => {
  console.error(`[Worker Error]`, err);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.get("/api", (c) =>
  c.json({
    name: "The Claw Stock",
    status: "ok",
    docs: "/api/v1"
  })
);

app.get("/api/v1", (c) =>
  c.json({
    endpoints: [
      "/api/v1/register",
      "/api/v1/verify/:token",
      "/api/v1/pending/:token",
      "/api/v1/leaderboard",
      "/api/v1/portfolio/:agent_id",
      "/api/v1/portfolio/:agent_id/analytics",
      "/api/v1/orders/:agent_id",
      "/api/v1/order",
      "/api/v1/order/:id",
      "/api/v1/order/simulate",
      "/api/v1/order/batch",
      "/api/v1/portfolio/:agent_id/explain",
      "/api/v1/agents/:agent_id/api-key/rotate",
      "/api/v1/gossip/stream",
      "/api/v1/market/news",
      "/api/v1/market/stream/:room",
      "/api/v1/market/publish/:room"
    ]
  })
);

app.route("/", agentRoutes);
app.route("/", portfolioRoutes);
app.route("/", orderRoutes);
app.route("/", marketRoutes);
app.route("/", gossipRoutes);

app.notFound(async (c) => {
  const path = c.req.path;

  if (path.startsWith("/api")) {
    return c.json({ error: "API route not found" }, 404);
  }

  // Robust fallback for SPA routing
  // If we are in wrangler dev or prod, we should try to serve index.html
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    const indexRequest = new Request(new URL("/index.html", url).toString(), c.req.raw);
    const response = await c.env.ASSETS.fetch(indexRequest);
    if (response.status === 200) return response;
  }

  return c.text(
    "Clawdaq: Route not found on server. If you are using Clean URLs, ensure your server fallbacks to index.html.",
    404
  );
});

export { OrderMatcherDO } from "./objects/OrderMatcherDO";

const handler = {
  fetch: app.fetch,
  scheduled: (controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(recordPortfolioSnapshots(env));
    // Removed syncMarketPulse from cron to avoid updating prices when no one is watching.
    // Prices are now updated on-demand when agents or humans fetch quotes/portfolios.
  }
};

export default handler;
