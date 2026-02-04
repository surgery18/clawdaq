import type { Bindings } from "./types";

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export type CostBasisState = {
  shares: number;
  averageCost: number;
};

export const computeAverageCostsFromTransactions = async (
  db: Bindings["DB"],
  agentId: string
) => {
  const rows = await db
    .prepare(
      "SELECT id, symbol, side, quantity, price, executed_at FROM transactions WHERE agent_id = ? ORDER BY executed_at ASC, id ASC"
    )
    .bind(agentId)
    .all();

  const state = new Map<string, CostBasisState>();

  for (const row of rows.results ?? []) {
    const symbol = String(row?.symbol ?? "");
    if (!symbol) continue;
    const side = String(row?.side ?? "").toLowerCase();
    const quantity = toNumber(row?.quantity, 0);
    const price = toNumber(row?.price, 0);

    const existing = state.get(symbol) ?? { shares: 0, averageCost: 0 };

    if (side === "buy") {
      const newShares = existing.shares + quantity;
      const totalCost = existing.averageCost * existing.shares + price * quantity;
      existing.shares = newShares;
      existing.averageCost = newShares > 0 ? totalCost / newShares : 0;
    } else if (side === "sell") {
      const newShares = existing.shares - quantity;
      existing.shares = newShares > 0 ? newShares : 0;
      if (newShares <= 0) {
        existing.averageCost = 0;
      }
    }

    state.set(symbol, existing);
  }

  return state;
};

export const backfillHoldingAverageCosts = async (
  db: Bindings["DB"],
  agentId: string
) => {
  const holdingsRows = await db
    .prepare("SELECT symbol, quantity, average_cost FROM holdings WHERE agent_id = ?")
    .bind(agentId)
    .all();

  const needsBackfill = (holdingsRows.results ?? []).some((row) => {
    const shares = toNumber(row?.quantity, 0);
    const avgCost = toNumber(row?.average_cost, 0);
    return shares > 0 && avgCost <= 0;
  });

  if (!needsBackfill) {
    return { updated: 0, skipped: true };
  }

  const costMap = await computeAverageCostsFromTransactions(db, agentId);
  const statements = [] as ReturnType<typeof db.prepare>[];

  for (const row of holdingsRows.results ?? []) {
    const symbol = String(row?.symbol ?? "");
    if (!symbol) continue;
    const info = costMap.get(symbol);
    const avgCost = info?.averageCost ?? 0;
    statements.push(
      db
        .prepare(
          "UPDATE holdings SET average_cost = ?, updated_at = datetime('now') WHERE agent_id = ? AND symbol = ?"
        )
        .bind(avgCost, agentId, symbol)
    );
  }

  if (statements.length) {
    const results = await db.batch(statements);
    const updated = results.reduce((sum, result) => sum + (result?.meta?.changes ?? 0), 0);
    return { updated, skipped: false };
  }

  return { updated: 0, skipped: false };
};

export const backfillAllHoldingAverageCosts = async (db: Bindings["DB"]) => {
  const agentsRows = await db.prepare("SELECT id FROM agents").all();
  let updated = 0;
  let agentsProcessed = 0;

  for (const row of agentsRows.results ?? []) {
    const agentId = String(row?.id ?? "");
    if (!agentId) continue;
    agentsProcessed += 1;
    const result = await backfillHoldingAverageCosts(db, agentId);
    updated += result.updated;
  }

  return { agentsProcessed, updated };
};
