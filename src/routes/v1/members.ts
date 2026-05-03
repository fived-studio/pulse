import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "~/db";
import { members, events } from "~/db/schema";

export const membersRoute = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(members);
    return c.json({
      data: rows.map((m) => ({
        login: m.githubLogin,
        name: m.displayName,
        role: m.role,
        avatarUrl: m.avatarUrl,
      })),
    });
  })
  .get("/:login", async (c) => {
    const login = c.req.param("login");
    const [m] = await db.select().from(members).where(eq(members.githubLogin, login));
    if (!m) return c.json({ error: "not_found" }, 404);

    const recent = await db
      .select()
      .from(events)
      .where(eq(events.memberId, m.id))
      .orderBy(desc(events.occurredAt))
      .limit(20);

    return c.json({
      data: {
        login: m.githubLogin,
        name: m.displayName,
        role: m.role,
        avatarUrl: m.avatarUrl,
        joinedAt: m.joinedAt,
        recentEvents: recent.map((e) => ({
          id: e.id,
          type: e.eventType,
          summary: e.summary,
          occurredAt: e.occurredAt,
        })),
      },
    });
  })
  .get("/:login/events", async (c) => {
    const login = c.req.param("login");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const [m] = await db.select().from(members).where(eq(members.githubLogin, login));
    if (!m) return c.json({ error: "not_found" }, 404);

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.memberId, m.id))
      .orderBy(desc(events.occurredAt))
      .limit(limit);

    return c.json({
      data: rows.map((e) => ({
        id: e.id,
        type: e.eventType,
        summary: e.summary,
        occurredAt: e.occurredAt,
      })),
    });
  });
