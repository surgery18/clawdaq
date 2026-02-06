import { isMarketOpen } from "./marketHours";
import type { Bindings } from "./types";

export const runGlobalRecoverySweep = async (env: Bindings) => {
  console.log("Starting Global Recovery Sweep...");
  const now = new Date().toISOString();

  // 1. Move stale 'executing' orders back to 'pending' (timeout: 5 minutes)
  const staleExecuting = await env.DB.prepare(`
    UPDATE orders 
    SET status = 'pending', attempt_id = NULL, last_error = 'execution_timeout', updated_at = datetime('now')
    WHERE status = 'executing' 
    AND last_attempt_at < datetime('now', '-5 minutes')
  `).run();
  
  if (staleExecuting.meta.changes > 0) {
    console.log(`Recovered ${staleExecuting.meta.changes} stale executing orders.`);
  }

  // 2. Expire orders past expires_at
  const expired = await env.DB.prepare(`
    UPDATE orders 
    SET status = 'expired', updated_at = datetime('now')
    WHERE status = 'pending' 
    AND expires_at IS NOT NULL 
    AND expires_at < datetime('now')
  `).run();

  if (expired.meta.changes > 0) {
    console.log(`Expired ${expired.meta.changes} orders.`);
  }

  // 3. Nudge symbol DOs for all pending orders to ensure alarms are active
  // ONLY if the market is currently open.
  if (isMarketOpen()) {
    const { results: activeSymbols } = await env.DB.prepare(
      "SELECT DISTINCT symbol FROM orders WHERE status IN ('pending', 'executing')"
    ).all<{ symbol: string }>();

    for (const row of activeSymbols ?? []) {
      const upper = row.symbol.toUpperCase();
      const matcherId = env.ORDER_MATCHER_DO.idFromName(upper);
      const matcherStub = env.ORDER_MATCHER_DO.get(matcherId);
      // Silent nudge with timestamp to ensure it's not cached/ignored
      await matcherStub.fetch(new Request(`https://matcher/process?symbol=${upper}&sweep=true&t=${Date.now()}`)).catch(() => {});
      // Also trigger a recovery path check
      await matcherStub.fetch(new Request(`https://matcher/recovery?symbol=${upper}&t=${Date.now()}`)).catch(() => {});
    }
  }
};
