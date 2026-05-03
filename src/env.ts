import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8787"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),

  ADMIN_PASSWORD: z.string().optional(),

  FIVED_ORG: z.string().default("fived-studio"),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
