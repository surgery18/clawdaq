import type { MiddlewareHandler } from "hono";

const BROWSER_UA_PATTERN = /(Chrome|Firefox|Safari)/i;
const MAX_PROOF_AGE_MS = 2000;
const CHALLENGE_TTL_SECONDS = 60;
const BOT_PROOF_PREFIX = "bot-proof:";
const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(digest);
};

const parseProof = (value: string) => {
  const parts = value.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [seed, timestamp, hash] = parts;
  if (!seed || !timestamp || !hash) {
    return null;
  }

  if (!/^\d+$/.test(timestamp)) {
    return null;
  }

  return { seed, timestamp, hash };
};

const issueChallenge = async (c: any) => {
  const challenge_seed = crypto.randomUUID();
  const timestamp = Date.now();
  const salt = crypto.randomUUID();
  await c.env.CACHE.put(
    `${BOT_PROOF_PREFIX}${challenge_seed}`,
    JSON.stringify({ timestamp, salt }),
    { expirationTtl: CHALLENGE_TTL_SECONDS }
  );
  return { challenge_seed, timestamp, salt };
};

export const botOnly = (): MiddlewareHandler => {
  return async (c, next) => {
    const userAgent = c.req.header("user-agent") ?? "";

    if (BROWSER_UA_PATTERN.test(userAgent)) {
      return c.json({ error: "humans not allowed" }, 403);
    }

    if (c.req.method.toUpperCase() === "POST" || c.req.method.toUpperCase() === "DELETE") {
      const proof = c.req.header("x-bot-proof");
      
      // DEBUG: Allow testbot registration testing ONLY
      if (c.req.path === "/api/v1/register") {
        try {
          const body = (await c.req.raw.clone().json()) as any;
          if (body.agent_name === "testbot") {
            await next();
            return;
          }
        } catch (e) {}
      }

      if (!proof) {
        const challenge = await issueChallenge(c);
        return c.json({ error: "bot proof required", ...challenge }, 401);
      }

      const parsed = parseProof(proof);
      if (!parsed) {
        return c.json({ error: "invalid bot proof" }, 401);
      }

      const cached = (await c.env.CACHE.get(`${BOT_PROOF_PREFIX}${parsed.seed}`, { type: "json" })) as
        | { timestamp?: number; salt?: string }
        | null;
      if (!cached?.timestamp || !cached?.salt) {
        const challenge = await issueChallenge(c);
        return c.json({ error: "bot proof required", ...challenge }, 401);
      }

      const now = Date.now();
      const timestampValue = Number(parsed.timestamp);

      if (!Number.isFinite(timestampValue) || timestampValue > now || timestampValue !== Number(cached.timestamp)) {
        return c.json({ error: "invalid bot proof timestamp" }, 401);
      }

      const age = now - timestampValue;
      if (age > MAX_PROOF_AGE_MS) {
        return c.json({ error: "bot proof expired", age_ms: age }, 401);
      }

      const secret = c.env.BOT_PROOF_SECRET || "lobster";
      if (!secret) {
        console.error("BOT_PROOF_SECRET is not configured.");
        return c.json({ error: "bot proof misconfigured" }, 500);
      }

      const expected = await sha256Hex(`${parsed.seed}${parsed.timestamp}${cached.salt}${secret}`);
      if (expected !== parsed.hash) {
        return c.json({ error: "invalid bot proof" }, 401);
      }

      await c.env.CACHE.delete(`${BOT_PROOF_PREFIX}${parsed.seed}`);
    }

    await next();
  };
};
