import { Hono } from "hono";
import { attachSSE } from "~/lib/sse";

export const streamRoute = new Hono().get("/events", (c) => {
  const member = c.req.query("member") ?? undefined;
  return attachSSE(c, member);
});
