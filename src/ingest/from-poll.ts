import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { events, memberDaily, members, repos } from "~/db/schema";
import { redis, STREAM_KEY } from "~/lib/redis";

type GhEvent = {
  id: string;
  type: string | null;
  actor: { login: string } | null;
  repo: { id: number; name: string } | null;
  created_at: string | null;
  payload: Record<string, unknown>;
};

/**
 * Ingest one event from GitHub's `/users/:login/events/public` API. Mirrors
 * the webhook ingest pipeline: upsert repo, persist event row, bump daily
 * rollup, broadcast on the live SSE stream.
 *
 * The GitHub events API uses a different payload shape than webhooks, so
 * the normalize step is its own switch — same return type as the webhook
 * normalizer.
 */
export async function ingestPolledEvent(ev: GhEvent, memberLogin: string) {
  if (!ev.id || !ev.type || !ev.repo || !ev.created_at) return;
  const repoFullName = ev.repo.name;
  const repoGithubId = ev.repo.id;

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.githubLogin, memberLogin));
  if (!member) return;

  const [repo] = await db
    .insert(repos)
    .values({
      githubId: repoGithubId,
      fullName: repoFullName,
      isFivedOwned: repoFullName.startsWith("fived-studio/"),
      isMemberOwned: !repoFullName.startsWith("fived-studio/"),
      lastActiveAt: new Date(ev.created_at),
    })
    .onConflictDoUpdate({
      target: repos.fullName,
      set: { githubId: repoGithubId, lastActiveAt: new Date(ev.created_at) },
    })
    .returning();
  if (!repo) return;

  const norm = normalizePolled(ev, repoFullName);
  if (!norm.eventType) return;

  const [row] = await db
    .insert(events)
    .values({
      deliveryId: `poll-${ev.id}`,
      source: "poll",
      eventType: norm.eventType,
      memberId: member.id,
      repoId: repo.id,
      occurredAt: norm.occurredAt,
      payload: ev as unknown as Record<string, unknown>,
      summary: norm.summary,
    })
    .onConflictDoNothing({ target: events.deliveryId })
    .returning();

  if (!row) return; // already ingested

  // Daily rollup
  const day = norm.occurredAt.toISOString().slice(0, 10);
  const delta = {
    prsOpened: norm.eventType === "pr_opened" ? 1 : 0,
    prsMerged: norm.eventType === "pr_merged" ? 1 : 0,
    commits: norm.eventType === "push" ? norm.commitCount : 0,
    reviews: norm.eventType === "pr_review" ? 1 : 0,
  };
  await db
    .insert(memberDaily)
    .values({ memberId: member.id, day, ...delta })
    .onConflictDoUpdate({
      target: [memberDaily.memberId, memberDaily.day],
      set: {
        prsOpened: sql`${memberDaily.prsOpened} + ${delta.prsOpened}`,
        prsMerged: sql`${memberDaily.prsMerged} + ${delta.prsMerged}`,
        commits: sql`${memberDaily.commits} + ${delta.commits}`,
        reviews: sql`${memberDaily.reviews} + ${delta.reviews}`,
      },
    });

  await redis.xadd(
    STREAM_KEY,
    "*",
    "member",
    memberLogin,
    "type",
    norm.eventType,
    "repo",
    repoFullName,
    "summary",
    norm.summary,
    "occurredAt",
    norm.occurredAt.toISOString(),
  );
}

function normalizePolled(ev: GhEvent, repoFullName: string) {
  const occurredAt = new Date(ev.created_at!);
  const p = ev.payload as Record<string, unknown>;
  switch (ev.type) {
    case "PushEvent": {
      const ref = String(p.ref ?? "").replace("refs/heads/", "") || "?";
      // GitHub's events API truncates the commits array but reports the real
      // count in distinct_size / size. Prefer those.
      const distinct = Number(p.distinct_size ?? 0);
      const size = Number(p.size ?? 0);
      const arr = (p.commits as unknown[]) ?? [];
      const n = distinct || size || arr.length;
      // 0-commit pushes are branch deletes (after = 000…) or no-op
      // force-pushes that didn't change the tip — neither is interesting
      // activity, drop them so the feed isn't full of "0 commits pushed".
      if (n === 0) {
        return { eventType: null as string | null, summary: "", occurredAt, commitCount: 0 };
      }
      return {
        eventType: "push",
        summary: `${n} commit${n === 1 ? "" : "s"} pushed to ${repoFullName} (${ref})`,
        occurredAt,
        commitCount: n,
      };
    }
    case "PullRequestEvent": {
      const action = String(p.action ?? "");
      const pr = (p.pull_request ?? {}) as Record<string, unknown>;
      const num = pr.number;
      const title = String(pr.title ?? "");
      if (action === "opened")
        return {
          eventType: "pr_opened",
          summary: `opened PR #${num} in ${repoFullName}: ${title}`,
          occurredAt,
          commitCount: 0,
        };
      if (action === "closed" && pr.merged)
        return {
          eventType: "pr_merged",
          summary: `merged PR #${num} in ${repoFullName}: ${title}`,
          occurredAt,
          commitCount: 0,
        };
      if (action === "closed")
        return {
          eventType: "pr_closed",
          summary: `closed PR #${num} in ${repoFullName}`,
          occurredAt,
          commitCount: 0,
        };
      return { eventType: null as string | null, summary: "", occurredAt, commitCount: 0 };
    }
    case "PullRequestReviewEvent": {
      const pr = (p.pull_request ?? {}) as Record<string, unknown>;
      const review = (p.review ?? {}) as Record<string, unknown>;
      const num = pr.number;
      const state = String(review.state ?? "commented");
      return {
        eventType: "pr_review",
        summary: `reviewed PR #${num} in ${repoFullName} (${state})`,
        occurredAt,
        commitCount: 0,
      };
    }
    case "ReleaseEvent": {
      const release = (p.release ?? {}) as Record<string, unknown>;
      const tag = String(release.tag_name ?? "?");
      return {
        eventType: "release",
        summary: `released ${tag} in ${repoFullName}`,
        occurredAt,
        commitCount: 0,
      };
    }
    case "WatchEvent": {
      // The events API uses WatchEvent for stars
      return {
        eventType: "star_received",
        summary: `${repoFullName} got a star ⭐`,
        occurredAt,
        commitCount: 0,
      };
    }
    case "CreateEvent": {
      const refType = String(p.ref_type ?? "");
      const ref = String(p.ref ?? "");
      if (refType !== "branch" && refType !== "tag")
        return { eventType: null as string | null, summary: "", occurredAt, commitCount: 0 };
      return {
        eventType: "ref_created",
        summary: `created ${refType} ${ref} in ${repoFullName}`,
        occurredAt,
        commitCount: 0,
      };
    }
    default:
      return { eventType: null as string | null, summary: "", occurredAt, commitCount: 0 };
  }
}
