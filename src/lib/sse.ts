import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import type { Context } from "hono";
import { subscriber, STREAM_KEY } from "./redis";

export type LiveEvent = {
  id: string;
  member: string;
  type: string;
  repo: string;
  summary: string;
  occurredAt: string;
};

const subscribers = new Set<SSEStreamingApi>();
let pollerStarted = false;

function startRedisPoller() {
  if (pollerStarted) return;
  pollerStarted = true;

  let lastId = "$";

  const loop = async () => {
    while (true) {
      try {
        const res = await subscriber.xread(
          "BLOCK",
          15_000,
          "STREAMS",
          STREAM_KEY,
          lastId,
        );
        if (!res) {
          await broadcastKeepAlive();
          continue;
        }
        for (const [, entries] of res) {
          for (const [id, fields] of entries) {
            lastId = id;
            const data = parseRedisFields(fields);
            await broadcast({ id, ...data } as LiveEvent);
          }
        }
      } catch (err) {
        console.error("[sse] redis read error", err);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  loop().catch((err) => console.error("[sse] poller crashed", err));
}

function parseRedisFields(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const k = fields[i];
    const v = fields[i + 1];
    if (k && v !== undefined) out[k] = v;
  }
  return out;
}

async function broadcast(ev: LiveEvent) {
  for (const s of subscribers) {
    try {
      await s.writeSSE({
        event: "pulse.event",
        id: ev.id,
        data: JSON.stringify(ev),
      });
    } catch {
      subscribers.delete(s);
    }
  }
}

async function broadcastKeepAlive() {
  for (const s of subscribers) {
    try {
      await s.writeSSE({ event: "ping", data: String(Date.now()) });
    } catch {
      subscribers.delete(s);
    }
  }
}

export function attachSSE(c: Context, filterMember?: string) {
  startRedisPoller();
  return streamSSE(c, async (stream) => {
    subscribers.add(stream);
    stream.onAbort(() => {
      subscribers.delete(stream);
    });

    await stream.writeSSE({
      event: "hello",
      data: JSON.stringify({ ok: true, filterMember: filterMember ?? null }),
    });

    while (!stream.aborted) {
      await stream.sleep(60_000);
    }
  });
}
