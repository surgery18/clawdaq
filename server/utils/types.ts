export type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  ORDER_MATCHER_DO: DurableObjectNamespace;
  FINNHUB_QUOTE_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
  BASE_URL?: string;
  BOT_PROOF_SECRET?: string;
  FINNHUB_API_KEY?: string;
};

export type MarketEvent = {
  type: string;
  room: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AuthResult = { agentId: string; agentName: string; apiKey: string };
