import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { membersRoute } from "~/routes/v1/members";
import { eventsRoute } from "~/routes/v1/events";
import { totalsRoute } from "~/routes/v1/totals";
import { heatmapRoute } from "~/routes/v1/heatmap";
import { leetcodeRoute } from "~/routes/v1/leetcode";
import { streamRoute } from "~/routes/v1/stream";
import { githubWebhookRoute } from "~/routes/webhook/github";
import { adminRoute } from "~/routes/admin";
import { badgeRoute } from "~/routes/badge";

export const app = new Hono();

app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "/v1/*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "OPTIONS"],
    maxAge: 600,
  }),
);

app.get("/", (c) =>
  c.json({
    name: "FiveD Pulse",
    version: "0.1.0",
    docs: "https://github.com/fived-studio/pulse",
  }),
);

app.route("/v1/members", membersRoute);
app.route("/v1/events", eventsRoute);
app.route("/v1/totals", totalsRoute);
app.route("/v1/heatmap", heatmapRoute);
app.route("/v1/leetcode", leetcodeRoute);
app.route("/v1/stream", streamRoute);
app.route("/webhook/github", githubWebhookRoute);
app.route("/admin", adminRoute);
app.route("/badge", badgeRoute);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("[server]", err);
  return c.json({ error: "internal_error" }, 500);
});
