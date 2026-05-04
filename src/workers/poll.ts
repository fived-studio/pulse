/**
 * Polling worker — pulls each tracked member's public events from GitHub
 * and feeds anything new through the same ingest pipeline as webhooks.
 *
 * Filters out events from `${FIVED_ORG}/*` repos because the org's GitHub
 * App webhook already covers those — no need to ingest twice.
 *
 * Runs inside the main Cloud Run service. Mutual exclusion across instances
 * is enforced with a Redis SETNX lock so scaling beyond 1 instance doesn't
 * fan out duplicate ingestions.
 */

import type { Octokit } from "@octokit/rest";
import { db } from "~/db";
import { members } from "~/db/schema";
import { redis } from "~/lib/redis";
import { getInstallationOctokit } from "~/lib/github";
import { ingestPolledEvent } from "~/ingest/from-poll";
import { env } from "~/env";

const INTERVAL_MS = 60_000;
const LOCK_KEY = "pulse:poll:lock";
const LOCK_TTL_S = 90;
const SEEN_KEY = (login: string) => `pulse:poll:lastSeen:${login}`;
const ORG_PREFIX = `${env.FIVED_ORG}/`;

let started = false;

export function startPoller() {
  if (started) return;
  started = true;
  console.log("[poll] worker armed");

  // first tick after a 5s warmup so the rest of the app finishes booting
  setTimeout(tick, 5_000);
  setInterval(tick, INTERVAL_MS);
}

async function tick() {
  const lockId = crypto.randomUUID();
  const acquired = await redis.set(LOCK_KEY, lockId, "EX", LOCK_TTL_S, "NX");
  if (!acquired) return; // another instance owns the tick

  const start = Date.now();
  try {
    const octokit = await getInstallationOctokit();
    if (!octokit) return; // App credentials not configured — skip silently

    const tracked = await db.select().from(members);
    let total = 0;
    for (const m of tracked) {
      try {
        total += await pollMember(m.githubLogin, octokit);
      } catch (err) {
        console.error("[poll] member failed", { login: m.githubLogin, err: String(err) });
      }
    }
    console.log("[poll] tick complete", {
      members: tracked.length,
      ingested: total,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    console.error("[poll] tick failed", err);
  } finally {
    const cur = await redis.get(LOCK_KEY);
    if (cur === lockId) await redis.del(LOCK_KEY);
  }
}

async function pollMember(login: string, octokit: Octokit): Promise<number> {
  const lastSeenIso = await redis.get(SEEN_KEY(login));
  const lastSeen = lastSeenIso
    ? new Date(lastSeenIso)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // first run: backfill 7 days

  const { data } = await octokit.request("GET /users/{username}/events/public", {
    username: login,
    per_page: 30,
  });

  let newest = lastSeen;
  let ingested = 0;
  for (const ev of data) {
    if (!ev.created_at) continue;
    const occurredAt = new Date(ev.created_at);
    if (occurredAt <= lastSeen) continue;
    if (ev.repo?.name?.startsWith(ORG_PREFIX)) continue; // webhook covers org repos

    await ingestPolledEvent(ev as Parameters<typeof ingestPolledEvent>[0], login);
    ingested++;
    if (occurredAt > newest) newest = occurredAt;
  }

  if (newest > lastSeen) {
    await redis.set(SEEN_KEY(login), newest.toISOString());
  }
  return ingested;
}
