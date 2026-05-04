import { db } from "~/db";
import { events, members, repos } from "~/db/schema";
import { eq } from "drizzle-orm";
import { redis, STREAM_KEY } from "~/lib/redis";

type Args = {
  deliveryId: string;
  name: string;
  payload: any;
};

/**
 * Map a raw GitHub webhook into a normalized Pulse event row, persist it,
 * and fan it out to live subscribers via Redis stream.
 *
 * MVP coverage: push, pull_request (opened/closed/merged), pull_request_review,
 * release, star. Other events are accepted and stored as-is.
 */
export async function ingestEvent({ deliveryId, name, payload }: Args) {
  const actorLogin: string | undefined =
    payload?.sender?.login ??
    payload?.pusher?.name ??
    payload?.pull_request?.user?.login;

  const repoFullName: string | undefined = payload?.repository?.full_name;
  const repoGithubId: number | undefined = payload?.repository?.id;
  const repoLang: string | undefined = payload?.repository?.language;
  const repoStars: number | undefined = payload?.repository?.stargazers_count;

  if (!actorLogin || !repoFullName || !repoGithubId) {
    console.log("[ingest] dropped: missing fields", {
      name,
      deliveryId,
      actorLogin,
      repoFullName,
      repoGithubId,
    });
    return;
  }

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.githubLogin, actorLogin));
  if (!member) {
    console.log("[ingest] dropped: unknown member", {
      name,
      deliveryId,
      actorLogin,
      repoFullName,
    });
    return;
  }

  const [repo] = await db
    .insert(repos)
    .values({
      githubId: repoGithubId,
      fullName: repoFullName,
      isFivedOwned: repoFullName.startsWith("fived-studio/"),
      isMemberOwned: !repoFullName.startsWith("fived-studio/"),
      primaryLang: repoLang,
      stars: repoStars ?? 0,
      lastActiveAt: new Date(),
    })
    .onConflictDoUpdate({
      target: repos.githubId,
      set: {
        lastActiveAt: new Date(),
        ...(repoStars !== undefined ? { stars: repoStars } : {}),
        ...(repoLang ? { primaryLang: repoLang } : {}),
      },
    })
    .returning();

  const { eventType, summary, occurredAt } = normalize(name, payload, repoFullName);
  if (!eventType) {
    console.log("[ingest] dropped: unhandled event", {
      name,
      action: payload?.action,
      deliveryId,
      actorLogin,
      repoFullName,
    });
    return;
  }
  console.log("[ingest] accepted", { name, eventType, actorLogin, repoFullName, deliveryId });

  if (!repo) {
    return; // repo persistence failed — bail safely
  }

  const [row] = await db
    .insert(events)
    .values({
      deliveryId,
      source: "webhook",
      eventType,
      memberId: member.id,
      repoId: repo.id,
      occurredAt,
      payload,
      summary,
    })
    .onConflictDoNothing({ target: events.deliveryId })
    .returning();

  if (!row) return; // duplicate delivery, already ingested

  await redis.xadd(
    STREAM_KEY,
    "*",
    "member",
    actorLogin,
    "type",
    eventType,
    "repo",
    repoFullName,
    "summary",
    summary,
    "occurredAt",
    occurredAt.toISOString(),
  );
}

function normalize(
  name: string,
  payload: any,
  repoFullName: string,
): { eventType: string | null; summary: string; occurredAt: Date } {
  const now = new Date();
  switch (name) {
    case "push": {
      const ref = payload.ref?.replace("refs/heads/", "") ?? "?";
      const n = payload.commits?.length ?? 0;
      return {
        eventType: "push",
        summary: `${n} commit${n === 1 ? "" : "s"} pushed to ${repoFullName} (${ref})`,
        occurredAt: payload.head_commit?.timestamp
          ? new Date(payload.head_commit.timestamp)
          : now,
      };
    }
    case "pull_request": {
      const action = payload.action;
      const num = payload.pull_request?.number;
      const title = payload.pull_request?.title ?? "";
      if (action === "opened")
        return {
          eventType: "pr_opened",
          summary: `opened PR #${num} in ${repoFullName}: ${title}`,
          occurredAt: new Date(payload.pull_request.created_at),
        };
      if (action === "closed" && payload.pull_request.merged)
        return {
          eventType: "pr_merged",
          summary: `merged PR #${num} in ${repoFullName}: ${title}`,
          occurredAt: new Date(payload.pull_request.merged_at),
        };
      if (action === "closed")
        return {
          eventType: "pr_closed",
          summary: `closed PR #${num} in ${repoFullName}`,
          occurredAt: new Date(payload.pull_request.closed_at),
        };
      return { eventType: null, summary: "", occurredAt: now };
    }
    case "pull_request_review": {
      if (payload.action !== "submitted")
        return { eventType: null, summary: "", occurredAt: now };
      const num = payload.pull_request?.number;
      const state = payload.review?.state ?? "commented";
      return {
        eventType: "pr_review",
        summary: `reviewed PR #${num} in ${repoFullName} (${state})`,
        occurredAt: new Date(payload.review.submitted_at),
      };
    }
    case "release": {
      if (payload.action !== "published")
        return { eventType: null, summary: "", occurredAt: now };
      const tag = payload.release?.tag_name ?? "?";
      return {
        eventType: "release",
        summary: `released ${tag} in ${repoFullName}`,
        occurredAt: new Date(payload.release.published_at),
      };
    }
    case "star": {
      if (payload.action !== "created")
        return { eventType: null, summary: "", occurredAt: now };
      return {
        eventType: "star_received",
        summary: `${repoFullName} got a star ⭐`,
        occurredAt: now,
      };
    }
    default:
      return { eventType: null, summary: "", occurredAt: now };
  }
}
