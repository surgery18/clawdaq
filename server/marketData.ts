import type { KVNamespace } from "@cloudflare/workers-types";

export type MarketQuote = {
  symbol: string;
  price: number;
  source: "yahoo" | "finnhub" | "cache" | "stale_cache" | "override" | "placeholder";
  asOf: string;
  changePercent?: number;
  high?: number;
  low?: number;
  volume?: number;
  marketCap?: number;
  isPlaceholder?: boolean;
};

const YAHOO_ENDPOINT = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=";
const FINNHUB_ENDPOINT = "https://finnhub.io/api/v1/quote?symbol=";
const QUOTE_CACHE_PREFIX = "quote:v1:";
const CACHE_TTL_SECONDS = 60; // Production allows 30, but local dev requires min 60.
const CACHE_MAX_AGE_SECONDS = 90; // Strict staleness check for cached quotes

const EMERGENCY_OVERRIDES: Record<string, number> = {};

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const roundPrice = (value: number, symbol: string) => {
  if (symbol === "AITX" || value < 0.01) {
    return Math.max(0.0001, Math.round(value * 10000) / 10000);
  }
  return Math.max(0.01, Math.round(value * 100) / 100);
};

const isStale = (asOf: string | undefined, maxAgeSeconds: number): boolean => {
  if (!asOf) return true;
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp > maxAgeSeconds * 1000;
};

const fetchFromFinnhub = async (
  symbol: string,
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<Partial<MarketQuote> | null> => {
  try {
    const url = `${FINNHUB_ENDPOINT}${encodeURIComponent(symbol)}&token=${apiKey}`;
    const response = await fetcher(url);
    if (response.ok) {
      const data = await response.json().catch(() => null) as any;
      const price = toNumber(data?.c); // Current price
      if (price !== null && price !== 0) {
        const providerTimestamp = toNumber(data?.t);
        const asOf = providerTimestamp ? new Date(providerTimestamp * 1000).toISOString() : new Date().toISOString();
        return {
          price: roundPrice(price, symbol),
          changePercent: toNumber(data?.dp) || 0, // Percent change
          high: toNumber(data?.h) || undefined,
          low: toNumber(data?.l) || undefined,
          source: "finnhub",
          asOf
        };
      }
      console.warn(`Finnhub response missing price for ${symbol}: ${JSON.stringify(data)?.slice(0, 200)}`);
    } else if (response.status === 429) {
      console.warn(`Finnhub rate limited (429) for ${symbol}.`);
    } else {
      const bodyText = await response.text().catch(() => "");
      console.warn(`Finnhub response ${response.status} for ${symbol}: ${bodyText.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("Finnhub fetch failed:", err);
  }
  return null;
};

const fetchFromYahoo = async (
  symbol: string,
  fetcher: typeof fetch = fetch
): Promise<Partial<MarketQuote> | null> => {
  try {
    const response = await fetcher(`${YAHOO_ENDPOINT}${encodeURIComponent(symbol)}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ClawdaqMarketSurgeon/1.0 (Mozilla/5.0; CloudflareWorker)"
      }
    });

    if (response.ok) {
      const payload = await response.json().catch(() => null) as any;
      const result = payload?.quoteResponse?.result?.[0];
      const price = toNumber(result?.regularMarketPrice);

      if (price !== null && price !== 0) {
        const providerTimestamp = toNumber(result?.regularMarketTime);
        const asOf = providerTimestamp ? new Date(providerTimestamp * 1000).toISOString() : new Date().toISOString();
        return {
          price: roundPrice(price, symbol),
          changePercent: toNumber(result?.regularMarketChangePercent) || 0,
          high: toNumber(result?.regularMarketDayHigh) || undefined,
          low: toNumber(result?.regularMarketDayLow) || undefined,
          volume: toNumber(result?.regularMarketVolume) || undefined,
          marketCap: toNumber(result?.marketCap) || undefined,
          source: "yahoo",
          asOf
        };
      }
      console.warn(`Yahoo response missing price for ${symbol}: ${JSON.stringify(payload)?.slice(0, 200)}`);
    } else if (response.status === 429) {
      console.warn(`Yahoo rate limited (429) for ${symbol}.`);
    } else {
      const bodyText = await response.text().catch(() => "");
      console.warn(`Yahoo response ${response.status} for ${symbol}: ${bodyText.slice(0, 200)}`);
    }
  } catch (err) {
    console.error("Yahoo fetch failed:", err);
  }
  return null;
};

