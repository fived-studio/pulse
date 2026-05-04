import { Hono } from "hono";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "~/db";
import { events, members } from "~/db/schema";

/**
 * GET /badge/:slug.svg
 *
 * Returns a Pulse-themed activity badge for a member's GitHub profile
 * README. Mirrors shields.io shape (label · value), but rendered to match
 * the FiveD design system (carbon-black + signal-green).
 *
 *   /badge/:login.svg                      → "FiveD Pulse · 24 events / 30d"
 *
 * Cached at the edge for 5 minutes so README badge images don't hammer
 * the API every time GitHub fetches them.
 */
export const badgeRoute = new Hono().get("/:slug", async (c) => {
  const slugParam = c.req.param("slug");
  const slug = slugParam.endsWith(".svg") ? slugParam.slice(0, -4) : slugParam;

  const [m] = await db
    .select({ id: members.id, login: members.githubLogin, name: members.displayName })
    .from(members)
    .where(eq(members.githubLogin, slug));

  if (!m) {
    return new Response(renderUnknown(slug), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.memberId, m.id), gte(events.occurredAt, since)));

  const total = row?.total ?? 0;
  const value = `${total} event${total === 1 ? "" : "s"} / 30d`;

  return new Response(renderBadge(m.login, value), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
});

const PULSE_GREEN = "#00d992";
const SURFACE = "#101010";
const BORDER = "#3d3a39";
const TEXT = "#f2f2f2";
const TEXT_DIM = "#b8b3b0";

// approximate text width for SF Mono / Inter at 11px — close enough for layout
const CHAR = 6.4;

function renderBadge(login: string, value: string): string {
  const label = `pulse · @${login}`;
  const labelW = Math.ceil(label.length * CHAR + 22);
  const valueW = Math.ceil(value.length * CHAR + 22);
  const total = labelW + valueW;
  const h = 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${h}" viewBox="0 0 ${total} ${h}" role="img" aria-label="${escape(label)}: ${escape(value)}">
  <title>${escape(label)}: ${escape(value)}</title>
  <rect width="${total}" height="${h}" rx="4" fill="${SURFACE}"/>
  <rect x="${labelW}" width="${valueW}" height="${h}" rx="4" fill="${SURFACE}"/>
  <rect x="${labelW - 0.5}" width="1" height="${h}" fill="${BORDER}"/>
  <rect width="${total}" height="${h}" rx="4" fill="none" stroke="${BORDER}" stroke-width="1"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11" font-weight="500">
    <circle cx="11" cy="${h / 2}" r="3" fill="${PULSE_GREEN}">
      <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
    </circle>
    <text x="20" y="15" fill="${TEXT_DIM}">${escape(label)}</text>
    <text x="${labelW + 11}" y="15" fill="${TEXT}" font-weight="600">${escape(value)}</text>
  </g>
</svg>`;
}

function renderUnknown(slug: string): string {
  const label = "pulse";
  const value = `unknown @${slug}`;
  return renderBadge(label, value);
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
