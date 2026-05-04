import { Hono } from "hono";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "~/db";
import { events, members } from "~/db/schema";

export const totalsRoute = new Hono().get("/", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 365);
  const memberLogin = c.req.query("member");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let memberId: string | undefined;
  if (memberLogin) {
    const [m] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.githubLogin, memberLogin));
    if (!m) {
      return c.json({
        data: {
          windowDays: days,
          since: since.toISOString(),
          member: memberLogin,
          total: 0,
          prsMerged: 0,
          prsOpened: 0,
          reviews: 0,
          pushes: 0,
          reposTouched: 0,
          activeMembers: 0,
        },
      });
    }
    memberId = m.id;
  }

  const conds = [
    gte(events.occurredAt, since),
    memberId ? eq(events.memberId, memberId) : undefined,
  ].filter((v): v is NonNullable<typeof v> => v !== undefined);

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
    .where(and(...conds));

  return c.json({
    data: {
      windowDays: days,
      since: since.toISOString(),
      ...(memberLogin ? { member: memberLogin } : {}),
      ...row,
    },
  });
});
