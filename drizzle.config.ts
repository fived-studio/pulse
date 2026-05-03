import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://pulse:pulse@localhost:5432/pulse",
  },
  strict: true,
  verbose: true,
} satisfies Config;
