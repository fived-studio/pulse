import { Hono } from "hono";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "~/db";
import { memberDaily, members } from "~/db/schema";

/**
 * GET /v1/heatmap?days=90&member=login
 *
 * Daily activity totals across the team or a single member, suitable for a
 * GitHub-style contribution heatmap. Each row is one day; missing days are
 * not returned (frontend fills gaps with 0s).
 */
export const heatmapRoute = new Hono().get("/", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 90), 365);
  const memberLogin = c.req.query("member");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let memberId: string | undefined;
  if (memberLogin) {
    const [m] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.githubLogin, memberLogin));
    if (!m) return c.json({ data: [] });
    memberId = m.id;
  }

  const conds = [
    gte(memberDaily.day, since),
    memberId ? eq(memberDaily.memberId, memberId) : undefined,
  ].filter((v): v is NonNullable<typeof v> => v !== undefined);

  const rows = await db
    .select({
      day: memberDaily.day,
      commits: sql<number>`sum(${memberDaily.commits})::int`,
      prsOpened: sql<number>`sum(${memberDaily.prsOpened})::int`,
      prsMerged: sql<number>`sum(${memberDaily.prsMerged})::int`,
      reviews: sql<number>`sum(${memberDaily.reviews})::int`,
    })
    .from(memberDaily)
    .where(and(...conds))
    .groupBy(memberDaily.day)
    .orderBy(memberDaily.day);

  return c.json({
    data: rows.map((r) => ({
      day: r.day,
      total: r.commits + r.prsOpened + r.prsMerged + r.reviews,
      commits: r.commits,
      prsOpened: r.prsOpened,
      prsMerged: r.prsMerged,
      reviews: r.reviews,
    })),
  });
});
