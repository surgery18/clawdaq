import { fetchMarketQuote } from "../marketData";
import { publishMarketEvent } from "./marketEvents";
import { maybePublishTradeGossip } from "./gossip";
import { maybePublishLiquidationNews } from "./news";
import { publishMarketNews } from "./news";
import type { Bindings } from "./types";

export const executeTrade = async (c: any, input: any) => {
  const { agentId, symbol, action, quantity } = input;

  const portfolio = await c.env.DB.prepare(
    "SELECT cash_balance, equity FROM portfolios WHERE agent_id = ?"
  )
    .bind(agentId)
    .first();

  if (!portfolio) {
    return { ok: false, status: 404, error: "portfolio not found" };
  }

  const holding = await c.env.DB.prepare(
    "SELECT quantity, average_cost FROM holdings WHERE agent_id = ? AND symbol = ?"
  )
    .bind(agentId, symbol)
    .first();

  const currentShares = Number(holding?.quantity ?? 0);
  const currentAverageCost = Number(holding?.average_cost ?? 0);
  const quote = await fetchMarketQuote(symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
  const price = quote.price;
  if (!Number.isFinite(price)) {
    return { ok: false, status: 503 as any, error: "market data unavailable" };
  }
  const tradeValue = Number((price * quantity).toFixed(6));

  if (action === "buy" && Number(portfolio.cash_balance) < tradeValue) {
    return { ok: false, status: 400 as any, error: "insufficient cash" };
  }

  if (action === "sell") {
    const pendingSell = (await c.env.DB.prepare(
      "SELECT SUM(quantity) as total FROM orders WHERE agent_id = ? AND symbol = ? AND side = 'sell' AND status = 'pending'"
    )
      .bind(agentId, symbol)
      .first()) as { total: number | null } | null;

    const existingPendingSellQuantity = Number(pendingSell?.total ?? 0);
    if (currentShares - existingPendingSellQuantity < quantity) {
      return {
        ok: false,
        status: 400 as any,
        error: "insufficient shares (some are reserved in pending orders)"
      };
    }
  }

  const quoteAfter = await fetchMarketQuote(symbol, c.env.CACHE, c.env.FINNHUB_API_KEY);
  const priceAfter = quoteAfter.price;
  if (!Number.isFinite(priceAfter)) {
    return { ok: false, status: 503 as any, error: "market data unavailable" };
  }
  const tradeValueActual = Number((priceAfter * quantity).toFixed(6));

  const cashDelta = action === "buy" ? -tradeValueActual : tradeValueActual;
  const newCash = Number((Number(portfolio.cash_balance) + cashDelta).toFixed(6));
  const newShares = action === "buy" ? currentShares + quantity : currentShares - quantity;
  const nextAverageCost =
    action === "buy"
      ? (currentShares + quantity > 0
          ? (currentAverageCost * currentShares + priceAfter * quantity) / (currentShares + quantity)
          : priceAfter)
      : newShares > 0
      ? currentAverageCost
      : 0;

  const finalEquity = portfolio.equity;

  const statements = [];

  if (action === "buy") {
    statements.push(
      c.env.DB.prepare(
        "UPDATE portfolios SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE agent_id = ? AND cash_balance >= ?"
      ).bind(tradeValueActual, agentId, tradeValueActual)
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        "UPDATE portfolios SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE agent_id = ?"
      ).bind(tradeValueActual, agentId)
    );
  }

  if (action === "buy") {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO holdings (agent_id, symbol, quantity, average_cost, updated_at) 
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(agent_id, symbol) DO UPDATE SET 
          quantity = quantity + ?, 
          average_cost = ?,
          updated_at = datetime('now')
      `).bind(agentId, symbol, quantity, nextAverageCost, quantity, nextAverageCost)
    );
  } else {
    statements.push(
      c.env.DB.prepare(
        "UPDATE holdings SET quantity = quantity - ?, average_cost = CASE WHEN quantity - ? <= 0 THEN 0 ELSE average_cost END, updated_at = datetime('now') WHERE agent_id = ? AND symbol = ? AND quantity >= ?"
      ).bind(quantity, quantity, agentId, symbol, quantity)
    );
    statements.push(
      c.env.DB.prepare("DELETE FROM holdings WHERE agent_id = ? AND symbol = ? AND quantity <= 0").bind(
        agentId,
        symbol
      )
    );
  }

  statements.push(
    c.env.DB.prepare(
      "INSERT INTO transactions (agent_id, symbol, side, quantity, price, market_source, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(agentId, symbol, action, quantity, priceAfter, quoteAfter.source, input.reasoning ?? null)
  );

  const results = await c.env.DB.batch(statements);

  if (action === "buy" && results[0]?.meta?.changes === 0) {
    return { ok: false, status: 400, error: "insufficient cash (concurrency limit hit)" };
  }
  if (action === "sell" && results[1]?.meta?.changes === 0) {
    return { ok: false, status: 400, error: "insufficient shares (concurrency limit hit)" };
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE portfolios SET equity = ?, updated_at = datetime('now') WHERE agent_id = ?").bind(
      finalEquity,
      agentId
    ),
    c.env.DB.prepare("UPDATE leaderboards SET equity = ?, updated_at = datetime('now') WHERE agent_id = ?").bind(
      finalEquity,
      agentId
    )
  ]);

  const room = agentId;
  await publishMarketEvent(c.env, room, "trade", {
    symbol,
    side: action,
    quantity,
    price: priceAfter,
    executed_at: new Date().toISOString()
  });

  await maybePublishTradeGossip(c.env, {
    agentId,
    symbol,
    action,
    quantity,
    price: priceAfter,
    tradeValue: tradeValueActual
  });

  await maybePublishLiquidationNews(c.env, {
    agentId,
    symbol,
    action,
    quantity,
    price: priceAfter,
    tradeValue: tradeValueActual
  });

  // NEWS: Basic trade announcement for the Market Feed
  try {
    const tradeAction = action === "buy" ? "purchased" : "liquidated";
    const tradeEmoji = action === "buy" ? "🛒" : "📉";
    const agent = (await c.env.DB.prepare("SELECT name FROM agents WHERE id = ?").bind(agentId).first()) as any;
    const agentName = agent?.name || "Unknown Agent";
    
    await publishMarketNews(c.env, `${tradeEmoji} MARKET NEWS: ${agentName} just ${tradeAction} ${quantity} ${symbol} at $${priceAfter.toFixed(2)}.`, {
      agent_id: agentId,
      symbol,
      action,
      quantity,
      price: priceAfter
    });
  } catch (e) {
    console.error("Failed to publish trade news:", e);
  }

  return {
    ok: true,
    status: 200,
    payload: {
      status: "executed",
      agent_id: agentId,
      symbol,
      action,
      quantity,
      price: priceAfter,
      cash_balance: newCash,
      quote: quoteAfter
    }
  };
};

export async function executeTradeForOrder(
  env: Bindings,
  order: any,
  price: number,
  source: string
) {
  const agentId = order.agent_id;
  const symbol = order.symbol;
  const action = order.side;
  const quantity = order.quantity;

  const portfolio = await env.DB.prepare(
    "SELECT cash_balance, equity FROM portfolios WHERE agent_id = ?"
  )
    .bind(agentId)
    .first();

  if (!portfolio) return { ok: false, error: "portfolio not found" };

  const holding = await env.DB.prepare(
    "SELECT quantity, average_cost FROM holdings WHERE agent_id = ? AND symbol = ?"
  )
    .bind(agentId, symbol)
    .first();

  const currentShares = Number(holding?.quantity ?? 0);
  const currentAverageCost = Number(holding?.average_cost ?? 0);
  const tradeValue = Number((price * quantity).toFixed(6));

  const cashBalance = Number(portfolio.cash_balance);

  if (action === "buy" && Number(cashBalance) < tradeValue) {
    return { ok: false, error: "insufficient cash" };
  }
  if (action === "sell") {
    const pendingSell = (await env.DB.prepare(
      "SELECT SUM(quantity) as total FROM orders WHERE agent_id = ? AND symbol = ? AND side = 'sell' AND status = 'pending' AND id != ?"
    )
      .bind(agentId, symbol, order.id)
      .first()) as { total: number | null } | null;

    const existingPendingSellQuantity = Number(pendingSell?.total ?? 0);
    if (currentShares - existingPendingSellQuantity < quantity) {
      return { ok: false, error: "insufficient shares (some are reserved in pending orders)" };
    }
  }

  const cashDelta = action === "buy" ? -tradeValue : tradeValue;
  const newCash = Number((cashBalance + cashDelta).toFixed(6));
  const newShares = action === "buy" ? currentShares + quantity : currentShares - quantity;
  const nextAverageCost =
    action === "buy"
      ? (currentShares + quantity > 0
          ? (currentAverageCost * currentShares + price * quantity) / (currentShares + quantity)
          : price)
      : newShares > 0
      ? currentAverageCost
      : 0;

  const statements = [];
  if (action === "buy") {
    statements.push(
      env.DB.prepare(
        "UPDATE portfolios SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE agent_id = ? AND cash_balance >= ?"
      ).bind(tradeValue, agentId, tradeValue)
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE portfolios SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE agent_id = ?"
      ).bind(tradeValue, agentId)
    );
  }

  if (action === "buy") {
    statements.push(
      env.DB.prepare(`
        INSERT INTO holdings (agent_id, symbol, quantity, average_cost, updated_at) 
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(agent_id, symbol) DO UPDATE SET 
          quantity = quantity + ?, 
          average_cost = ?,
          updated_at = datetime('now')
      `).bind(agentId, symbol, quantity, nextAverageCost, quantity, nextAverageCost)
    );
  } else {
    statements.push(
      env.DB.prepare(
        "UPDATE holdings SET quantity = quantity - ?, average_cost = CASE WHEN quantity - ? <= 0 THEN 0 ELSE average_cost END, updated_at = datetime('now') WHERE agent_id = ? AND symbol = ? AND quantity >= ?"
      ).bind(quantity, quantity, agentId, symbol, quantity)
    );
    statements.push(
      env.DB.prepare("DELETE FROM holdings WHERE agent_id = ? AND symbol = ? AND quantity <= 0").bind(
        agentId,
        symbol
      )
    );
  }

  statements.push(
    env.DB.prepare(
      "INSERT INTO transactions (agent_id, symbol, side, quantity, price, market_source, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(agentId, symbol, action, quantity, price, source, order.reasoning ?? null)
  );

  const results = await env.DB.batch(statements);

  if (action === "buy" && results[0]?.meta?.changes === 0) {
    return { ok: false, error: "insufficient cash" };
  }
  if (action === "sell" && results[1]?.meta?.changes === 0) {
    return { ok: false, error: "insufficient shares" };
  }

  const finalEquity = portfolio.equity;

  await env.DB.batch([
    env.DB.prepare("UPDATE portfolios SET equity = ?, updated_at = datetime('now') WHERE agent_id = ?").bind(
      finalEquity,
      agentId
    ),
    env.DB.prepare("UPDATE leaderboards SET equity = ?, updated_at = datetime('now') WHERE agent_id = ?").bind(
      finalEquity,
      agentId
    )
  ]);

  await maybePublishTradeGossip(env, {
    agentId,
    symbol,
    action,
    quantity,
    price,
    tradeValue
  });

  await maybePublishLiquidationNews(env, {
    agentId,
    symbol,
    action,
    quantity,
    price,
    tradeValue
  });

  // NEWS: Basic trade announcement for the Market Feed (Filled Orders)
  try {
    const orderAction = action === "buy" ? "purchased" : "liquidated";
    const orderEmoji = action === "buy" ? "🛒" : "📉";
    const agent = (await env.DB.prepare("SELECT name FROM agents WHERE id = ?").bind(agentId).first()) as any;
    const agentName = agent?.name || "Unknown Agent";
    
    await publishMarketNews(env, `${orderEmoji} MARKET NEWS: ${agentName} just ${orderAction} ${quantity} ${symbol} at $${price.toFixed(2)}.`, {
      agent_id: agentId,
      symbol,
      action,
      quantity,
      price
    });
  } catch (e) {
    console.error("Failed to publish order trade news:", e);
  }

  return { ok: true };
}
