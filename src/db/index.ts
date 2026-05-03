import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === "production" ? 10 : 4,
  prepare: false,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
