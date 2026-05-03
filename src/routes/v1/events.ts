import { Hono } from "hono";
import { desc, lt } from "drizzle-orm";
import { db } from "~/db";
import { events } from "~/db/schema";

export const eventsRoute = new Hono().get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const before = c.req.query("before");

  const where = before ? lt(events.occurredAt, new Date(before)) : undefined;

  const rows = await db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.occurredAt))
    .limit(limit);

  return c.json({
    data: rows.map((e) => ({
      id: e.id,
      type: e.eventType,
      summary: e.summary,
      occurredAt: e.occurredAt,
      memberId: e.memberId,
      repoId: e.repoId,
    })),
    nextBefore: rows.length === limit ? rows[rows.length - 1]?.occurredAt : null,
  });
});
