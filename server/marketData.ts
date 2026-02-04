export type MarketQuote = {
  symbol: string;
  price: number;
  source: "yahoo" | "mock" | "cache";
  asOf: string;
  changePercent?: number;
  high?: number;
  low?: number;
  volume?: number;
  marketCap?: number;
};

const YAHOO_ENDPOINT = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=";

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const roundPrice = (value: number) => Math.max(0.01, Math.round(value * 100) / 100);

const hashSymbol = (symbol: string) => {
  let hash = 7;
  for (const char of symbol) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
};

const mockPrice = (symbol: string) => {
  const hash = hashSymbol(symbol);
  
  // Real-World Overrides for Scott's Watchlist
  const overrides: Record<string, number> = {
    "RUM": 5.52,
    "TIRX": 0.09,
    "AITX": 0.0006,
    "FAT": 0.29,
    "DJT": 12.21,
    "ASST": 0.82
  };

  const base = overrides[symbol] || (hash % 49) + 1;
  // Deterministic drift: price only changes once every 30 seconds
  const timeBucket = Math.floor(Date.now() / 30000); 
  const driftSeed = (timeBucket + hash) % 101; 
  const drift = (driftSeed - 50) / 1000; // -5% to +5% drift
  const price = roundPrice(base * (1 + drift));
  
  return {
    price,
    changePercent: (driftSeed - 50) / 10, // Mock change %
    high: roundPrice(price * 1.02),
    low: roundPrice(price * 0.98),
    volume: (hash % 1000000) + 100000,
    marketCap: (hash % 1000) * 1000000000
  };
};

export const fetchMarketQuote = async (
  symbol: string,
  fetcher: typeof fetch = fetch
): Promise<MarketQuote> => {
  const upper = symbol.toUpperCase();
  const asOf = new Date().toISOString();

  // Try real Yahoo data first with a fake User-Agent to avoid immediate blocking
  try {
    const response = await fetcher(`${YAHOO_ENDPOINT}${encodeURIComponent(upper)}`, {
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
        return {
          symbol: upper,
          price: roundPrice(price),
          source: "yahoo",
          asOf,
          changePercent: toNumber(result?.regularMarketChangePercent) || 0,
          high: toNumber(result?.regularMarketDayHigh) || undefined,
          low: toNumber(result?.regularMarketDayLow) || undefined,
          volume: toNumber(result?.regularMarketVolume) || undefined,
          marketCap: toNumber(result?.marketCap) || undefined
        };
      }
    } else if (response.status === 429) {
       console.warn(`Yahoo rate limited (429) for ${upper}. Falling back to mocks.`);
    }
  } catch (err) {
    console.error("Yahoo fetch failed, using overrides/mock:", err);
  }

  // Fallback to mock price.
  const mock = mockPrice(upper);
  return {
    symbol: upper,
    price: mock.price,
    changePercent: mock.changePercent,
    high: mock.high,
    low: mock.low,
    volume: mock.volume,
    marketCap: mock.marketCap,
    source: "mock",
    asOf
  };
};
