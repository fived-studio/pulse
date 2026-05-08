/**
 * Boot-time migrator. Called from src/index.ts before the HTTP server starts
 * so prod deploys converge to the latest schema without a separate ops step.
 *
 * Idempotent — drizzle keeps a __drizzle_migrations table on the target DB
 * and only applies SQL files newer than the highest hash there.
 *
 * Cloud Run can spin up multiple instances simultaneously on a deploy
 * (min-instances + revision rollout). Wrap the migrator in a Postgres
 * advisory lock so only one instance applies migrations at a time —
 * the others wait at the lock acquire, then read the already-applied
 * journal and no-op cheaply. Without this, two instances racing to
 * CREATE TABLE __drizzle_migrations one wins and the other crashes.
 */

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

// Random 64-bit-ish constant; just needs to be stable across deploys.
const MIGRATION_LOCK_KEY = 7283946391n;

export async function applyMigrations(): Promise<void> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      await migrate(db, { migrationsFolder: "./drizzle" });
      console.log(`[migrate] up-to-date in ${Date.now() - start}ms`);
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    }
  } catch (err) {
    console.error("[migrate] failed", err);
    throw err;
  }
}
