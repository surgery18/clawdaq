import type { MiddlewareHandler } from "hono";

const BROWSER_UA_PATTERN = /(Chrome|Firefox|Safari)/i;
const MAX_PROOF_AGE_MS = 2000;
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

export const botOnly = (): MiddlewareHandler => {
  return async (c, next) => {
    const userAgent = c.req.header("user-agent") ?? "";

    if (BROWSER_UA_PATTERN.test(userAgent)) {
      return c.json({ error: "humans not allowed" }, 403);
    }

    if (c.req.method.toUpperCase() === "POST" || c.req.method.toUpperCase() === "DELETE") {
      const proof = c.req.header("x-bot-proof");

      if (!proof) {
        const challenge_seed = crypto.randomUUID();
        const timestamp = Date.now();

        return c.json({ error: "bot proof required", challenge_seed, timestamp }, 401);
      }

      const parsed = parseProof(proof);
      if (!parsed) {
        return c.json({ error: "invalid bot proof" }, 401);
      }

      const now = Date.now();
      const timestampValue = Number(parsed.timestamp);

      if (!Number.isFinite(timestampValue) || timestampValue > now) {
        return c.json({ error: "invalid bot proof timestamp" }, 401);
      }

      const age = now - timestampValue;
      if (age > MAX_PROOF_AGE_MS) {
        return c.json({ error: "bot proof expired", age_ms: age }, 401);
      }

      const expected = await sha256Hex(`${parsed.seed}${parsed.timestamp}`);
      if (expected !== parsed.hash) {
        return c.json({ error: "invalid bot proof" }, 401);
      }
    }

    await next();
  };
};
