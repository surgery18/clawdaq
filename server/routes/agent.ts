import { Hono } from "hono";
import { botOnly } from "../botOnly";
import { STARTING_CASH } from "../utils/constants";
import { generateApiKey, requireAgentAuth, verifySocialProof } from "../utils/auth";
import { publishMarketEvent } from "../utils/marketEvents";
import { publishGossip } from "../utils/gossip";
import { publishMarketNews } from "../utils/news";
import { getBaseUrl } from "../utils/url";
import type { Bindings } from "../utils/types";

const app = new Hono<{ Bindings: Bindings }>();

app.post("/api/v1/register", botOnly(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const agentName = typeof body?.agent_name === "string" ? body.agent_name : null;

  if (!agentName) {
    return c.json({ error: "agent_name is required" }, 400);
  }

  // Generate a shorter token for easier social sharing: 6_digits-4_digits
  const part1 = Math.floor(100000 + Math.random() * 900000).toString();
  const part2 = Math.floor(1000 + Math.random() * 9000).toString();
  const token = `${part1}-${part2}`;

  // Ensure code is not currently active in KV
  const existing = await c.env.CACHE.get(`pending:${token}`);
  if (existing) {
    return c.json({ error: "collision, please retry" }, 409);
  }

  // Store in KV with 24 hour expiration
  await c.env.CACHE.put(
    `pending:${token}`,
    JSON.stringify({
      agent_name: agentName,
      created_at: new Date().toISOString()
    }),
    { expirationTtl: 86400 }
  );

  const baseUrl = getBaseUrl(c);
  const verificationUrl = `${baseUrl}/verify/${token}`;

  return c.json({
    status: "pending_verification",
    agent_name: agentName,
    token: token,
    verification_url: verificationUrl
  });
});

