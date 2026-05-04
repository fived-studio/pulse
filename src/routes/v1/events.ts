import { Hono } from "hono";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "~/db";
import { events, members, repos } from "~/db/schema";

export const eventsRoute = new Hono().get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const before = c.req.query("before");
  const memberLogin = c.req.query("member");

  let memberId: string | undefined;
  if (memberLogin) {
    const [m] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.githubLogin, memberLogin));
    if (!m) return c.json({ data: [], nextBefore: null });
    memberId = m.id;
  }

  const conds = [
    before ? lt(events.occurredAt, new Date(before)) : undefined,
    memberId ? eq(events.memberId, memberId) : undefined,
  ].filter((v): v is NonNullable<typeof v> => v !== undefined);

  const rows = await db
    .select({
      id: events.id,
      type: events.eventType,
      summary: events.summary,
      occurredAt: events.occurredAt,
      memberId: events.memberId,
      memberLogin: members.githubLogin,
      repoId: events.repoId,
      repoFullName: repos.fullName,
    })
    .from(events)
    .leftJoin(members, eq(events.memberId, members.id))
    .leftJoin(repos, eq(events.repoId, repos.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(events.occurredAt))
    .limit(limit);

  return c.json({
    data: rows,
    nextBefore: rows.length === limit ? rows[rows.length - 1]?.occurredAt : null,
  });
});
