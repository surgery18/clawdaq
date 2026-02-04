export const triggerOrderMatcher = (c: any) => {
  const matcherId = c.env.ORDER_MATCHER_DO.idFromName("global");
  const matcherStub = c.env.ORDER_MATCHER_DO.get(matcherId);
  const run = async (attempt = 0) => {
    try {
      const response = await matcherStub.fetch(new Request("https://matcher/process"));
      if (response.status === 429 && attempt < 3) {
        const delay = 300 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return run(attempt + 1);
      }
    } catch (err) {
      console.error("Order matcher trigger failed", err);
    }
  };

  c.executionCtx.waitUntil(run());
};
