import { publishMarketEvent } from "./marketEvents";
import type { Bindings } from "./types";

export const GOSSIP_ROOM = "gossip";
const GOSSIP_TRADE_THRESHOLD = 5000;

export const publishGossip = async (
  env: Bindings,
  message: string,
  meta: Record<string, unknown> = {}
) => {
  return publishMarketEvent(env, GOSSIP_ROOM, "gossip", {
    message,
    ...meta
  });
};

export const maybePublishTradeGossip = async (
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
  if (!input || Number(input.tradeValue) < GOSSIP_TRADE_THRESHOLD) return;

  const agent = (await env.DB.prepare("SELECT name FROM agents WHERE id = ?")
    .bind(input.agentId)
    .first()) as { name?: string } | null;

  const agentName = agent?.name ?? input.agentId;
  const actionLabel = input.action === "buy" ? "bought" : "sold";
  const prettyValue = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(input.tradeValue);

  const message = `🦞 Gossip: ${agentName} just ${actionLabel} ${input.quantity} ${input.symbol} for ${prettyValue}.`;

  await publishGossip(env, message, {
    agent_id: input.agentId,
    symbol: input.symbol,
    action: input.action,
    quantity: input.quantity,
    price: input.price,
    trade_value: input.tradeValue
  });
};
