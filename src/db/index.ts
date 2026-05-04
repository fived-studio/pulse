import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import * as schema from "./schema";

const max = env.NODE_ENV === "production" ? 10 : 4;

function buildClient() {
  const url = env.DATABASE_URL;
  // Cloud SQL Unix socket form: "postgres://user:pass@localhost/db?host=/cloudsql/PROJECT:REGION:INSTANCE"
  // postgres-js ignores libpq's ?host= query param, so detect and pass it as an option.
  const socketMatch = url.match(/[?&]host=([^&]+)/);
  if (socketMatch && socketMatch[1]?.startsWith("/")) {
    const parsed = new URL(url);
    return postgres({
      host: decodeURIComponent(socketMatch[1]),
      database: parsed.pathname.replace(/^\//, ""),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      max,
      prepare: false,
    });
  }
  return postgres(url, { max, prepare: false });
}

const client = buildClient();

export const db = drizzle(client, { schema });
export type DB = typeof db;
