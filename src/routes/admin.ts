import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { sql, eq } from "drizzle-orm";
import { db } from "~/db";
import { redis, STREAM_KEY } from "~/lib/redis";
import { env } from "~/env";
import { events, leetcodeStats, members, repos } from "~/db/schema";
import { tick as leetcodeTick, refreshOne as leetcodeRefreshOne } from "~/workers/leetcode-poll";
import { LeetcodeNotFoundError } from "~/lib/leetcode";

const FIVED_MEMBERS = [
  { githubLogin: "hgbaooo", displayName: "Huỳnh Gia Bảo", role: "Fullstack Engineer", leetcodeHandle: "hgbaooo" },
  { githubLogin: "nquynqthanq", displayName: "Nguyễn Quốc Thắng", role: "Frontend · UI/UX", leetcodeHandle: "nguyqthanq" },
  { githubLogin: "thvnhtai", displayName: "Nguyễn Thành Tài", role: "Frontend · UI/UX", leetcodeHandle: "thvnhtai" },
  { githubLogin: "sloweyyy", displayName: "Trương Lê Vĩnh Phúc", role: "Product · DevOps · Fullstack", leetcodeHandle: "slowey" },
  { githubLogin: "TrTueTah", displayName: "Trần Tuệ Tánh", role: "Fullstack Engineer", leetcodeHandle: "tanhdeptrai113" },
];

export const adminRoute = new Hono()
  .use("*", async (c, next) => {
    if (c.req.path === "/admin/health") return next();
    if (!env.ADMIN_PASSWORD) {
      return c.json({ error: "admin_disabled" }, 503);
    }
    return basicAuth({ username: "admin", password: env.ADMIN_PASSWORD })(c, next);
  })
  .get("/health", async (c) => {
    const [{ now } = { now: null }] = (await db.execute(sql`select now()`)) as Array<{
      now: string;
    }>;
    let redisOk = false;
    try {
      redisOk = (await redis.ping()) === "PONG";
    } catch {}
    return c.json({ ok: true, db: now, redis: redisOk });
  })
  .get("/metrics", async (c) => {
    const [counts] = (await db.execute(
      sql`select
        (select count(*) from members)::int as members,
        (select count(*) from repos)::int as repos,
        (select count(*) from events)::int as events`,
    )) as Array<{ members: number; repos: number; events: number }>;
    return c.json({ ok: true, counts });
  })
  .post("/seed", async (c) => {
    const upserted = await db
      .insert(members)
      .values(
        FIVED_MEMBERS.map((m, i) => ({
          githubId: 1_000_000 + i,
          githubLogin: m.githubLogin,
          displayName: m.displayName,
          role: m.role,
          avatarUrl: `https://github.com/${m.githubLogin}.png`,
          leetcodeHandle: m.leetcodeHandle,
        })),
      )
      .onConflictDoUpdate({
        target: members.githubLogin,
        // backfill leetcode handles on existing rows; don't clobber other fields
        set: { leetcodeHandle: sql`excluded.leetcode_handle` },
      })
      .returning({ login: members.githubLogin, leetcodeHandle: members.leetcodeHandle });
    return c.json({ ok: true, members: upserted });
  })
  .post("/test-event", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      login?: string;
      type?: string;
      summary?: string;
      repo?: string;
    };
    const login = body.login ?? "sloweyyy";
    const type = body.type ?? "push";
    const repoName = body.repo ?? "fived-studio/pulse";
    const summary = body.summary ?? `pushed a test event to ${repoName}`;

    const [member] = await db.select().from(members).where(eq(members.githubLogin, login));
    if (!member) return c.json({ error: "member_not_found", hint: "POST /admin/seed first" }, 404);

    // Use a deterministic fake id derived from the repo name so re-runs don't
    // pile up bogus rows. Real github IDs fit in 32-bit; we pick from 2^31+.
    let hash = 2_147_483_648;
    for (const ch of repoName) hash = ((hash * 31 + ch.charCodeAt(0)) >>> 0) + 2_147_483_648;
    const [repo] = await db
      .insert(repos)
      .values({
        githubId: hash,
        fullName: repoName,
        isFivedOwned: repoName.startsWith("fived-studio/"),
        isMemberOwned: !repoName.startsWith("fived-studio/"),
        lastActiveAt: new Date(),
      })
      .onConflictDoUpdate({
        target: repos.fullName,
        set: { lastActiveAt: new Date() },
      })
      .returning();

    const occurredAt = new Date();
    const [row] = await db
      .insert(events)
      .values({
        deliveryId: `test-${crypto.randomUUID()}`,
        source: "webhook",
        eventType: type,
        memberId: member.id,
        repoId: repo!.id,
        occurredAt,
        payload: { test: true, body },
        summary,
      })
      .returning();

    await redis.xadd(
      STREAM_KEY,
      "*",
      "member",
      login,
      "type",
      type,
      "repo",
      repoName,
      "summary",
      summary,
      "occurredAt",
      occurredAt.toISOString(),
    );

    return c.json({ ok: true, event: row });
  })
  .post("/members/:login/leetcode", async (c) => {
    const login = c.req.param("login");
    const body = (await c.req.json().catch(() => ({}))) as { handle?: string | null };
    const handle = body.handle?.trim() || null;

    const [updated] = await db
      .update(members)
      .set({ leetcodeHandle: handle })
      .where(eq(members.githubLogin, login))
      .returning({ id: members.id, login: members.githubLogin, handle: members.leetcodeHandle });
    if (!updated) return c.json({ error: "member_not_found" }, 404);

    if (handle === null) {
      // clearing — drop any cached stats so the leaderboard hides them
      await db.delete(leetcodeStats).where(eq(leetcodeStats.memberId, updated.id));
      return c.json({ ok: true, login, handle: null });
    }

    // refresh now so the leaderboard sees them immediately
    try {
      await leetcodeRefreshOne(updated.id, handle);
      return c.json({ ok: true, login, handle, refreshed: true });
    } catch (err) {
      if (err instanceof LeetcodeNotFoundError) {
        return c.json({ ok: false, login, handle, error: "leetcode_user_not_found" }, 400);
      }
      console.error("[admin] leetcode refresh failed", err);
      return c.json({ ok: true, login, handle, refreshed: false, error: String(err) });
    }
  })
  .post("/leetcode/refresh", async (c) => {
    const login = c.req.query("login");
    if (login) {
      const [m] = await db
        .select({ id: members.id, handle: members.leetcodeHandle })
        .from(members)
        .where(eq(members.githubLogin, login));
      if (!m) return c.json({ error: "member_not_found" }, 404);
      if (!m.handle) return c.json({ error: "no_leetcode_handle" }, 400);
      try {
        await leetcodeRefreshOne(m.id, m.handle);
        return c.json({ ok: true, login, refreshed: 1 });
      } catch (err) {
        return c.json({ ok: false, login, error: String(err) }, 500);
      }
    }
    const summary = await leetcodeTick();
    return c.json({ ok: true, summary });
  });
