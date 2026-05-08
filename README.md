<div align="center">

# Pulse

**The live engineering platform for [FiveD Studio](https://fived-studio.github.io).**

Ingests GitHub webhooks across the studio's repos, normalizes them into a
Postgres event stream, and fans them out to clients in real time over SSE.

[![Bun](https://img.shields.io/badge/Bun-1.3-000?style=flat-square&logo=bun&logoColor=fbf0df)](https://bun.sh)
[![Hono](https://img.shields.io/badge/Hono-4-ff5722?style=flat-square)](https://hono.dev)
[![Postgres](https://img.shields.io/badge/Postgres-16-336791?style=flat-square&logo=postgresql&logoColor=fff)](https://www.postgresql.org)
[![Cloud Run](https://img.shields.io/badge/Cloud%20Run-deployed-4285f4?style=flat-square&logo=googlecloud&logoColor=fff)](https://cloud.google.com/run)

</div>

## What it does

GitHub webhooks land at `POST /webhook/github`, get HMAC-verified, and flow
through a single ingest pipeline:

```
GitHub App webhook ─► HMAC verify ─► normalize ─► Postgres (events)
                                              ╰─► Redis stream ─► SSE clients
                                              ╰─► daily rollup (member_daily)
```

The same shape works for both organisation events (today) and per-member
contributions polled from the GitHub GraphQL API (next).

## Highlights

- **Real-time fan-out.** A Redis stream backs SSE so multiple Cloud Run instances broadcast consistently and reconnecting clients catch up cleanly.
- **Idempotent ingest.** Webhook delivery IDs are unique-keyed; redeliveries no-op. Repo upserts target `full_name` so restored or migrated repos converge.
- **Schema-first.** Drizzle migrations live in `drizzle/`; one file describes every table the app reads or writes.
- **Bun + Hono.** Sub-second cold starts, ~50ms p50 for read endpoints, single-file route registration.
- **Trace anything.** Every drop path in the ingest logs structured JSON, so silence from a webhook is debuggable from logs alone.

## Quick start

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
createuser -s pulse && createdb pulse -O pulse

cp .env.example .env       # set DATABASE_URL + REDIS_URL
bun install
bun run db:generate
bun run db:migrate
bun run dev
```

Server boots on <http://localhost:8787>. Smoke test:

```bash
curl -u admin:$ADMIN_PASSWORD http://localhost:8787/admin/health
curl http://localhost:8787/v1/events
curl -N http://localhost:8787/v1/stream/events
```

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | service banner |
| `GET` | `/v1/members` | team list |
| `GET` | `/v1/members/:login` | profile + last 20 events |
| `GET` | `/v1/members/:login/events?limit=` | per-member event history |
| `GET` | `/v1/events?limit=&before=&member=` | global event feed |
| `GET` | `/v1/totals?days=` | rollup counters |
| `GET` | `/v1/heatmap?days=&member=` | daily contribution timeline |
| `GET` | `/v1/leetcode/leaderboard?sort=&limit=` | team LeetCode leaderboard (sort: `weighted` (default), `total`, `ranking`, `contest`) |
| `GET` | `/v1/leetcode/:login` | per-member LeetCode profile snapshot |
| `GET` | `/v1/stream/events?member=` (SSE) | real-time event push |
| `POST` | `/webhook/github` | GitHub App delivery target (HMAC) |
| `GET` | `/admin/health` | DB + Redis liveness |
| `GET` | `/admin/metrics` | row counts (basic auth) |
| `POST` | `/admin/seed` | seed founding-member roster (basic auth) |
| `POST` | `/admin/members/:login/leetcode` | set/clear a member's LeetCode handle (basic auth, body: `{handle}`) |
| `POST` | `/admin/leetcode/refresh?login=` | force-refresh stats (basic auth) |
| `POST` | `/admin/test-event` | inject a fake event onto the live stream (basic auth) |

### LeetCode leaderboard

Pulse calls `leetcode.com/graphql` directly — no third-party service in the
hot path. Members opt in by setting `leetcode_handle` (admin endpoint above);
a background worker refreshes profile, contest, and language stats every
`LEETCODE_POLL_INTERVAL_MIN` minutes (default 360 = 6h) and caches results
in Postgres so the leaderboard endpoint reads from the DB only. Weighted
score = `easy×1 + medium×2 + hard×4`.

## Project layout

```
src/
  index.ts              # Bun.serve entrypoint
  server.ts             # Hono app + middleware + route mount
  env.ts                # zod-validated env
  db/
    index.ts            # drizzle client (auto-detects Cloud SQL Unix socket)
    schema.ts           # tables: members, repos, events, member_daily, ...
  ingest/
    from-webhook.ts     # webhook → event row → redis stream → daily rollup
  lib/
    redis.ts            # ioredis clients + stream key
    sse.ts              # SSE attach + redis-stream broadcast loop
  routes/
    admin.ts            # /admin/*
    webhook/github.ts   # HMAC-verified GitHub App webhook
    v1/{members,events,totals,heatmap,stream}.ts
  workers/
    poll.ts             # GraphQL polling worker (M2)
drizzle/                # migrations
cloudbuild.yaml         # CI pipeline → Cloud Run
Dockerfile              # Bun multi-stage build
```

## Stack

Bun · Hono · Drizzle · Postgres 16 · Redis 7 · GitHub App · Google Cloud Run · Docker.

## Deploy

The production deployment runs on **Google Cloud Run** with **Cloud SQL** for
Postgres, **Memorystore** for Redis, and a **Cloud Build trigger** on push to
`main` that builds the image, pushes to Artifact Registry, and rolls a new
revision. Secrets are bound via Secret Manager.

Full step-by-step infrastructure setup lives in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Roadmap

| Milestone | Status |
|---|---|
| M0 — server, schema, webhook accept | ✅ |
| M1 — webhook ingest, read API, SSE, daily rollup | ✅ |
| M2 — OAuth member onboarding, polling worker | 🟡 in progress |
| M3 — polish: OG images, /live filters, status page | ⏳ |
| M4 — launch | ⏳ |

The AI layer (member bios, event significance, Wrapped) was originally on the
roadmap but has been deferred indefinitely. The schema retains the
`member_bios` and `wrappeds` tables but no code path writes to them.

## License

Proprietary. © FiveD Studio.
