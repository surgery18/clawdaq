import { fetchMarketQuote } from "../marketData";
import { publishMarketEvent } from "./marketEvents";
import { maybePublishTradeGossip } from "./gossip";
import { maybePublishLiquidationNews } from "./news";
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
  const quote = await fetchMarketQuote(symbol);
  const price = quote.price;
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

  const quoteAfter = await fetchMarketQuote(symbol);
  const priceAfter = quoteAfter.price;
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

  // Recalculate equity: newCash + holdings_value
  // Since we don't have all holdings prices here easily, we'll use a simplified equity update
  // or just rely on the next snapshot. 
  // Let's at least update it with the known cash delta.
  const newEquity = Number(
    (
      Number(portfolio.equity as number) +
      (action === "buy" ? 0 : tradeValueActual - (currentShares > 0 ? tradeValueActual : 0))
    ).toFixed(6)
  );
  // Actually, equity = cash + sum(shares * price). 
  // If we buy, cash decreases, holdings increase by same amount. Equity unchanged (initially).
  // If we sell, cash increases, holdings decrease. Equity unchanged (at current price).
  const equity = portfolio.equity;

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
    // Cleanup zero holdings (optional, but good for tidiness)
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

  // statements update holdings and cash_balance here

  const results = await c.env.DB.batch(statements);

  // Check if the portfolio update actually changed a row. If not, the condition (cash_balance >= ?) failed.
  if (action === "buy" && results[0]?.meta?.changes === 0) {
    return { ok: false, status: 400, error: "insufficient cash (concurrency limit hit)" };
  }
  if (action === "sell" && results[1]?.meta?.changes === 0) {
    return { ok: false, status: 400, error: "insufficient shares (concurrency limit hit)" };
  }

  // RECALCULATE EQUITY AFTER TRADE
  const holdingsRows = await c.env.DB.prepare(
    "SELECT symbol, quantity FROM holdings WHERE agent_id = ?"
  ).bind(agentId).all();

  const holdingPromises = (holdingsRows.results || []).map(async (h: any) => {
    const q = await fetchMarketQuote(h.symbol);
    return Number(h.quantity) * q.price;
  });

  const holdingsValues = await Promise.all(holdingPromises);
  const holdingsValueActual = holdingsValues.reduce((a, b) => a + b, 0);

  const finalEquity = newCash + holdingsValueActual;

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
    // Cleanup zero holdings
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

  // Recalculate Equity
  const holdingsRows = await env.DB.prepare(
    "SELECT symbol, quantity FROM holdings WHERE agent_id = ?"
  ).bind(agentId).all();

  const holdingPromises = (holdingsRows.results || []).map(async (h: any) => {
    const q = await fetchMarketQuote(h.symbol);
    return Number(h.quantity) * q.price;
  });

  const holdingsValues = await Promise.all(holdingPromises);
  const holdingsValueActual = holdingsValues.reduce((a, b) => a + b, 0);
  const finalEquity = newCash + holdingsValueActual;

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

  return { ok: true };
}
