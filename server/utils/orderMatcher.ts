export const triggerOrderMatcher = (c: any, symbol: string) => {
  if (!symbol) return;
  const upper = symbol.toUpperCase();
  
  // Per-symbol DO Sharding
  const matcherId = c.env.ORDER_MATCHER_DO.idFromName(upper);
  const matcherStub = c.env.ORDER_MATCHER_DO.get(matcherId);
  
  const run = async (attempt = 0) => {
    try {
      // Pass symbol in query string so DO knows who it is
      const response = await matcherStub.fetch(new Request(`https://matcher/process?symbol=${upper}`));
      if (response.status === 429 && attempt < 3) {
        const delay = 300 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return run(attempt + 1);
      }
    } catch (err) {
      console.error(`Order matcher trigger failed for ${upper}`, err);
    }
  };

  c.executionCtx.waitUntil(run());
};
