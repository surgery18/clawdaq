import type { SSEStreamingApi } from "hono/streaming";
import type { Bindings, MarketEvent } from "./types";

const marketStreams = new Map<string, Set<SSEStreamingApi>>();

export const safeJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeMarketEventType = (rawType: string) => {
  if (!rawType) return "system";
  if (
    rawType === "ticker" ||
    rawType === "chat" ||
    rawType === "system" ||
    rawType === "trade" ||
    rawType === "refill" ||
    rawType === "history" ||
    rawType === "gossip" ||
    rawType === "news" ||
    rawType.startsWith("order_")
  ) {
    return rawType;
  }
  return "system";
};

export const registerMarketStream = (room: string, stream: SSEStreamingApi) => {
  let set = marketStreams.get(room);
  if (!set) {
    set = new Set();
    marketStreams.set(room, set);
  }
  set.add(stream);
  stream.onAbort(() => {
    set?.delete(stream);
    if (set && set.size === 0) {
      marketStreams.delete(room);
    }
  });
};

const broadcastMarketEvent = async (room: string, event: MarketEvent, eventId?: number) => {
  const streams = marketStreams.get(room);
  if (!streams || streams.size === 0) return;

  const payload = eventId ? { ...event, id: eventId } : event;
  const data = JSON.stringify(payload);

  for (const stream of Array.from(streams)) {
    try {
      await stream.writeSSE({
        event: event.type,
        data,
        id: eventId ? String(eventId) : undefined
      });
    } catch {
      streams.delete(stream);
    }
  }

  if (streams.size === 0) {
    marketStreams.delete(room);
  }
};

export const publishMarketEvent = async (
  env: Bindings,
  room: string,
  type: string,
  payload: Record<string, unknown>
) => {
  const event: MarketEvent = {
    type: normalizeMarketEventType(type),
    room,
    payload: payload ?? {},
    created_at: new Date().toISOString()
  };

  const serialized = JSON.stringify(event);
  const result = await env.DB.prepare(
    "INSERT INTO system_events (event_type, payload) VALUES (?, ?)"
  )
    .bind(event.type, serialized)
    .run();

  const eventId = Number(result?.meta?.last_row_id ?? 0);
  await broadcastMarketEvent(room, event, eventId || undefined);

  return { event, eventId };
};

export const getMarketHistory = async (env: Bindings, room: string, limit = 50) => {
  const { results } = await env.DB.prepare(
    "SELECT id, payload FROM system_events ORDER BY id DESC LIMIT 200"
  ).all();

  const history: Array<{ event: MarketEvent; id: number }> = [];

  for (const row of results ?? []) {
    const parsed = typeof row?.payload === "string" ? safeJson(row.payload) : row?.payload;
    if (!parsed || parsed.room !== room) {
      continue;
    }
    history.push({ event: parsed as MarketEvent, id: Number(row?.id ?? 0) });
    if (history.length >= limit) break;
  }

  return history.reverse();
};
