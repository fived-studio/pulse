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

type Subscriber = {
  stream: SSEStreamingApi;
  filterMember?: string;
};

const subscribers = new Set<Subscriber>();
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
  for (const sub of subscribers) {
    if (sub.filterMember && sub.filterMember !== ev.member) continue;
    try {
      await sub.stream.writeSSE({
        event: "pulse.event",
        id: ev.id,
        data: JSON.stringify(ev),
      });
    } catch {
      subscribers.delete(sub);
    }
  }
}

async function broadcastKeepAlive() {
  for (const sub of subscribers) {
    try {
      await sub.stream.writeSSE({ event: "ping", data: String(Date.now()) });
    } catch {
      subscribers.delete(sub);
    }
  }
}

export function attachSSE(c: Context, filterMember?: string) {
  startRedisPoller();
  return streamSSE(c, async (stream) => {
    const sub: Subscriber = { stream, filterMember };
    subscribers.add(sub);
    stream.onAbort(() => {
      subscribers.delete(sub);
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
