# pulse

The backend for **FiveD Pulse** — live engineering platform for FiveD Studio.

Ingests GitHub webhook + polled events from the FiveD org and each member's
personal repos, normalizes them, persists to Postgres, and fans out to live
clients via Server-Sent Events.

## Stack

Bun · Hono · Drizzle · Postgres · Redis · GitHub App · Anthropic SDK (later) ·
Google Cloud Run · Docker.

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

## Deploy (Google Cloud Run)

The app is a stateless container that listens on `$PORT`. Cloud Run injects
`PORT=8080`, scales to zero (we pin `min-instances=1` so the SSE redis-stream
consumer stays warm), and supports HTTP/2 streaming for SSE up to 60 minutes
per request.

### One-time GCP setup

```bash
PROJECT=fived-pulse
REGION=asia-southeast1
REPO=pulse
SERVICE=fived-pulse

gcloud config set project $PROJECT
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  vpcaccess.googleapis.com

# Artifact Registry (Docker images)
gcloud artifacts repositories create $REPO \
  --repository-format=docker --location=$REGION

# Cloud SQL (Postgres 16)
gcloud sql instances create pulse-pg \
  --database-version=POSTGRES_16 --tier=db-f1-micro --region=$REGION
gcloud sql databases create pulse --instance=pulse-pg
gcloud sql users create pulse --instance=pulse-pg --password='<gen>'

# Memorystore (Redis) — requires a Serverless VPC connector for Cloud Run
gcloud redis instances create pulse-redis --size=1 --region=$REGION \
  --redis-version=redis_7_0
gcloud compute networks vpc-access connectors create pulse-vpc \
  --region=$REGION --network=default --range=10.8.0.0/28
```

### Secrets

Push every secret in `.env.example` (other than `PORT` / `NODE_ENV`) to Secret
Manager. The names referenced by `cloudbuild.yaml`:

```bash
for s in pulse-database-url pulse-redis-url pulse-github-app-id \
         pulse-github-app-private-key pulse-github-webhook-secret \
         pulse-github-client-id pulse-github-client-secret \
         pulse-admin-password pulse-anthropic-api-key; do
  gcloud secrets create $s --replication-policy=automatic
done

# example: load a value from a local file or stdin
printf '%s' "$DATABASE_URL" | gcloud secrets versions add pulse-database-url --data-file=-
gcloud secrets versions add pulse-github-app-private-key --data-file=key.pem
```

`pulse-anthropic-api-key` may be set to an empty string — it is unused until
the M3 AI layer ships.

Grant Cloud Run's runtime service account access:

```bash
RUNTIME_SA=$(gcloud iam service-accounts list \
  --filter='displayName:Compute Engine default service account' \
  --format='value(email)')
for s in pulse-database-url pulse-redis-url pulse-github-app-id \
         pulse-github-app-private-key pulse-github-webhook-secret \
         pulse-github-client-id pulse-github-client-secret \
         pulse-admin-password pulse-anthropic-api-key; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:$RUNTIME_SA \
    --role=roles/secretmanager.secretAccessor
done
```

### Deploy

```bash
CLOUDSQL=$(gcloud sql instances describe pulse-pg --format='value(connectionName)')

gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_REGION=$REGION,_REPO=$REPO,_SERVICE=$SERVICE,_VPC_CONNECTOR=pulse-vpc,_CLOUDSQL=$CLOUDSQL
```

Point the GitHub App webhook at the Cloud Run URL `gcloud run services
describe $SERVICE --region=$REGION --format='value(status.url)'` plus
`/webhook/github`.

## Roadmap

| Milestone | Status |
|---|---|
| M0 plumbing — server, schema, webhook accept | ✅ scaffolded |
| M1 org-only MVP — webhook ingest, read API, SSE | 🟡 ingest done, member onboarding TBD |
| M2 personal aggregation — OAuth, polling worker | ⏳ |
| M3 AI layer — bios, significance, Wrapped | ⏳ |
| M4 polish — OG, /live filters, docs | ⏳ |

See the PRD: `~/.gstack/projects/fived-studio/sloweyyy-main-design-20260503-fived-pulse-v2.md`.
