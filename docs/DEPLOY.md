# Deploying Pulse to Google Cloud

End-to-end setup for the production deployment: Cloud Run + Cloud SQL +
Memorystore + Cloud Build trigger + Secret Manager.

The service is stateless and listens on `$PORT`. Cloud Run injects
`PORT=8080`, scales to zero (we pin `min-instances=1` so the SSE
Redis-stream consumer stays warm), and supports HTTP/2 streaming for SSE up
to 60 minutes per request.

## 1 — Project & APIs

```bash
PROJECT=fived-pulse
REGION=asia-southeast1
REPO=pulse
SERVICE=fived-pulse

gcloud projects create $PROJECT
gcloud config set project $PROJECT
gcloud billing projects link $PROJECT --billing-account=<your-billing-account>

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  compute.googleapis.com \
  iam.googleapis.com
```

## 2 — Infrastructure

### Artifact Registry (container images)
```bash
gcloud artifacts repositories create $REPO \
  --repository-format=docker --location=$REGION
```

### Cloud SQL (Postgres 16)
```bash
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)

gcloud sql instances create pulse-pg \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region=$REGION \
  --storage-size=10GB --storage-type=HDD \
  --backup-start-time=18:00 \
  --root-password="$DB_PASSWORD"

gcloud sql databases create pulse --instance=pulse-pg
gcloud sql users create pulse --instance=pulse-pg --password="$DB_PASSWORD"
```

### Memorystore Redis (private VPC)
```bash
gcloud redis instances create pulse-redis \
  --size=1 --region=$REGION --redis-version=redis_7_0 --tier=basic

gcloud compute networks vpc-access connectors create pulse-vpc \
  --region=$REGION --network=default --range=10.8.0.0/28 \
  --min-instances=2 --max-instances=3
```

## 3 — Secret Manager

```bash
for s in pulse-database-url pulse-redis-url pulse-github-app-id \
         pulse-github-app-private-key pulse-github-webhook-secret \
         pulse-github-client-id pulse-github-client-secret \
         pulse-admin-password; do
  gcloud secrets create $s --replication-policy=automatic
done

# Cloud SQL DATABASE_URL uses the Unix-socket form. The 'localhost' is a
# placeholder so URL parsers don't choke; postgres-js honours the host=
# query parameter (Pulse's db client extracts it explicitly).
CONNECTION_NAME=$(gcloud sql instances describe pulse-pg --format='value(connectionName)')
DATABASE_URL="postgres://pulse:${DB_PASSWORD}@localhost/pulse?host=/cloudsql/${CONNECTION_NAME}"
printf '%s' "$DATABASE_URL" | gcloud secrets versions add pulse-database-url --data-file=-

REDIS_HOST=$(gcloud redis instances describe pulse-redis --region=$REGION --format='value(host)')
printf "redis://${REDIS_HOST}:6379" | gcloud secrets versions add pulse-redis-url --data-file=-

# Repeat for ADMIN_PASSWORD and the GitHub App credentials. The private key
# file goes in raw:
gcloud secrets versions add pulse-github-app-private-key --data-file=key.pem
```

Grant Cloud Run's runtime SA access:
```bash
RUNTIME_SA=$(gcloud iam service-accounts list \
  --filter='displayName:Compute Engine default service account' \
  --format='value(email)')
for s in pulse-database-url pulse-redis-url pulse-github-app-id \
         pulse-github-app-private-key pulse-github-webhook-secret \
         pulse-github-client-id pulse-github-client-secret \
         pulse-admin-password; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:$RUNTIME_SA \
    --role=roles/secretmanager.secretAccessor
done
```

## 4 — Database migrations

Temporarily authorise your IP, run drizzle, revoke:
```bash
MY_IP=$(curl -s https://api.ipify.org)
gcloud sql instances patch pulse-pg --authorized-networks="${MY_IP}/32"

PUBLIC_IP=$(gcloud sql instances describe pulse-pg --format='value(ipAddresses[0].ipAddress)')
DATABASE_URL="postgres://pulse:${DB_PASSWORD}@${PUBLIC_IP}:5432/pulse?sslmode=require" \
  bun run db:migrate

gcloud sql instances patch pulse-pg --clear-authorized-networks
```

## 5 — First deploy

```bash
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_REGION=$REGION,_REPO=$REPO,_SERVICE=$SERVICE,_VPC_CONNECTOR=pulse-vpc,_CLOUDSQL=$CONNECTION_NAME
```

Make the service public (Pulse's `/v1/*` endpoints are intended to be):
```bash
gcloud run services add-iam-policy-binding fived-pulse \
  --region=$REGION --member=allUsers --role=roles/run.invoker
```

The webhook route is HMAC-verified, `/admin/*` requires basic auth, so
exposing the rest is safe.

## 6 — CI: Cloud Build trigger

After the first manual deploy works, wire up auto-deploy.

1. Install the [Google Cloud Build GitHub App](https://github.com/apps/google-cloud-build/installations/new)
   on `fived-studio/pulse`.
2. Create a deploy service account:
   ```bash
   SA=pulse-deploy
   gcloud iam service-accounts create $SA --display-name="Pulse Cloud Build deployer"
   SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"
   for role in roles/cloudbuild.builds.builder roles/run.admin \
               roles/iam.serviceAccountUser roles/artifactregistry.writer \
               roles/logging.logWriter roles/storage.admin; do
     gcloud projects add-iam-policy-binding $PROJECT \
       --member="serviceAccount:$SA_EMAIL" --role=$role --condition=None
   done
   gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SA \
     --member="serviceAccount:$SA_EMAIL" --role=roles/iam.serviceAccountUser
   ```
3. Create the trigger via [Cloud Build Console](https://console.cloud.google.com/cloud-build/triggers/add):
   - Event: push to branch
   - Source: 1st gen, repo `fived-studio/pulse`, branch `^main$`
   - Configuration: `cloudbuild.yaml` (autodetect)
   - Service account: `pulse-deploy@<project>.iam.gserviceaccount.com`

`cloudbuild.yaml` already bakes in the `_VPC_CONNECTOR` and `_CLOUDSQL`
defaults so the trigger doesn't need substitutions.

## 7 — Connect the GitHub App

1. Create a GitHub App on the org (Settings → Developer settings → GitHub Apps → New).
2. Webhook URL: `https://<cloud-run-url>/webhook/github`. Webhook secret:
   `pulse-github-webhook-secret`.
3. Permissions: Contents/Metadata/Pull requests/Issues read-only; Org Members read.
4. Subscribe to: Push, Pull request, Pull request review, Release, Star, Public.
5. Install the App on the org with access to all relevant repos.
6. Push a commit anywhere — should land in the events feed within ~2 seconds.

## 8 — Custom domain (optional)

```bash
gcloud run domain-mappings create \
  --service=fived-pulse --domain=api.fived.studio --region=$REGION
```

Add the DNS records gcloud prints, then update the frontend's
`PULSE_API_URL` repo variable to `https://api.fived.studio`.

## Cost reference

Steady state with min-instances=1, the smallest tiers, and `asia-southeast1`:

| Service | Tier | Monthly |
|---|---|---|
| Cloud Run (always-on) | 1 instance, 512 Mi | ~$5–15 |
| Cloud SQL | `db-f1-micro` (Enterprise) | ~$10 |
| Memorystore Redis | Basic 1 GB | ~$35 |
| VPC Connector | minimal | ~$10 |
| **Total** | | **~$60–75** |

For lower spend, swap Memorystore for an Upstash Redis URL (free tier) and
drop the VPC connector entirely.
