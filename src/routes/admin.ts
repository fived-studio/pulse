import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { sql } from "drizzle-orm";
import { db } from "~/db";
import { redis } from "~/lib/redis";
import { env } from "~/env";

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
  });
