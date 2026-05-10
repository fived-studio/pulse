import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8787"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),

  ADMIN_PASSWORD: z.string().optional(),

  FIVED_ORG: z.string().default("fived-studio"),

  // LeetCode poller — interval in minutes; 0 disables.
  LEETCODE_POLL_INTERVAL_MIN: z.coerce.number().min(0).default(360),

  // Number of past years of submission calendar to fetch. LeetCode's
  // userCalendar query is per-year, so this maps directly to N HTTP calls
  // per refresh. 3 = current + 2 prior, balanced against rate-limit budget.
  LEETCODE_CALENDAR_YEARS: z.coerce.number().min(1).max(8).default(3),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
