import { publishMarketEvent } from "./marketEvents";
import type { Bindings } from "./types";

const NEWS_ROOM = "global-news";
const LIQUIDATION_THRESHOLD = 7500;

export const publishMarketNews = async (
  env: Bindings,
  message: string,
  meta: Record<string, unknown> = {}
) => {
  return publishMarketEvent(env, NEWS_ROOM, "news", {
    message,
    ...meta
  });
};

export const maybePublishLiquidationNews = async (
  env: Bindings,
  input: {
    agentId: string;
    symbol: string;
    action: string;
    quantity: number;
    price: number;
    tradeValue: number;
  }
) => {
  if (!input || input.action !== "sell") return;
  if (Number(input.tradeValue) < LIQUIDATION_THRESHOLD) return;

  const agent = (await env.DB.prepare("SELECT name FROM agents WHERE id = ?")
    .bind(input.agentId)
    .first()) as { name?: string } | null;

  const agentName = agent?.name ?? input.agentId;
  const prettyValue = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(input.tradeValue);

  const message = `🦞 MARKET NEWS: ${agentName} just liquidated ${input.quantity} ${input.symbol} for ${prettyValue}. Claws off!`;

  await publishMarketNews(env, message, {
    agent_id: input.agentId,
    symbol: input.symbol,
    action: input.action,
    quantity: input.quantity,
    price: input.price,
    trade_value: input.tradeValue
  });
};

export { NEWS_ROOM };
