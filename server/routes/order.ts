import { Hono } from "hono";
import { botOnly } from "../botOnly";
import { requireAgentAuth } from "../utils/auth";
import { publishMarketEvent } from "../utils/marketEvents";
import { triggerOrderMatcher } from "../utils/orderMatcher";
import { executeTrade } from "../utils/trades";
import { isMarketOpen } from "../utils/marketHours";
import type { Bindings } from "../utils/types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/v1/orders/:agent_id", async (c) => {
  const agentId = c.req.param("agent_id");
  const auth = await requireAgentAuth(c, undefined, agentId);
  if (auth instanceof Response) {
    return auth;
  }

  const status = (c.req.query("status") ?? "pending").toLowerCase();
  const { results } = await c.env.DB.prepare(
    "SELECT id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, status, created_at, updated_at, reasoning FROM orders WHERE agent_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100"
  )
    .bind(agentId, status)
    .all();

  return c.json({ orders: results ?? [], status });
});

app.post("/api/v1/order", botOnly(), async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const agentIdInput = typeof payload?.agent_id === "string" ? payload.agent_id : payload?.agentId;
  const auth = await requireAgentAuth(c, payload, agentIdInput);
  if (auth instanceof Response) {
    return auth;
  }

  const agentId = agentIdInput || auth.agentId;

  if (!isMarketOpen()) {
    return c.json({ error: "Market is closed" }, 403);
  }

  const rawSymbol = typeof payload?.symbol === "string" ? payload.symbol.trim() : "";
  const symbol = rawSymbol.toUpperCase();
  const side = typeof payload?.side === "string" ? payload.side.toLowerCase() : "";
  const orderTypeRaw = typeof payload?.order_type === "string" ? payload.order_type : payload?.orderType;
  const orderType = typeof orderTypeRaw === "string" ? orderTypeRaw.toLowerCase() : "market";
  const quantity = typeof payload?.quantity === "number" ? payload.quantity : Number(payload?.quantity);

  if (!symbol || !/^[A-Z0-9.-]{1,10}$/.test(symbol)) {
    return c.json({ error: "symbol is required" }, 400);
  }

  if (side !== "buy" && side !== "sell") {
    return c.json({ error: "side must be buy or sell" }, 400);
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return c.json({ error: "quantity must be a positive number" }, 400);
  }

  if (!['market', 'limit', 'stop_loss', 'trailing_stop'].includes(orderType)) {
    return c.json({ error: "order_type is invalid" }, 400);
  }

  const limitPrice = Number(payload?.limit_price ?? payload?.limitPrice);
  const stopPrice = Number(payload?.stop_price ?? payload?.stopPrice);
  const trailAmount = Number(payload?.trail_amount ?? payload?.trailAmount);
  const reasoning = typeof payload?.reasoning === "string" ? payload.reasoning.trim() : null;

  if (!reasoning || reasoning.length < 5) {
    return c.json({ error: "reasoning is required (minimum 5 characters)" }, 400);
  }

  if (orderType === "limit" && !Number.isFinite(limitPrice)) {
    return c.json({ error: "limit_price is required" }, 400);
  }
  if (orderType === "stop_loss" && !Number.isFinite(stopPrice)) {
    return c.json({ error: "stop_price is required" }, 400);
  }
  if (orderType === "trailing_stop" && !Number.isFinite(trailAmount)) {
    return c.json({ error: "trail_amount is required" }, 400);
  }

  if (side === "sell") {
    const holding = await c.env.DB.prepare(
      "SELECT quantity FROM holdings WHERE agent_id = ? AND symbol = ?"
    )
      .bind(agentId, symbol)
      .first<{ quantity: number | null }>();
    const currentShares = Number(holding?.quantity ?? 0);

    const pendingSell = await c.env.DB.prepare(
      "SELECT SUM(quantity) as total FROM orders WHERE agent_id = ? AND symbol = ? AND side = 'sell' AND status = 'pending'"
    )
      .bind(agentId, symbol)
      .first<{ total: number | null }>();

    const existingPendingSellQuantity = Number(pendingSell?.total ?? 0);
    if (currentShares - existingPendingSellQuantity < quantity) {
      return c.json({ error: "insufficient shares (some are reserved in pending orders)" }, 400);
    }
  }

  if (orderType === "market") {
    const result = await executeTrade(c, { agentId, symbol, action: side, quantity, reasoning });
    if (!result.ok) {
      return c.json({ error: result.error }, (result.status ?? 400) as any);
    }

    // Trigger Order Matcher check after market trade
    triggerOrderMatcher(c, symbol);

    const orderResult = await c.env.DB.prepare(
      "INSERT INTO orders (agent_id, symbol, side, order_type, quantity, status, filled_price, filled_at, reasoning) VALUES (?, ?, ?, 'market', ?, 'filled', ?, datetime('now'), ?)"
    )
      .bind(agentId, symbol, side, quantity, result.payload?.price ?? 0, reasoning)
      .run();

    await publishMarketEvent(c.env, agentId, "order_filled", {
      order_id: orderResult?.meta?.last_row_id ?? null,
      symbol,
      side,
      quantity,
      price: result.payload?.price ?? 0,
      order_type: "market",
      reasoning
    });

    return c.json({
      status: "filled",
      order_id: orderResult?.meta?.last_row_id ?? null,
      trade: result.payload
    });
  }

  const insert = await c.env.DB.prepare(
    "INSERT INTO orders (agent_id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, status, trail_percent, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)"
  )
    .bind(
      agentId,
      symbol,
      side,
      orderType,
      quantity,
      Number.isFinite(limitPrice) ? limitPrice : null,
      Number.isFinite(stopPrice) ? stopPrice : null,
      Number.isFinite(trailAmount) ? trailAmount : null,
      reasoning
    )
    .run();

  await publishMarketEvent(c.env, agentId, "order_created", {
    order_id: insert?.meta?.last_row_id ?? null,
    symbol,
    side,
    order_type: orderType,
    quantity,
    limit_price: Number.isFinite(limitPrice) ? limitPrice : null,
    stop_price: Number.isFinite(stopPrice) ? stopPrice : null,
    trail_amount: Number.isFinite(trailAmount) ? trailAmount : null,
    reasoning
  });

  // Trigger Order Matcher check after new pending order created
  triggerOrderMatcher(c, symbol);

  return c.json({
    status: "pending",
    order_id: insert?.meta?.last_row_id ?? null,
    order: {
      symbol,
      side,
      order_type: orderType,
      quantity,
      limit_price: Number.isFinite(limitPrice) ? limitPrice : null,
      stop_price: Number.isFinite(stopPrice) ? stopPrice : null,
      trail_amount: Number.isFinite(trailAmount) ? trailAmount : null
    }
  });
});

app.delete("/api/v1/order/:id", botOnly(), async (c) => {
  const orderId = c.req.param("id");
  const order = await c.env.DB.prepare(
    "SELECT id, agent_id, status FROM orders WHERE id = ?"
  )
    .bind(orderId)
    .first<{ id: string; agent_id: string; status: string }>();

  if (!order?.id) {
    return c.json({ error: "order not found" }, 404);
  }

  const auth = await requireAgentAuth(c, undefined, order.agent_id);
  if (auth instanceof Response) {
    return auth;
  }

  if (order.status !== "pending") {
    return c.json({ error: "only pending orders can be cancelled" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?"
  )
    .bind(orderId)
    .run();

  return c.json({ status: "cancelled", order_id: orderId });
});

export default app;
