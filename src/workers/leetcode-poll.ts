/**
 * LeetCode polling worker — refreshes per-member stats from leetcode.com/graphql.
 *
 * Runs in-process alongside the GitHub poller. Mutual exclusion across Cloud
 * Run instances via Redis SETNX, same shape as workers/poll.ts. Members
 * without a leetcodeHandle are skipped.
 *
 * Default cadence: every 6 hours. Profile/solved counts don't change minute
 * by minute, and the upstream is a public service — be a good citizen.
 */

import { isNotNull } from "drizzle-orm";
import { db } from "~/db";
import { leetcodeStats, members } from "~/db/schema";
import { redis } from "~/lib/redis";
import { fetchLeetcodeSnapshot, LeetcodeNotFoundError } from "~/lib/leetcode";
import { env } from "~/env";

const LOCK_KEY = "pulse:leetcode:lock";
const LOCK_TTL_S = 30 * 60; // long, since a tick can take minutes
const REQUEST_GAP_MS = 1_500; // pace requests to ~40/min, well under upstream tolerance

let started = false;

export function startLeetcodePoller() {
  if (started) return;
  started = true;
  const intervalMin = env.LEETCODE_POLL_INTERVAL_MIN;
  console.log("[leetcode] worker armed", { intervalMin });

  // first tick after a 15s warmup so the rest of the app finishes booting
  setTimeout(tick, 15_000);
  setInterval(tick, intervalMin * 60_000);
}

export async function tick(): Promise<{
  attempted: number;
  ok: number;
  notFound: number;
  failed: number;
  durationMs: number;
}> {
  const lockId = crypto.randomUUID();
  const acquired = await redis.set(LOCK_KEY, lockId, "EX", LOCK_TTL_S, "NX");
  if (!acquired) {
    console.log("[leetcode] tick skipped — another instance owns the lock");
    return { attempted: 0, ok: 0, notFound: 0, failed: 0, durationMs: 0 };
  }

  const start = Date.now();
  const summary = { attempted: 0, ok: 0, notFound: 0, failed: 0, durationMs: 0 };

  try {
    const tracked = await db
      .select({ id: members.id, handle: members.leetcodeHandle, login: members.githubLogin })
      .from(members)
      .where(isNotNull(members.leetcodeHandle));

    for (const m of tracked) {
      if (!m.handle) continue;
      summary.attempted++;
      try {
        await refreshOne(m.id, m.handle);
        summary.ok++;
      } catch (err) {
        if (err instanceof LeetcodeNotFoundError) {
          summary.notFound++;
          await db
            .insert(leetcodeStats)
            .values({
              memberId: m.id,
              handle: m.handle,
              lastError: "user not found on leetcode",
            })
            .onConflictDoUpdate({
              target: leetcodeStats.memberId,
              set: { handle: m.handle, lastError: "user not found on leetcode", fetchedAt: new Date() },
            });
        } else {
          summary.failed++;
          console.error("[leetcode] member failed", { login: m.login, handle: m.handle, err: String(err) });
        }
      }
      await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
    }

    summary.durationMs = Date.now() - start;
    console.log("[leetcode] tick complete", summary);
    return summary;
  } catch (err) {
    console.error("[leetcode] tick failed", err);
    summary.durationMs = Date.now() - start;
    return summary;
  } finally {
    const cur = await redis.get(LOCK_KEY);
    if (cur === lockId) await redis.del(LOCK_KEY);
  }
}

export async function refreshOne(memberId: string, handle: string): Promise<void> {
  const snap = await fetchLeetcodeSnapshot(handle);
  await db
    .insert(leetcodeStats)
    .values({
      memberId,
      handle: snap.handle,
      totalSolved: snap.totalSolved,
      easySolved: snap.easySolved,
      mediumSolved: snap.mediumSolved,
      hardSolved: snap.hardSolved,
      totalEasy: snap.totalEasy,
      totalMedium: snap.totalMedium,
      totalHard: snap.totalHard,
      ranking: snap.ranking,
      reputation: snap.reputation,
      contestRating: snap.contestRating,
      contestGlobalRanking: snap.contestGlobalRanking,
      contestAttended: snap.contestAttended,
      streak: snap.streak,
      totalActiveDays: snap.totalActiveDays,
      submissionCalendar: snap.submissionCalendar,
      languageStats: snap.languageStats,
      badges: snap.badges,
      fetchedAt: new Date(),
      lastError: null,
    })
    .onConflictDoUpdate({
      target: leetcodeStats.memberId,
      set: {
        handle: snap.handle,
        totalSolved: snap.totalSolved,
        easySolved: snap.easySolved,
        mediumSolved: snap.mediumSolved,
        hardSolved: snap.hardSolved,
        totalEasy: snap.totalEasy,
        totalMedium: snap.totalMedium,
        totalHard: snap.totalHard,
        ranking: snap.ranking,
        reputation: snap.reputation,
        contestRating: snap.contestRating,
        contestGlobalRanking: snap.contestGlobalRanking,
        contestAttended: snap.contestAttended,
        streak: snap.streak,
        totalActiveDays: snap.totalActiveDays,
        submissionCalendar: snap.submissionCalendar,
        languageStats: snap.languageStats,
        fetchedAt: new Date(),
        lastError: null,
      },
    });
}
