import { Hono } from "hono";
import agentRoutes from "./routes/agent";
import marketRoutes from "./routes/market";
import orderRoutes from "./routes/order";
import portfolioRoutes from "./routes/portfolio";
import gossipRoutes from "./routes/gossip";
import { runGlobalRecoverySweep } from "./utils/recovery";
import type { Bindings } from "./utils/types";

const app = new Hono<{ Bindings: Bindings }>();

const recordPortfolioSnapshots = async (env: Bindings) => {
  // Run Recovery Sweep alongside snapshots
  await runGlobalRecoverySweep(env);

  const { results } = await env.DB.prepare(
    "SELECT a.id as agent_id, p.cash_balance, p.equity FROM agents a JOIN portfolios p ON p.agent_id = a.id WHERE a.status = 'active'"
  ).all();

  if (!results || results.length === 0) {
    return;
  }

  const statements: D1PreparedStatement[] = [];

  for (const row of results) {
    const agentId = String(row?.agent_id ?? "");
    if (!agentId) continue;
    const cash = Number(row?.cash_balance ?? 0);
    const total = Number(row?.equity ?? 0);
    const holdings = Math.max(total - cash, 0);
    statements.push(
      env.DB.prepare(
        "INSERT INTO portfolio_snapshots (agent_id, cash_balance, holdings_value, total_value) VALUES (?, ?, ?, ?)"
      ).bind(agentId, cash, holdings, total)
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
};

app.onError((err, c) => {
  console.error(`[Worker Error] ${err}`);
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
export { FinnhubQuoteDO } from "./objects/FinnhubQuoteDO";

const handler = {
  fetch: app.fetch,
  scheduled: (controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(recordPortfolioSnapshots(env));
  }
};

export default handler;
