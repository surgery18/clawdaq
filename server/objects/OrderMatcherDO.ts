import { fetchMarketQuote } from "../marketData";
import { publishMarketEvent } from "../utils/marketEvents";
import { executeTradeForOrder } from "../utils/trades";
import type { Bindings } from "../utils/types";

type PendingOrder = {
  id: string;
  agent_id: string;
  symbol: string;
  side: string;
  quantity: number;
  order_type: string;
  limit_price: number | null;
  stop_price: number | null;
  trail_amount: number | null;
  trail_high_price?: number | null;
  trail_low_price?: number | null;
  attempt_count: number;
};

export class OrderMatcherDO {
  private state: DurableObjectState;
  private env: Bindings;
  private symbol: string;
  private isProcessing = false;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
    
    // Extract symbol from the ID if possible, otherwise fallback
    // In v2, we'll name them by symbol
    this.symbol = ""; 
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const symbolFromPath = url.searchParams.get("symbol")?.toUpperCase();
    if (symbolFromPath) this.symbol = symbolFromPath;

    if (url.pathname === "/process") {
      if (this.isProcessing) return new Response("Busy", { status: 429 });
      this.isProcessing = true;
      try {
        await this.matchOrders();
        await this.manageAlarm();
        return new Response("OK");
      } finally {
        this.isProcessing = false;
      }
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.matchOrders();
      await this.manageAlarm();
    } catch (e) {
      console.error(`OrderMatcher alarm error [${this.symbol}]:`, e);
    } finally {
      this.isProcessing = false;
    }
  }

  private async manageAlarm() {
    // Determine cadence based on order types
    const { results } = await this.env.DB.prepare(
      "SELECT order_type FROM orders WHERE symbol = ? AND status = 'pending'"
    ).bind(this.symbol).all<{ order_type: string }>();

    if (!results || results.length === 0) {
      // No pending orders, no alarm needed
      return;
    }

    const hasTrailing = results.some(r => r.order_type === 'trailing_stop');
    const interval = hasTrailing ? 2000 : 10000; // 2s for trailing, 10s for others
    
    // Add 10% jitter
    const jitter = interval * 0.1 * (Math.random() - 0.5);
    await this.state.storage.setAlarm(Date.now() + interval + jitter);
  }

  private async matchOrders() {
    if (!this.symbol) return;

    // 1. Load pending orders for this specific symbol
    const { results: pendingOrders } = await this.env.DB.prepare(
      "SELECT * FROM orders WHERE symbol = ? AND status = 'pending' ORDER BY created_at ASC"
    ).bind(this.symbol).all<PendingOrder>();

    if (!pendingOrders || pendingOrders.length === 0) return;

    // 2. Fetch fresh quote (fetched once per symbol cycle)
    const quote = await fetchMarketQuote(this.symbol, this.env.CACHE);
    const currentPrice = quote.price;

    for (const order of pendingOrders) {
      let shouldExecute = false;
      let executionPrice = currentPrice;

      const orderLimitPrice = Number(order.limit_price);
      const orderStopPrice = Number(order.stop_price);

      // Evaluate Triggers
      if (order.order_type === "limit") {
        if (order.side === "buy" && currentPrice <= orderLimitPrice) {
          shouldExecute = true;
          executionPrice = orderLimitPrice;
        } else if (order.side === "sell" && currentPrice >= orderLimitPrice) {
          shouldExecute = true;
          executionPrice = orderLimitPrice;
        }
      } else if (order.order_type === "stop_loss") {
        if (order.side === "buy" && currentPrice >= orderStopPrice) {
          shouldExecute = true;
        } else if (order.side === "sell" && currentPrice <= orderStopPrice) {
          shouldExecute = true;
        }
      } else if (order.order_type === "trailing_stop") {
        const trailPercent = Number(order.trail_amount);
        if (order.side === "sell") {
          let trailHigh = Number(order.trail_high_price || 0);
          if (trailHigh === 0 || currentPrice > trailHigh) {
            const oldHigh = trailHigh;
            trailHigh = currentPrice;
            // PERSISTENCE THRESHOLD: Only write to DB if movement > 0.5% to reduce DB load
            if (oldHigh === 0 || (trailHigh - oldHigh) / oldHigh > 0.005) {
              await this.env.DB.prepare("UPDATE orders SET trail_high_price = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(trailHigh, order.id).run();
            }
          }
          const triggerPrice = trailHigh * (1 - trailPercent / 100);
          if (currentPrice <= triggerPrice) shouldExecute = true;
        } else {
          let trailLow = Number(order.trail_low_price || 0);
          if (trailLow === 0 || currentPrice < trailLow) {
            const oldLow = trailLow;
            trailLow = currentPrice;
            // PERSISTENCE THRESHOLD: Only write to DB if movement > 0.5%
            if (oldLow === 0 || (oldLow - trailLow) / oldLow > 0.005) {
              await this.env.DB.prepare("UPDATE orders SET trail_low_price = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(trailLow, order.id).run();
            }
          }
          const triggerPrice = trailLow * (1 + trailPercent / 100);
          if (currentPrice >= triggerPrice) shouldExecute = true;
        }
      }

      if (shouldExecute) {
        // ATOMIC CLAIM: Try to move from 'pending' to 'executing'
        const attemptId = crypto.randomUUID();
        const claim = await this.env.DB.prepare(
          "UPDATE orders SET status = 'executing', attempt_id = ?, last_attempt_at = datetime('now'), attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'"
        ).bind(attemptId, order.id).run();

        if (claim.meta.changes === 0) continue; // Someone else grabbed it

        // Log Execution Attempt
        await this.env.DB.prepare(
          "INSERT INTO order_executions (order_id, attempt_id, status, quote_price, market_source) VALUES (?, ?, 'executing', ?, ?)"
        ).bind(order.id, attemptId, currentPrice, quote.source).run();

        // 3. Perform the trade
        const result = await executeTradeForOrder(this.env, order, executionPrice, quote.source);
        
        if (result.ok) {
          await this.env.DB.batch([
            this.env.DB.prepare("UPDATE orders SET status = 'filled', filled_price = ?, filled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(executionPrice, order.id),
            this.env.DB.prepare("UPDATE order_executions SET status = 'filled' WHERE order_id = ? AND attempt_id = ?").bind(order.id, attemptId)
          ]);

          await publishMarketEvent(this.env, order.agent_id, "order_filled", {
            order_id: order.id,
            symbol: order.symbol,
            side: order.side,
            quantity: order.quantity,
            price: executionPrice
          });
        } else {
          // REJECTED (Business failure: no money/shares)
          await this.env.DB.batch([
            this.env.DB.prepare("UPDATE orders SET status = 'rejected', last_error = ?, updated_at = datetime('now') WHERE id = ?").bind(result.error, order.id),
            this.env.DB.prepare("UPDATE order_executions SET status = 'rejected', error_message = ? WHERE order_id = ? AND attempt_id = ?").bind(result.error, order.id, attemptId)
          ]);
        }
      }
    }
  }
}
