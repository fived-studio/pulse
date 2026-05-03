import { Hono } from "hono";
import { Webhooks } from "@octokit/webhooks";
import { env } from "~/env";
import { ingestEvent } from "~/ingest/from-webhook";

const secret = env.GITHUB_APP_WEBHOOK_SECRET ?? "dev-webhook-secret";
const webhooks = new Webhooks({ secret });

webhooks.onAny(async ({ id, name, payload }) => {
  await ingestEvent({ deliveryId: id, name, payload });
});

export const githubWebhookRoute = new Hono().post("/", async (c) => {
  const sig = c.req.header("x-hub-signature-256") ?? "";
  const id = c.req.header("x-github-delivery") ?? "";
  const name = c.req.header("x-github-event") ?? "";
  const body = await c.req.text();

  if (!(await webhooks.verify(body, sig))) {
    return c.json({ error: "invalid_signature" }, 401);
  }

  try {
    await webhooks.receive({ id, name: name as never, payload: JSON.parse(body) });
  } catch (err) {
    console.error("[webhook] receive error", err);
    return c.json({ error: "ingest_failed" }, 500);
  }

  return c.json({ ok: true });
});
