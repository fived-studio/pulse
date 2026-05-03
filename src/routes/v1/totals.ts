import { Hono } from "hono";
import { sql, gte } from "drizzle-orm";
import { db } from "~/db";
import { events } from "~/db/schema";

export const totalsRoute = new Hono().get("/", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      prsMerged: sql<number>`count(*) filter (where ${events.eventType} = 'pr_merged')::int`,
      prsOpened: sql<number>`count(*) filter (where ${events.eventType} = 'pr_opened')::int`,
      reviews: sql<number>`count(*) filter (where ${events.eventType} = 'pr_review')::int`,
      pushes: sql<number>`count(*) filter (where ${events.eventType} = 'push')::int`,
      reposTouched: sql<number>`count(distinct ${events.repoId})::int`,
      activeMembers: sql<number>`count(distinct ${events.memberId})::int`,
    })
    .from(events)
    .where(gte(events.occurredAt, since));

  return c.json({
    data: {
      windowDays: days,
      since: since.toISOString(),
      ...row,
    },
  });
});
