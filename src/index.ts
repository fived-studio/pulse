import { app } from "./server";
import { env } from "./env";
import { applyMigrations } from "./db/migrate";
import { startPoller } from "./workers/poll";
import { startLeetcodePoller } from "./workers/leetcode-poll";

await applyMigrations();

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 60,
});

startPoller();
if (env.LEETCODE_POLL_INTERVAL_MIN > 0) startLeetcodePoller();

console.log(`▲ Pulse listening on ${server.url}`);
console.log(`  health: ${server.url}admin/health`);
console.log(`  events: ${server.url}v1/events`);
console.log(`  stream: ${server.url}v1/stream/events`);

const shutdown = (sig: string) => {
  console.log(`\n[server] received ${sig}, shutting down`);
  server.stop();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