export const fetchMarketQuote = async (
  symbol: string,
  cache?: KVNamespace,
  finnhubKey?: string,
  fetcher: typeof fetch = fetch,
  options?: { forceRefresh?: boolean; maxAgeSeconds?: number }
): Promise<MarketQuote> => {
  const upper = symbol.toUpperCase();
  const maxAgeSeconds = options?.maxAgeSeconds ?? CACHE_MAX_AGE_SECONDS;
  const overridePrice = EMERGENCY_OVERRIDES[upper];
  let staleCandidate: MarketQuote | null = null;

  // 1. Check KV Cache first
  if (cache) {
    try {
      const cached = await cache.get(`${QUOTE_CACHE_PREFIX}${upper}`, { type: "json" }) as MarketQuote | null;
      if (cached) {
        const cachedPrice = toNumber(cached.price);
        const cachedValid = cachedPrice !== null && cachedPrice > 0;
        const cachedPlaceholder = cached.isPlaceholder || cached.source === "placeholder";

        // Only consider it a mismatch if the cached source is 'override' but the value changed.
        // We SHOULD trust 'finnhub' or 'yahoo' over the hardcoded override.
        const isOverrideSource = cached.source === "override";
        const overrideValueMismatch =
          isOverrideSource &&
          overridePrice !== undefined &&
          Math.abs(cachedPrice! - overridePrice) > 1e-9;

        if (
          !options?.forceRefresh &&
          cachedValid &&
          !cachedPlaceholder &&
          !overrideValueMismatch &&
          !isStale(cached.asOf, maxAgeSeconds)
        ) {
          // Return cached quote
          return {
            ...cached,
            price: cachedPrice!,
            source: "cache"
          };
        }
        if (cachedValid && !cachedPlaceholder) {
          staleCandidate = cached;
        }
      }
    } catch (e) {
      console.error(`KV Cache read failed for ${upper}:`, e);
    }
  }

  // 2. Try Primary Provider: Finnhub
  if (finnhubKey) {
    const finnhubData = await fetchFromFinnhub(upper, finnhubKey, fetcher);
    if (finnhubData) {
      const quote: MarketQuote = {
        ...finnhubData,
        symbol: upper,
        asOf: finnhubData.asOf ?? new Date().toISOString()
      } as MarketQuote;
      if (cache) {
        await cache.put(`${QUOTE_CACHE_PREFIX}${upper}`, JSON.stringify(quote), { expirationTtl: CACHE_TTL_SECONDS });
      }
      return quote;
    }
  }

  // 3. Try Backup Provider: Yahoo
  const yahooData = await fetchFromYahoo(upper, fetcher);
  if (yahooData) {
    const quote: MarketQuote = {
      ...yahooData,
      symbol: upper,
      asOf: yahooData.asOf ?? new Date().toISOString()
    } as MarketQuote;
    if (cache) {
      await cache.put(`${QUOTE_CACHE_PREFIX}${upper}`, JSON.stringify(quote), { expirationTtl: CACHE_TTL_SECONDS });
    }
    return quote;
  }

  // 4. Emergency Overrides: Use hardcoded prices for core watchlist symbols
  if (overridePrice !== undefined && overridePrice !== null) {
    const price = roundPrice(overridePrice, upper);
    const quote: MarketQuote = {
      symbol: upper,
      price,
      changePercent: 0,
      source: "override",
      asOf: new Date().toISOString()
    };
    if (cache) {
      await cache.put(`${QUOTE_CACHE_PREFIX}${upper}`, JSON.stringify(quote), { expirationTtl: 60 });
    }
    return quote;
  }

  // 5. Last Resort: Return stale cache (if available) so UI can indicate staleness
  if (staleCandidate) {
    return {
      ...staleCandidate,
      source: "stale_cache"
    };
  }

  // 6. Final Fallback: Return placeholder quote so callers can continue gracefully
  return {
    symbol: upper,
    price: 0.01,
    source: "placeholder",
    asOf: new Date().toISOString(),
    isPlaceholder: true
  };
};

/**
 * Syncs the market pulse by fetching fresh quotes for the core watchlist.
 * Replaces the Durable Object background loop with a simple function that can be called 
 * via CRON or on-demand without persistent WebSocket connections.
 */
export const syncMarketPulse = async (
  db: D1Database,
  cache: KVNamespace,
  finnhubKey: string,
  fetcher: typeof fetch = fetch
) => {
  // Get all unique symbols currently held in portfolios or appearing in pending orders
  const { results: symbolsRow } = await db.prepare(`
    SELECT DISTINCT symbol FROM holdings
    UNION
    SELECT DISTINCT symbol FROM orders WHERE status IN ('pending', 'executing')
  `).all();

  const symbols = (symbolsRow ?? []).map((row) => String(row.symbol).toUpperCase());

  const allSymbols = Array.from(new Set(symbols));

  const results = await Promise.all(
    allSymbols.map(async (symbol) => {
      try {
        // Force refresh to get fresh data from APIs
        const quote = await fetchMarketQuote(symbol, cache, finnhubKey, fetcher, {
          forceRefresh: true
        });
        return { symbol, price: quote.price, source: quote.source };
      } catch (err) {
        console.error(`Pulse sync failed for ${symbol}:`, err);
        return { symbol, error: String(err) };
      }
    })
  );

  return {
    timestamp: new Date().toISOString(),
    results
  };
};
