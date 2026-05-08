import { Hono } from "hono";
import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import { leetcodeStats, members } from "~/db/schema";
import { weightedScore } from "~/lib/leetcode";

type SortKey = "weighted" | "total" | "ranking" | "contest";

export const leetcodeRoute = new Hono()
  .get("/leaderboard", async (c) => {
    const sort = (c.req.query("sort") ?? "weighted") as SortKey;
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

    const weighted = sql<number>`(
      ${leetcodeStats.easySolved} * 1 +
      ${leetcodeStats.mediumSolved} * 2 +
      ${leetcodeStats.hardSolved} * 4
    )::int`;

    const orderBy = (() => {
      switch (sort) {
        case "total":
          return desc(leetcodeStats.totalSolved);
        case "ranking":
          // lower is better; nulls last
          return asc(sql`${leetcodeStats.ranking} nulls last`);
        case "contest":
          return desc(sql`${leetcodeStats.contestRating} nulls last`);
        case "weighted":
        default:
          return desc(weighted);
      }
    })();

    const rows = await db
      .select({
        login: members.githubLogin,
        displayName: members.displayName,
        avatar: members.avatarUrl,
        handle: leetcodeStats.handle,
        totalSolved: leetcodeStats.totalSolved,
        easy: leetcodeStats.easySolved,
        medium: leetcodeStats.mediumSolved,
        hard: leetcodeStats.hardSolved,
        ranking: leetcodeStats.ranking,
        contestRating: leetcodeStats.contestRating,
        contestAttended: leetcodeStats.contestAttended,
        streak: leetcodeStats.streak,
        totalActiveDays: leetcodeStats.totalActiveDays,
        weighted,
        fetchedAt: leetcodeStats.fetchedAt,
        lastError: leetcodeStats.lastError,
      })
      .from(leetcodeStats)
      .innerJoin(members, eq(members.id, leetcodeStats.memberId))
      .where(isNotNull(members.leetcodeHandle))
      .orderBy(orderBy)
      .limit(limit);

    return c.json({
      data: {
        sort,
        count: rows.length,
        leaderboard: rows.map((r, i) => ({ rank: i + 1, ...r })),
      },
    });
  })
  .get("/:login", async (c) => {
    const login = c.req.param("login");
    const [row] = await db
      .select({
        login: members.githubLogin,
        displayName: members.displayName,
        avatar: members.avatarUrl,
        handle: leetcodeStats.handle,
        totalSolved: leetcodeStats.totalSolved,
        easy: leetcodeStats.easySolved,
        medium: leetcodeStats.mediumSolved,
        hard: leetcodeStats.hardSolved,
        totalEasy: leetcodeStats.totalEasy,
        totalMedium: leetcodeStats.totalMedium,
        totalHard: leetcodeStats.totalHard,
        ranking: leetcodeStats.ranking,
        reputation: leetcodeStats.reputation,
        contestRating: leetcodeStats.contestRating,
        contestGlobalRanking: leetcodeStats.contestGlobalRanking,
        contestAttended: leetcodeStats.contestAttended,
        streak: leetcodeStats.streak,
        totalActiveDays: leetcodeStats.totalActiveDays,
        submissionCalendar: leetcodeStats.submissionCalendar,
        languageStats: leetcodeStats.languageStats,
        fetchedAt: leetcodeStats.fetchedAt,
        lastError: leetcodeStats.lastError,
      })
      .from(members)
      .leftJoin(leetcodeStats, eq(leetcodeStats.memberId, members.id))
      .where(eq(members.githubLogin, login));

    if (!row) return c.json({ error: "member_not_found" }, 404);
    if (!row.handle) return c.json({ error: "no_leetcode_handle", login }, 404);

    const weighted = weightedScore({ easySolved: row.easy ?? 0, mediumSolved: row.medium ?? 0, hardSolved: row.hard ?? 0 });
    return c.json({ data: { ...row, weighted } });
  });
