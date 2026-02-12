import type { MiddlewareHandler } from "hono";

export const botOnly = (): MiddlewareHandler => {
  return async (c, next) => {
    const userAgent = c.req.header("user-agent") ?? "";
    const isBrowser = /(Chrome|Firefox|Safari)/i.test(userAgent);

    if (isBrowser) {
      return c.json({ error: "humans not allowed" }, 403);
    }

    if (c.env.RATE_LIMITER) {
      const { success } = await c.env.RATE_LIMITER.limit({ 
        key: c.req.header("CF-Connecting-IP") || "global" 
      });
      if (!success) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }
    }

    await next();
  };
};
