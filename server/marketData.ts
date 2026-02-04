import type { KVNamespace } from "@cloudflare/workers-types";

export type MarketQuote = {
  symbol: string;
  price: number;
  source: "yahoo" | "finnhub" | "mock" | "cache";
  asOf: string;
  changePercent?: number;
  high?: number;
  low?: number;
  volume?: number;
  marketCap?: number;
};

const YAHOO_ENDPOINT = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=";
const FINNHUB_ENDPOINT = "https://finnhub.io/api/v1/quote?symbol=";
const QUOTE_CACHE_PREFIX = "quote:v1:";
const CACHE_TTL_SECONDS = 30; // Reduced from 60 to 30 for fresher prices
const CACHE_MAX_AGE_SECONDS = 90; // Strict staleness check for cached quotes

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const roundPrice = (value: number) => Math.max(0.01, Math.round(value * 100) / 100);

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
          price: roundPrice(price),
          changePercent: toNumber(data?.dp) || 0, // Percent change
          high: toNumber(data?.h) || undefined,
          low: toNumber(data?.l) || undefined,
          source: "finnhub",
          asOf
        };
      }
    } else if (response.status === 429) {
      console.warn(`Finnhub rate limited (429) for ${symbol}.`);
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
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (response.ok) {
      const payload = await response.json().catch(() => null) as any;
      const result = payload?.quoteResponse?.result?.[0];
      const price = toNumber(result?.regularMarketPrice);

      if (price !== null) {
        const providerTimestamp = toNumber(result?.regularMarketTime);
        const asOf = providerTimestamp ? new Date(providerTimestamp * 1000).toISOString() : new Date().toISOString();
        return {
          price: roundPrice(price),
          changePercent: toNumber(result?.regularMarketChangePercent) || 0,
          high: toNumber(result?.regularMarketDayHigh) || undefined,
          low: toNumber(result?.regularMarketDayLow) || undefined,
          volume: toNumber(result?.regularMarketVolume) || undefined,
          marketCap: toNumber(result?.marketCap) || undefined,
          source: "yahoo",
          asOf
        };
      }
    } else if (response.status === 429) {
       console.warn(`Yahoo rate limited (429) for ${symbol}.`);
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

  // 1. Check KV Cache first (unless forced refresh)
  if (cache && !options?.forceRefresh) {
    try {
      const cached = await cache.get(`${QUOTE_CACHE_PREFIX}${upper}`, { type: "json" }) as MarketQuote | null;
      if (cached && !isStale(cached.asOf, maxAgeSeconds)) {
        // Return cached quote but don't log to reduce noise unless it's a real issue
        return {
          ...cached,
          source: "cache"
        };
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

  // 4. Last Resort: Real-World Overrides for Scott's Watchlist
  const overrides: Record<string, number> = {
    "RUM": 5.67,
    "TIRX": 0.09,
    "AITX": 0.0006,
    "FAT": 0.29,
    "DJT": 12.21,
    "ASST": 0.82,
    "LOB": 35.21,
    "AAPL": 180.00,
    "TSLA": 240.00
  };

  const overridePrice = overrides[upper];
  if (overridePrice !== undefined) {
    const mockQuote: MarketQuote = {
      symbol: upper,
      price: overridePrice,
      changePercent: 0,
      source: "mock",
      asOf: new Date().toISOString()
    };
    if (cache) {
      await cache.put(`${QUOTE_CACHE_PREFIX}${upper}`, JSON.stringify(mockQuote), { expirationTtl: 60 });
    }
    return mockQuote;
  }

  // 5. Final Fallback: Error out if no real data or override can be found
  throw new Error(`Market data currently unavailable for ${upper}. All providers are unresponsive.`);
};
