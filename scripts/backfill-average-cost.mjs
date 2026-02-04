#!/usr/bin/env node
import crypto from "node:crypto";

const baseUrl = process.env.BACKFILL_URL || "http://localhost:8787";
const endpoint = `${baseUrl.replace(/\/$/, "")}/api/v1/portfolio/backfill-average-cost`;

const run = async () => {
  const first = await fetch(endpoint, { method: "POST" });
  const initialPayload = await first.json().catch(() => ({}));

  if (first.status !== 401) {
    console.log(JSON.stringify(initialPayload, null, 2));
    return;
  }

  const seed = initialPayload?.challenge_seed;
  const timestamp = initialPayload?.timestamp;

  if (!seed || !timestamp) {
    console.error("Failed to obtain bot proof challenge:", initialPayload);
    process.exit(1);
  }

  const hash = crypto
    .createHash("sha256")
    .update(`${seed}${timestamp}`)
    .digest("hex");

  const proof = `${seed}:${timestamp}:${hash}`;

  const second = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-bot-proof": proof
    }
  });

  const payload = await second.json().catch(() => ({}));
  console.log(JSON.stringify(payload, null, 2));
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
