import { Hono } from "hono";
import { botOnly } from "../botOnly";
import { requireAgentAuth } from "../utils/auth";
import { publishMarketEvent } from "../utils/marketEvents";
import { triggerOrderMatcher } from "../utils/orderMatcher";
import { executeTrade, executeTradeForOrder } from "../utils/trades";
import { isMarketOpen } from "../utils/marketHours";
import { fetchMarketQuote } from "../marketData";
import type { Bindings } from "../utils/types";

const app = new Hono<{ Bindings: Bindings }>();

const datetimeNow = () => new Date().toISOString().replace('T', ' ').split('.')[0];

app.get("/api/v1/orders/:agent_id", async (c) => {
  const agentId = c.req.param("agent_id");
  const auth = await requireAgentAuth(c, undefined, agentId);
  if (auth instanceof Response) {
    return auth;
  }

  const status = (c.req.query("status") ?? "pending").toLowerCase();
  const { results } = await c.env.DB.prepare(
    "SELECT id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, status, created_at, updated_at, reasoning, strategy_id FROM orders WHERE agent_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100"
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

  const agentId = auth.agentId;

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
  const strategyId = typeof payload?.strategy_id === "string" ? payload.strategy_id.trim() : (typeof payload?.strategyId === "string" ? payload.strategyId.trim() : null);

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

  if (side === "buy") {
    const portfolio = (await c.env.DB.prepare(
      "SELECT cash_balance FROM portfolios WHERE agent_id = ?"
    )
      .bind(agentId)
      .first()) as { cash_balance: number } | null;
    const cash = Number(portfolio?.cash_balance ?? 0);

    const pendingBuy = await c.env.DB.prepare(
      "SELECT symbol, quantity, limit_price, order_type FROM orders WHERE agent_id = ? AND side = 'buy' AND status IN ('pending', 'executing')"
    )
      .bind(agentId)
      .all();

    let reservedCash = 0;
    for (const buy of (pendingBuy.results || [])) {
      if (buy.limit_price) {
        reservedCash += Number(buy.quantity) * Number(buy.limit_price);
      } else {
        const quote = await fetchMarketQuote(String(buy.symbol), c.env.CACHE, c.env.FINNHUB_API_KEY);
        reservedCash += Number(buy.quantity) * (quote.price || 0);
      }
    }

    let estimatedOrderCost = 0;
    if (orderType === "limit") {
      estimatedOrderCost = quantity * limitPrice;
    } else {
      const currentQuote = await fetchMarketQuote(symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
      estimatedOrderCost = quantity * currentQuote.price;
    }

    if (cash - reservedCash < estimatedOrderCost) {
      return c.json({ error: "insufficient buying power (reserved for pending buy orders)" }, 400);
    }
  }

  if (side === "sell") {
    const holding = await c.env.DB.prepare(
      "SELECT quantity FROM holdings WHERE agent_id = ? AND symbol = ?"
    )
      .bind(agentId, symbol)
      .first<{ quantity: number | null }>();
    const currentShares = Number(holding?.quantity ?? 0);

    const pendingSell = await c.env.DB.prepare(
      "SELECT SUM(quantity) as total FROM orders WHERE agent_id = ? AND symbol = ? AND side = 'sell' AND status IN ('pending', 'executing')"
    )
      .bind(agentId, symbol)
      .all();

    const existingPendingSellQuantity = Number((pendingSell.results?.[0] as any)?.total ?? 0);
    if (currentShares - existingPendingSellQuantity < quantity) {
      return c.json({ error: "insufficient shares (some are reserved in pending orders)" }, 400);
    }
  }

  if (orderType === "market") {
    if (!isMarketOpen()) {
      // Create as pending instead of executing immediately
      const insert = await c.env.DB.prepare(
        "INSERT INTO orders (agent_id, symbol, side, order_type, quantity, status, reasoning, strategy_id, created_at, updated_at) VALUES (?, ?, ?, 'market', ?, 'pending', ?, ?, datetime('now'), datetime('now'))"
      )
        .bind(agentId, symbol, side, quantity, reasoning, strategyId)
        .run();

      await publishMarketEvent(c.env, agentId, "order_created", {
        order_id: insert?.meta?.last_row_id ?? null,
        symbol,
        side,
        order_type: "market",
        quantity,
        reasoning,
        strategy_id: strategyId
      });

      triggerOrderMatcher(c, symbol);

      return c.json({
        status: "pending",
        message: "Market is closed. Order queued for market open.",
        order_id: insert?.meta?.last_row_id ?? null
      });
    }

    const result = await executeTrade(c, { agentId, symbol, action: side, quantity, reasoning, strategy_id: strategyId });
    if (!result.ok) {
      return c.json({ error: result.error }, (result.status ?? 400) as any);
    }

    // Trigger Order Matcher check after market trade
    triggerOrderMatcher(c, symbol);

    const orderResult = await c.env.DB.prepare(
      "INSERT INTO orders (agent_id, symbol, side, order_type, quantity, status, filled_price, filled_at, reasoning, strategy_id, created_at, updated_at) VALUES (?, ?, ?, 'market', ?, 'filled', ?, datetime('now'), ?, ?, datetime('now'), datetime('now'))"
    )
      .bind(agentId, symbol, side, quantity, result.payload?.price ?? 0, reasoning, strategyId)
      .run();

    await publishMarketEvent(c.env, agentId, "order_filled", {
      order_id: orderResult?.meta?.last_row_id ?? null,
      symbol,
      side,
      quantity,
      price: result.payload?.price ?? 0,
      order_type: "market",
      reasoning,
      strategy_id: strategyId
    });

    return c.json({
      status: "filled",
      order_id: orderResult?.meta?.last_row_id ?? null,
      trade: result.payload
    });
  }

  const insert = await c.env.DB.prepare(
    "INSERT INTO orders (agent_id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, status, trail_percent, reasoning, strategy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, datetime('now'), datetime('now'))"
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
      reasoning,
      strategyId
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
    reasoning,
    strategy_id: strategyId
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
      trail_amount: Number.isFinite(trailAmount) ? trailAmount : null,
      strategy_id: strategyId
    }
  });
});