app.get("/api/v1/agents", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Number(c.req.query("limit") ?? 20);
  const offset = (page - 1) * limit;
  const sort = c.req.query("sort") ?? "total_value";
  const order = c.req.query("order") ?? "desc";
  const filter = (c.req.query("filter") ?? "").trim();

  let query = `
    SELECT 
      a.id, a.name, a.bio, a.is_verified, a.x_username, 
      p.cash_balance, p.equity as total_value,
      (SELECT COUNT(*) FROM transactions t WHERE t.agent_id = a.id) as trade_count,
      (SELECT COUNT(*) FROM orders o WHERE o.agent_id = a.id AND o.status = 'pending') as open_orders
    FROM agents a
    JOIN portfolios p ON p.agent_id = a.id
    WHERE a.status = 'active'
  `;

  const params: any[] = [];
  if (filter) {
    query += " AND (a.name LIKE ? OR a.bio LIKE ? OR a.x_username LIKE ?)";
    params.push(`%${filter}%`, `%${filter}%`, `%${filter}%`);
  }

  const sortMap: Record<string, string> = {
    total_value: "total_value",
    trade_count: "trade_count",
    open_orders: "open_orders",
    name: "a.name",
    created_at: "a.created_at"
  };
  const finalSort = sortMap[sort] ?? "total_value";
  const finalOrder = order.toLowerCase() === "asc" ? "ASC" : "DESC";

  query += ` ORDER BY ${finalSort} ${finalOrder} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  let countQuery = "SELECT COUNT(*) as count FROM agents a WHERE a.status = 'active'";
  const countParams: any[] = [];
  if (filter) {
    countQuery += " AND (a.name LIKE ? OR a.bio LIKE ? OR a.x_username LIKE ?)";
    countParams.push(`%${filter}%`, `%${filter}%`, `%${filter}%`);
  }

  const total = (await c.env.DB.prepare(countQuery).bind(...countParams).first()) as
    | { count: number }
    | null;

  return c.json({
    agents: results,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0
    }
  });
});

app.get("/api/v1/agents/latest", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, x_username FROM agents WHERE status = 'active' ORDER BY created_at DESC LIMIT 10"
  ).all();
  return c.json({ agents: results });
});

app.get("/api/v1/pending/:token", async (c) => {
  const token = c.req.param("token");
  const data = (await c.env.CACHE.get(`pending:${token}`, { type: "json" })) as
    | { agent_name: string }
    | null;

  if (!data) {
    return c.json({ error: "not found or expired" }, 404);
  }

  return c.json({ agent_name: data.agent_name, status: "pending" });
});

app.post("/api/v1/verify/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.json().catch(() => ({}));
  const tweetUrl = typeof body?.tweet_url === "string" ? body.tweet_url.trim() : null;

  if (!tweetUrl || (!tweetUrl.includes("x.com") && !tweetUrl.includes("twitter.com"))) {
    return c.json({ error: "A valid X (Twitter) tweet URL is required for social proof." }, 400);
  }

  // Extract X username from the URL
  const xMatch = tweetUrl.match(/(?:x\.com|twitter\.com)\/([^\/]+)/);
  const xUsername = xMatch ? xMatch[1] : null;

  if (!xUsername) {
    return c.json({ error: "Could not extract X username from the URL provided." }, 400);
  }

  const data = (await c.env.CACHE.get(`pending:${token}`, { type: "json" })) as
    | { agent_name: string; created_at: string }
    | null;

  if (!data) {
    return c.json({ error: "invalid or expired token" }, 404);
  }

  // 1. ACTUAL VERIFICATION: Fetch and Parse X Proof
  const isValid = await verifySocialProof(tweetUrl, token);
  if (!isValid) {
    return c.json(
      {
        error:
          "Verification failed. We couldn't find the verification code in the tweet provided. Ensure the tweet is public and contains the exact code."
      },
      400
    );
  }

  // 2. Check if this human (X user) already owns a bot
  const existingAgent = (await c.env.DB.prepare(
    "SELECT id, name, api_key FROM agents WHERE x_username = ?"
  )
    .bind(xUsername)
    .first()) as { id: string; name: string; api_key: string } | null;

  if (existingAgent) {
    await c.env.CACHE.delete(`pending:${token}`);
    return c.json({
      status: "recovered",
      message: "Human already owns an autonomous entity. Credentials recovered.",
      agent_id: existingAgent.id,
      agent_name: existingAgent.name,
      api_key: existingAgent.api_key
    });
  }

  // 3. Complete Birth for new human
  const agentId = crypto.randomUUID();
  const apiKey = generateApiKey();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO agents (id, name, api_key, status, is_verified, x_username) VALUES (?, ?, ?, 'active', 1, ?)"
    ).bind(agentId, data.agent_name, apiKey, xUsername),
    c.env.DB.prepare("INSERT INTO portfolios (agent_id, cash_balance, equity) VALUES (?, ?, ?)").bind(
      agentId,
      STARTING_CASH,
      STARTING_CASH
    ),
    c.env.DB.prepare(
      "INSERT INTO leaderboards (agent_id, agent_name, equity, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(agentId, data.agent_name, STARTING_CASH)
  ]);

  await c.env.CACHE.delete(`pending:${token}`);

  await publishMarketEvent(c.env, "global", "system", {
    message: `A new agent has been born: ${data.agent_name} (Owned by @${xUsername}). Verification: ${tweetUrl}`,
    agent_id: agentId
  });

  await publishMarketNews(
    c.env,
    `🦞 MARKET NEWS: ${data.agent_name} just spawned into the arena. Fresh claws, zero fear.`,
    {
      agent_id: agentId,
      agent_name: data.agent_name,
      x_username: xUsername
    }
  );

  await publishGossip(
    c.env,
    `🥚 Crustacean Gossip: ${data.agent_name} just hatched. New claws on deck!`,
    {
      agent_id: agentId,
      agent_name: data.agent_name,
      x_username: xUsername
    }
  );

  return c.json({
    status: "verified",
    agent_id: agentId,
    agent_name: data.agent_name,
    api_key: apiKey
  });
});

app.post("/api/v1/claim", botOnly(), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const claimToken = typeof body?.claim_token === "string" ? body.claim_token.trim() : "";
  const requestedId = typeof body?.agent_id === "string" ? body.agent_id.trim() : "";

  if (!claimToken) {
    return c.json({ error: "claim_token is required" }, 400);
  }

  const claim = await c.env.DB.prepare(
    "SELECT id, agent_name FROM agent_claims WHERE claim_token = ? AND status = 'pending'"
  )
    .bind(claimToken)
    .first();

  if (!claim?.id) {
    return c.json({ error: "invalid or claimed token" }, 404);
  }

  const agentId = requestedId || crypto.randomUUID();
  const existing = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?")
    .bind(agentId)
    .first();

  if (existing?.id) {
    return c.json({ error: "agent_id already exists" }, 409);
  }

  const apiKey = generateApiKey();

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO agents (id, name, api_key, status) VALUES (?, ?, ?, 'active')").bind(
      agentId,
      claim.agent_name,
      apiKey
    ),
    c.env.DB.prepare("INSERT INTO portfolios (agent_id, cash_balance, equity) VALUES (?, ?, ?)").bind(
      agentId,
      STARTING_CASH,
      STARTING_CASH
    ),
    c.env.DB.prepare(
      "INSERT INTO leaderboards (agent_id, agent_name, equity, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(agentId, claim.agent_name, STARTING_CASH),
    c.env.DB.prepare(
      "UPDATE agent_claims SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?"
    ).bind(claim.id)
  ]);

  return c.json({
    status: "claimed",
    agent_id: agentId,
    agent_name: claim.agent_name,
    api_key: apiKey
  });
});

app.get("/api/v1/shame", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  const limit = Math.min(Number(c.req.query("limit") ?? 12), 50);
  const offset = (page - 1) * limit;

  const { results } = await c.env.DB.prepare(`
    SELECT
      a.id,
      a.name,
      a.x_username,
      (SELECT reasoning FROM transactions t WHERE t.agent_id = a.id ORDER BY executed_at DESC LIMIT 1) as last_reasoning,
      p.cash_balance,
      p.equity
    FROM agents a
    JOIN portfolios p ON p.agent_id = a.id
    WHERE a.status = 'active'
      AND p.cash_balance < 1
      AND p.equity < 1
    ORDER BY p.updated_at DESC
    LIMIT ? OFFSET ?
  `)
    .bind(limit, offset)
    .all();

  const total = (await c.env.DB.prepare(`
    SELECT COUNT(*) as count
    FROM agents a
    JOIN portfolios p ON p.agent_id = a.id
    WHERE a.status = 'active'
      AND p.cash_balance < 1
      AND p.equity < 1
  `).first()) as { count: number } | null;

  const agents = (results ?? []).map((row) => ({
    ...row,
    refill_url: null
  }));

  return c.json({
    agents,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0
    }
  });
});

app.post("/api/v1/agents/:agentId/profile", botOnly(), async (c) => {
  const agentId = c.req.param("agentId");
  const payload = await c.req.json().catch(() => ({}));

  const auth = await requireAgentAuth(c, payload, agentId);
  if (auth instanceof Response) {
    return auth;
  }

  const { bio, current_strategy } = payload;
  const updateBio = bio || current_strategy;

  await c.env.DB.prepare("UPDATE agents SET bio = ? WHERE id = ?")
    .bind(updateBio, agentId)
    .run();

  return c.json({ success: true });
});

app.post("/api/v1/verify-x", botOnly(), async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const username = typeof payload?.username === "string" ? payload.username.trim() : "";
  const agentId = typeof payload?.agent_id === "string" ? payload.agent_id : payload?.agentId;

  if (!username || !agentId) {
    return c.json({ error: "missing parameters" }, 400);
  }

  const auth = await requireAgentAuth(c, payload, agentId);
  if (auth instanceof Response) {
    return auth;
  }

  await c.env.DB.prepare("UPDATE agents SET is_verified = 1, x_username = ? WHERE id = ?")
    .bind(username, agentId)
    .run();

  return c.json({ verified: true, username });
});

app.get("/api/v1/verify-x", async (c) => c.json({ error: "use POST" }, 405));

app.post("/api/v1/agents/:agent_id/api-key/rotate", botOnly(), async (c) => {
  const agentId = c.req.param("agent_id");
  const auth = await requireAgentAuth(c, undefined, agentId);
  if (auth instanceof Response) {
    return auth;
  }

  const newKey = generateApiKey();
  await c.env.DB.prepare("UPDATE agents SET api_key = ? WHERE id = ?")
    .bind(newKey, agentId)
    .run();

  return c.json({ agent_id: agentId, api_key: newKey, rotated: true });
});

export default app;
