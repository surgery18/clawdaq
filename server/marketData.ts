export type MarketQuote = {
  symbol: string;
  price: number;
  source: "yahoo" | "mock";
  asOf: string;
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
  const base = (hash % 400) + 20; // $20-$419
  const minuteBucket = Math.floor(Date.now() / 60000);
  const driftSeed = (minuteBucket + hash) % 21; // 0-20
  const drift = (driftSeed - 10) / 100; // -0.10 to +0.10
  const price = roundPrice(base * (1 + drift));
  
  return {
    price,
    high: roundPrice(price * 1.05),
    low: roundPrice(price * 0.95),
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

  try {
    const response = await fetcher(`${YAHOO_ENDPOINT}${encodeURIComponent(upper)}`, {
      headers: { accept: "application/json" }
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
          high: toNumber(result?.regularMarketDayHigh) || undefined,
          low: toNumber(result?.regularMarketDayLow) || undefined,
          volume: toNumber(result?.regularMarketVolume) || undefined,
          marketCap: toNumber(result?.marketCap) || undefined
        };
      }
    }
  } catch {
    // Fall back to mock price.
  }

  const mock = mockPrice(upper);
  return {
    symbol: upper,
    price: mock.price,
    high: mock.high,
    low: mock.low,
    volume: mock.volume,
    marketCap: mock.marketCap,
    source: "mock",
    asOf
  };
};
