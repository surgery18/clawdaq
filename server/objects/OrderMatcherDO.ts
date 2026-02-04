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
};

export class OrderMatcherDO {
  private state: DurableObjectState;
  private env: Bindings;
  private isProcessing = false;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;

    // Start a monitoring loop
    this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.put("last_run", Date.now());
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/process") {
      if (this.isProcessing) return new Response("Busy", { status: 429 });
      this.isProcessing = true;
      try {
        await this.matchOrders();
        return new Response("OK");
      } finally {
        this.isProcessing = false;
      }
    }
    return new Response("Not Found", { status: 404 });
  }

  private async matchOrders() {
    // 1. Get all pending orders
    const { results: pendingOrders } = await this.env.DB.prepare(
      "SELECT * FROM orders WHERE status = 'pending'"
    ).all<PendingOrder>();

    if (!pendingOrders || pendingOrders.length === 0) return;

    // 2. Group by symbol
    const symbols = [...new Set(pendingOrders.map((o) => o.symbol))];

    for (const symbol of symbols) {
      // 3. Get current market price
      const quote = await fetchMarketQuote(symbol as string, this.env.CACHE);
      const currentPrice = quote.price;

      const ordersForSymbol = pendingOrders.filter((o) => o.symbol === symbol);

      for (const order of ordersForSymbol) {
        let shouldExecute = false;
        let executionPrice = currentPrice;

        const orderLimitPrice = Number(order.limit_price);
        const orderStopPrice = Number(order.stop_price);

        if (order.order_type === "limit") {
          if (order.side === "buy" && currentPrice <= orderLimitPrice) {
            shouldExecute = true;
            executionPrice = orderLimitPrice; // Fill at limit price or better
          } else if (order.side === "sell" && currentPrice >= orderLimitPrice) {
            shouldExecute = true;
            executionPrice = orderLimitPrice; // Fill at limit price or better
          }
        } else if (order.order_type === "stop_loss") {
          if (order.side === "buy" && currentPrice >= orderStopPrice) {
            shouldExecute = true;
            executionPrice = currentPrice; // Market buy once stop hit
          } else if (order.side === "sell" && currentPrice <= orderStopPrice) {
            shouldExecute = true;
            executionPrice = currentPrice; // Market sell once stop hit
          }
        } else if (order.order_type === "trailing_stop") {
          const trailPercent = Number(order.trail_amount); // Fixed to %

          if (order.side === "sell") {
            // Trailing Stop Sell (Stop Loss)
            let trailHigh = Number((order as any).trail_high_price || 0);
            if (trailHigh === 0 || currentPrice > trailHigh) {
              trailHigh = currentPrice;
              await this.env.DB.prepare(
                "UPDATE orders SET trail_high_price = ?, updated_at = datetime('now') WHERE id = ?"
              )
                .bind(trailHigh, order.id)
                .run();
            }

            const triggerPrice = trailHigh * (1 - trailPercent / 100);
            if (currentPrice <= triggerPrice) {
              shouldExecute = true;
              executionPrice = currentPrice;
            }
          } else {
            // Trailing Stop Buy (Buy into dip)
            let trailLow = Number(
              (order as any).trail_low_price || (order as any).trail_high_price || 0
            );
            if (trailLow === 0 || currentPrice < trailLow) {
              trailLow = currentPrice;
              await this.env.DB.prepare(
                "UPDATE orders SET trail_low_price = ?, updated_at = datetime('now') WHERE id = ?"
              )
                .bind(trailLow, order.id)
                .run();
            }
            const triggerPrice = trailLow * (1 + trailPercent / 100);
            if (currentPrice >= triggerPrice) {
              shouldExecute = true;
              executionPrice = currentPrice;
            }
          }
        }

        if (shouldExecute) {
          const result = await executeTradeForOrder(
            this.env,
            order,
            executionPrice,
            quote.source
          );
          if (result.ok) {
            await this.env.DB.prepare(
              "UPDATE orders SET status = 'filled', filled_price = ?, filled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
            )
              .bind(executionPrice, order.id)
              .run();

            // Publish event
            await publishMarketEvent(this.env, order.agent_id, "order_filled", {
              order_id: order.id,
              symbol: order.symbol,
              side: order.side,
              quantity: order.quantity,
              price: executionPrice
            });
          } else {
            // If insufficient funds, maybe cancel it? For now just log
            console.error(`Failed to execute order ${order.id}: ${result.error}`);
          }
        }
      }
    }
  }
}
