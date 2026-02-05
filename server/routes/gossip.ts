import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getMarketHistory, registerMarketStream, safeJson } from "../utils/marketEvents";
import type { Bindings, MarketEvent } from "../utils/types";
import { GOSSIP_ROOM } from "../utils/gossip";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/v1/gossip/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    registerMarketStream(GOSSIP_ROOM, stream);

    const connectedEvent: MarketEvent = {
      type: "system",
      room: GOSSIP_ROOM,
      payload: { message: "gossip_connected" },
      created_at: new Date().toISOString()
    };

    await stream.writeSSE({
      event: connectedEvent.type,
      data: JSON.stringify(connectedEvent)
    });

    const history = await getMarketHistory(c.env, GOSSIP_ROOM, 50);
    if (history.length > 0) {
      const historyEvent: MarketEvent = {
        type: "history",
        room: GOSSIP_ROOM,
        payload: {
          events: history.map(({ event, id }) => ({ ...event, id }))
        },
        created_at: new Date().toISOString()
      };

      await stream.writeSSE({
        event: historyEvent.type,
        data: JSON.stringify(historyEvent)
      });
    }

    let lastSeenId =
      history.length > 0
        ? history[history.length - 1].id
        : Number(
            (await c.env.DB.prepare("SELECT id FROM system_events ORDER BY id DESC LIMIT 1").first())
              ?.id ?? 0
          );

    while (!stream.aborted && !stream.closed) {
      const { results } = await c.env.DB.prepare(
        "SELECT id, payload FROM system_events WHERE id > ? AND json_extract(payload, '$.room') = ? ORDER BY id ASC LIMIT 100"
      )
        .bind(lastSeenId, GOSSIP_ROOM)
        .all();

      if (!results || results.length === 0) {
        await stream.sleep(5000);
        continue;
      }

      for (const row of results) {
        lastSeenId = Number(row?.id ?? lastSeenId);
        const parsed = typeof row?.payload === "string" ? safeJson(row.payload) : row?.payload;
        if (!parsed || parsed.room !== GOSSIP_ROOM) {
          continue;
        }

        const eventPayload = { ...parsed, id: lastSeenId };

        await stream.writeSSE({
          event: parsed.type,
          data: JSON.stringify(eventPayload),
          id: String(lastSeenId)
        });
      }
    }
  });
});

export default app;
