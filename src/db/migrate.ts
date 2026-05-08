/**
 * Boot-time migrator. Called from src/index.ts before the HTTP server starts
 * so prod deploys converge to the latest schema without a separate ops step.
 *
 * Idempotent — drizzle keeps a __drizzle_migrations table on the target DB
 * and only applies SQL files newer than the highest hash there.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

export async function applyMigrations(): Promise<void> {
  const start = Date.now();
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log(`[migrate] up-to-date in ${Date.now() - start}ms`);
  } catch (err) {
    console.error("[migrate] failed", err);
    throw err;
  }
}
