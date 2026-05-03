/**
 * Polling worker — fetches each tracked member's contributionsCollection from
 * GitHub GraphQL and emits any new events into the same pipeline as webhook
 * ingest. Runs every 60s.
 *
 * STUB: wired up to be runnable with `bun run src/workers/poll.ts`, but the
 * GraphQL query and diff logic are M2 work. This file exists so the layout
 * is right.
 */
import { db } from "~/db";
import { members } from "~/db/schema";
import { env } from "~/env";

const INTERVAL_MS = 60_000;

async function tick() {
  const tracked = await db.select().from(members);
  console.log(`[poll] tick: ${tracked.length} members in org=${env.FIVED_ORG}`);
  // TODO(M2): for each tracked member, run contributionsCollection query,
  //           diff against last seen, emit new events via ingestPolledEvent().
}

async function main() {
  console.log("[poll] worker starting");
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error("[poll] tick failed", err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

if (import.meta.main) {
  void main();
}