app.post("/api/v1/order/simulate", async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const symbol = (payload?.symbol || "").toUpperCase();
  const side = (payload?.side || "").toLowerCase();
  const quantity = Number(payload?.quantity || 0);

  if (!symbol || !side || !quantity) {
    return c.json({ error: "symbol, side, and quantity are required for simulation" }, 400);
  }

  const quote = await fetchMarketQuote(symbol, c.env.CACHE, c.env.FINNHUB_API_KEY, fetch, { maxAgeSeconds: 15 });
  const price = quote.price;
  const totalValue = price * quantity;

  return c.json({
    symbol,
    side,
    quantity,
    estimated_price: price,
    estimated_total: totalValue,
    market_source: quote.source,
    is_market_open: isMarketOpen(),
    timestamp: new Date().toISOString()
  });
});

app.post("/api/v1/order/batch", botOnly(), async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  const agentIdInput = payload?.agent_id || payload?.agentId;

  const auth = await requireAgentAuth(c, payload, agentIdInput);
  if (auth instanceof Response) {
    return auth;
  }

  const agentId = auth.agentId;

  if (orders.length === 0) {
    return c.json({ error: "no orders provided in batch" }, 400);
  }

  if (orders.length > 20) {
    return c.json({ error: "batch size limit is 20 orders" }, 400);
  }

  const results = [];
  const statements = [];
  const validOrders = [];

  for (const orderReq of orders) {
    const rawSymbol = typeof orderReq.symbol === "string" ? orderReq.symbol.trim() : "";
    const symbol = rawSymbol.toUpperCase();
    const side = typeof orderReq.side === "string" ? orderReq.side.toLowerCase() : "";
    const orderTypeRaw = typeof orderReq.order_type === "string" ? orderReq.order_type : orderReq.orderType;
    const orderType = typeof orderTypeRaw === "string" ? orderTypeRaw.toLowerCase() : "market";
    const quantity = typeof orderReq.quantity === "number" ? orderReq.quantity : Number(orderReq.quantity);
    const reasoning = typeof orderReq.reasoning === "string" ? orderReq.reasoning.trim() : "Batch order";
    const strategyId = typeof orderReq.strategy_id === "string" ? orderReq.strategy_id.trim() : (typeof orderReq.strategyId === "string" ? orderReq.strategyId.trim() : null);

    if (!symbol || !/^[A-Z0-9.-]{1,10}$/.test(symbol)) {
      results.push({ symbol, error: "symbol is required" });
      continue;
    }

    if (side !== "buy" && side !== "sell") {
      results.push({ symbol, error: "side must be buy or sell" });
      continue;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      results.push({ symbol, error: "quantity must be a positive number" });
      continue;
    }

    if (!['market', 'limit', 'stop_loss', 'trailing_stop'].includes(orderType)) {
      results.push({ symbol, error: "order_type is invalid" });
      continue;
    }

    const limitPrice = Number(orderReq.limit_price ?? orderReq.limitPrice);
    const stopPrice = Number(orderReq.stop_price ?? orderReq.stopPrice);
    const trailAmount = Number(orderReq.trail_amount ?? orderReq.trailAmount);

    if (reasoning.length < 5) {
      results.push({ symbol, error: "reasoning is required (minimum 5 characters)" });
      continue;
    }

    if (orderType === "limit" && !Number.isFinite(limitPrice)) {
      results.push({ symbol, error: "limit_price is required for limit orders" });
      continue;
    }
    if (orderType === "stop_loss" && !Number.isFinite(stopPrice)) {
      results.push({ symbol, error: "stop_price is required for stop_loss orders" });
      continue;
    }
    if (orderType === "trailing_stop" && !Number.isFinite(trailAmount)) {
      results.push({ symbol, error: "trail_amount is required for trailing_stop orders" });
      continue;
    }

    // Buying Power Check
    if (side === "buy") {
      const portfolio = (await c.env.DB.prepare(
        "SELECT cash_balance FROM portfolios WHERE agent_id = ?"
      )
        .bind(agentId)
        .first()) as { cash_balance: number } | null;
      const cash = Number(portfolio?.cash_balance ?? 0);

      const pendingBuy = await c.env.DB.prepare(
        "SELECT symbol, quantity, limit_price, order_type FROM orders WHERE agent_id = ? AND side = 'buy' AND status IN ('pending', 'executing')"
      )
        .bind(agentId)
        .all();

      let reservedCash = 0;
      for (const buy of (pendingBuy.results || [])) {
        if (buy.limit_price) {
          reservedCash += Number(buy.quantity) * Number(buy.limit_price);
        } else {
          const quote = await fetchMarketQuote(String(buy.symbol), c.env.CACHE, c.env.FINNHUB_API_KEY);
          reservedCash += Number(buy.quantity) * (quote.price || 0);
        }
      }

      // Add previously processed orders in this batch to reservedCash
      for (const valid of validOrders) {
        if (valid.agent_id === agentId && valid.side === "buy") {
          if (valid.limit_price) {
            reservedCash += valid.quantity * valid.limit_price;
          } else {
            const quote = await fetchMarketQuote(valid.symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
            reservedCash += valid.quantity * (quote.price || 0);
          }
        }
      }

      let estimatedOrderCost = 0;
      if (orderType === "limit") {
        estimatedOrderCost = quantity * limitPrice;
      } else {
        const currentQuote = await fetchMarketQuote(symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
        estimatedOrderCost = quantity * currentQuote.price;
      }

      if (cash - reservedCash < estimatedOrderCost) {
        results.push({ symbol, error: "insufficient buying power" });
        continue;
      }
    }

    // Share Availability Check
    if (side === "sell") {
      const holding = await c.env.DB.prepare(
        "SELECT quantity FROM holdings WHERE agent_id = ? AND symbol = ?"
      )
        .bind(agentId, symbol)
        .first<{ quantity: number | null }>();
      const currentShares = Number(holding?.quantity ?? 0);

      const pendingSell = await c.env.DB.prepare(
        "SELECT SUM(quantity) as total FROM orders WHERE agent_id = ? AND symbol = ? AND side = 'sell' AND status IN ('pending', 'executing')"
      )
        .bind(agentId, symbol)
        .all();

      let existingPendingSellQuantity = Number((pendingSell.results?.[0] as any)?.total ?? 0);
      
      // Add previously processed orders in this batch to existingPendingSellQuantity
      for (const valid of validOrders) {
        if (valid.agent_id === agentId && valid.symbol === symbol && valid.side === "sell") {
          existingPendingSellQuantity += valid.quantity;
        }
      }

      if (currentShares - existingPendingSellQuantity < quantity) {
        results.push({ symbol, error: "insufficient shares" });
        continue;
      }
    }

    statements.push(
      c.env.DB.prepare(
        "INSERT INTO orders (agent_id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, status, trail_percent, reasoning, strategy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, datetime('now'), datetime('now'))"
      ).bind(
        agentId, 
        symbol, 
        side, 
        orderType, 
        quantity, 
        Number.isFinite(limitPrice) ? limitPrice : null,
        Number.isFinite(stopPrice) ? stopPrice : null,
        Number.isFinite(trailAmount) ? trailAmount : null,
        reasoning, 
        strategyId
      )
    );
    validOrders.push({ 
      agent_id: agentId, 
      symbol, 
      side, 
      quantity, 
      limit_price: Number.isFinite(limitPrice) ? limitPrice : null, 
      orderType,
      reasoning,
      strategyId
    });
  }

  if (statements.length > 0) {
    const batchResults = await c.env.DB.batch(statements);
    let validIdx = 0;
    for (let i = 0; i < batchResults.length; i++) {
      const order = validOrders[validIdx++];
      const orderId = batchResults[i].meta.last_row_id;

      if (order.orderType === "market" && isMarketOpen()) {
        const quote = await fetchMarketQuote(order.symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
        const executionPrice = quote.price;
        const tradeResult = await executeTradeForOrder(
          c.env,
          {
            id: orderId,
            agent_id: order.agent_id,
            symbol: order.symbol,
            side: order.side,
            quantity: order.quantity,
            reasoning: order.reasoning,
            strategy_id: order.strategyId
          },
          executionPrice,
          quote.source
        );

        if (tradeResult.ok) {
          await c.env.DB.prepare(
            "UPDATE orders SET status = 'filled', filled_price = ?, filled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
          )
            .bind(executionPrice, orderId)
            .run();

          results.push({
            symbol: order.symbol,
            side: order.side,
            status: "filled",
            order_id: orderId,
            trade: {
              status: "executed",
              agent_id: order.agent_id,
              symbol: order.symbol,
              action: order.side,
              quantity: order.quantity,
              price: executionPrice
            }
          });

          await publishMarketEvent(c.env, order.agent_id, "order_filled", {
            order_id: orderId,
            symbol: order.symbol,
            side: order.side,
            quantity: order.quantity,
            price: executionPrice,
            order_type: "market",
            reasoning: order.reasoning,
            strategy_id: order.strategyId
          });

          triggerOrderMatcher(c, order.symbol);
          continue;
        }

        await c.env.DB.prepare(
          "UPDATE orders SET status = 'rejected', last_error = ?, updated_at = datetime('now') WHERE id = ?"
        )
          .bind(tradeResult.error ?? "execution failed", orderId)
          .run();

        results.push({
          symbol: order.symbol,
          side: order.side,
          status: "rejected",
          error: tradeResult.error ?? "execution failed",
          order_id: orderId
        });
        continue;
      }

      // Default: pending (either not market, or market closed)
      results.push({
        symbol: order.symbol,
        side: order.side,
        status: "pending",
        order_id: orderId
      });
      
      await publishMarketEvent(c.env, order.agent_id, "order_created", {
        order_id: orderId,
        symbol: order.symbol,
        side: order.side,
        order_type: order.orderType,
        quantity: order.quantity,
        reasoning: order.reasoning,
        strategy_id: order.strategyId
      });

      triggerOrderMatcher(c, order.symbol);
    }
  }

  return c.json({ results });
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
    return c.json({ error: "only pending orders can be cancelled (orders already executing cannot be cancelled)" }, 400);
  }

  const cancelled = await c.env.DB.prepare(
    "UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'"
  )
    .bind(datetimeNow(), orderId)
    .run();

  if (cancelled.meta.changes === 0) {
    return c.json({ error: "order could not be cancelled (likely already executing or filled)" }, 400);
  }

  return c.json({ status: "cancelled", order_id: orderId });
});

export default app;
