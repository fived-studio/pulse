# pulse

The backend for **FiveD Pulse** — live engineering platform for FiveD Studio.

Ingests GitHub webhook + polled events from the FiveD org and each member's
personal repos, normalizes them, persists to Postgres, and fans out to live
clients via Server-Sent Events.

## Stack

Bun · Hono · Drizzle · Postgres · Redis · GitHub App · Anthropic SDK (later) ·
Fly.io · Docker.

## Layout

```
src/
├── index.ts              # entrypoint (Bun.serve)
├── server.ts             # Hono app + middleware + route mounting
├── env.ts                # zod-validated env
├── db/
│   ├── index.ts          # drizzle client
│   └── schema.ts         # all tables
├── ingest/
│   └── from-webhook.ts   # normalize GitHub webhook → event row → redis stream
├── lib/
│   ├── redis.ts          # ioredis clients + stream key constant
│   └── sse.ts            # SSE attach + redis-stream broadcast loop
├── routes/
│   ├── admin.ts          # /admin/health, /admin/metrics  (basic-auth)
│   ├── webhook/
│   │   └── github.ts     # POST /webhook/github  (HMAC verified)
│   └── v1/
│       ├── members.ts    # GET /v1/members, /v1/members/:login(/events)
│       ├── events.ts     # GET /v1/events
│       ├── totals.ts     # GET /v1/totals?days=30
│       └── stream.ts     # GET /v1/stream/events  (SSE)
└── workers/
    └── poll.ts           # 60s polling worker (M2 stub)
```

## Local setup

```bash
cp .env.example .env
# fill in DATABASE_URL, REDIS_URL at minimum

bun install
bun run db:generate
bun run db:migrate
bun run dev
```

Server is at `http://localhost:8787`.

```bash
curl http://localhost:8787/admin/health -u admin:$ADMIN_PASSWORD
curl http://localhost:8787/v1/events
curl -N http://localhost:8787/v1/stream/events    # SSE
```

### Postgres + Redis on Mac

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
createuser -s pulse
createdb pulse -O pulse
```

## Webhook testing without GitHub

Use `smee.io` to forward a real GitHub App webhook to localhost, or post a
manually-crafted payload (HMAC must match `GITHUB_APP_WEBHOOK_SECRET`).

## Deploy (Fly.io)

```bash
fly launch --no-deploy        # creates fly app from fly.toml
fly postgres create            # provision Postgres
fly redis create               # or use Upstash and set REDIS_URL secret
fly secrets set GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY="$(cat key.pem)" \
                GITHUB_APP_WEBHOOK_SECRET=... \
                ANTHROPIC_API_KEY=... ADMIN_PASSWORD=...
fly deploy
```

## Roadmap

| Milestone | Status |
|---|---|
| M0 plumbing — server, schema, webhook accept | ✅ scaffolded |
| M1 org-only MVP — webhook ingest, read API, SSE | 🟡 ingest done, member onboarding TBD |
| M2 personal aggregation — OAuth, polling worker | ⏳ |
| M3 AI layer — bios, significance, Wrapped | ⏳ |
| M4 polish — OG, /live filters, docs | ⏳ |

See the PRD: `~/.gstack/projects/fived-studio/sloweyyy-main-design-20260503-fived-pulse-v2.md`.
