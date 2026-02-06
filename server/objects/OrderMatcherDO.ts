import { fetchMarketQuote } from "../marketData";
import { publishMarketEvent } from "../utils/marketEvents";
import { executeTradeForOrder } from "../utils/trades";
import { getNextMarketOpenMs, isMarketOpen } from "../utils/marketHours";
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
  reasoning: string | null;
  strategy_id: string | null;
};

const datetimeNow = () => new Date().toISOString().replace('T', ' ').split('.')[0];

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
    if (url.pathname === "/recovery") {
      if (this.isProcessing) return new Response("Busy", { status: 429 });
      this.isProcessing = true;
      try {
        // Direct recovery trigger for this symbol
        await this.matchOrders();
        return new Response("OK");
      } finally {
        this.isProcessing = false;
      }
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm() {
    if (this.isProcessing) {
      // If busy, reschedule briefly
      await this.state.storage.setAlarm(Date.now() + 2000);
      return;
    }
    this.isProcessing = true;
    try {
      await this.matchOrders();
      await this.manageAlarm();
    } catch (e) {
      console.error(`OrderMatcher alarm error [${this.symbol}]:`, e);
      // Reschedule on error
      await this.state.storage.setAlarm(Date.now() + 5000);
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

    if (!isMarketOpen()) {
      await this.state.storage.setAlarm(Date.now() + getNextMarketOpenMs() + 1000); // +1s buffer
      return;
    }

    const hasTrailing = results.some((r: any) => r.order_type === 'trailing_stop');
    const interval = hasTrailing ? 2000 : 10000; // 2s for trailing, 10s for others
    
    // Add 10% jitter
    const jitter = interval * 0.1 * (Math.random() - 0.5);
    const nextAlarm = Date.now() + interval + jitter;
    
    // Safety: ensure we don't set an alarm for a time that already passed
    await this.state.storage.setAlarm(Math.max(nextAlarm, Date.now() + 1000));
  }

  private async matchOrders() {
    if (!this.symbol) return;
    if (!isMarketOpen()) return;

    // 1. Load pending orders for this specific symbol
    const { results: pendingOrders } = await this.env.DB.prepare(
      "SELECT * FROM orders WHERE symbol = ? AND status = 'pending' ORDER BY created_at ASC"
    ).bind(this.symbol).all<PendingOrder>();

    if (!pendingOrders || pendingOrders.length === 0) return;

    // 2. Fetch fresh quote (fetched once per symbol cycle)
    const quote = await fetchMarketQuote(this.symbol, this.env.CACHE, this.env.FINNHUB_API_KEY);
    const currentPrice = quote.price;

    if (!Number.isFinite(currentPrice)) {
      console.warn(`OrderMatcher skipped for ${this.symbol}: market data unavailable.`);
      return;
    }

    for (const order of pendingOrders) {
      let shouldExecute = false;
      let executionPrice = currentPrice;

      const orderLimitPrice = Number(order.limit_price);
      const orderStopPrice = Number(order.stop_price);

      // Evaluate Triggers
      if (order.order_type === "market") {
        // Market orders execute immediately upon market open
        shouldExecute = true;
        
        // REBALANCING LOGIC: If it's a queued market BUY, we must adjust quantity
        // to ensure we don't exceed the reserved buying power if the price jumped.
        if (order.side === "buy") {
          const portfolio = await this.env.DB.prepare(
            "SELECT cash_balance FROM portfolios WHERE agent_id = ?"
          ).bind(order.agent_id).first<{ cash_balance: number }>();
          
          if (portfolio) {
            // Get all other pending buys to find truly available cash
            const { results: otherBuys } = await this.env.DB.prepare(
              "SELECT symbol, quantity, limit_price FROM orders WHERE agent_id = ? AND side = 'buy' AND status IN ('pending', 'executing') AND id != ?"
            ).bind(order.agent_id, order.id).all<{ symbol: string, quantity: number, limit_price: number | null }>();
            
            let reservedForOthers = 0;
            for (const buy of (otherBuys ?? [])) {
              if (buy.limit_price) {
                reservedForOthers += buy.quantity * buy.limit_price;
              } else {
                const q = await fetchMarketQuote(buy.symbol, this.env.CACHE, this.env.FINNHUB_API_KEY);
                reservedForOthers += buy.quantity * q.price;
              }
            }
            
            const availableForThisOrder = Math.max(0, portfolio.cash_balance - reservedForOthers);
            const maxSharesAtCurrentPrice = Math.floor(availableForThisOrder / currentPrice);
            
            if (maxSharesAtCurrentPrice < order.quantity) {
              console.log(`[OrderMatcher] Rebalancing market buy for ${order.agent_id}: ${order.quantity} -> ${maxSharesAtCurrentPrice} shares due to price change.`);
              order.quantity = maxSharesAtCurrentPrice;
              // Update the order in the DB so the execution records the correct final quantity
              await this.env.DB.prepare("UPDATE orders SET quantity = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
                .bind(order.quantity, order.id).run();
                
              if (order.quantity <= 0) {
                await this.env.DB.prepare("UPDATE orders SET status = 'rejected', last_error = 'Insufficient funds at opening price', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
                  .bind(order.id).run();
                continue;
              }
            }
          }
        }
      } else if (order.order_type === "limit") {
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
              await this.env.DB.prepare("UPDATE orders SET trail_high_price = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
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
              await this.env.DB.prepare("UPDATE orders SET trail_low_price = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
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
            price: executionPrice,
            strategy_id: order.strategy_id
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
