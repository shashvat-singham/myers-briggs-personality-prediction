# Deployment

## Architecture

```
        browser
           |
           v
  +--------------------+        /api/*  (proxy rewrite, 200)
  |  Netlify (CDN)     | ------------------------------+
  |  static frontend   |                               |
  +--------------------+                               v
                                        +------------------------------+
                                        |  Container: Flask + gunicorn |
                                        |  4 sklearn pipelines         |
                                        +------------------------------+
                                                       |
                                                       |  Admin SDK
                                                       v
                                        +------------------------------+
                                        | Realtime Database (mbpp-7347c)|
                                        | /predictions, /stats          |
                                        +------------------------------+
```

**Why the split.** Netlify runs the frontend and nothing else: Netlify Functions
support JavaScript/TypeScript and Go, not Python, and this service needs
scikit-learn, scipy, NLTK corpora and 24 MB of joblib artifacts — well past
serverless bundle limits even if Python were an option. So the predictor runs as
a container, and Netlify rewrites `/api/*` to it. The browser only ever sees the
Netlify origin, which means no CORS preflights and no backend URL baked into the
HTML.

**Where the database sits.** The Realtime Database is written and read only by
the backend through the Firebase Admin SDK. No Firebase credentials or SDK reach
the browser, and `database.rules.json` denies all direct client access.

**Two backends exist.** `DATABASE_BACKEND=rtdb` (the default) uses the Realtime
Database, which is what this project has provisioned. `DATABASE_BACKEND=firestore`
switches to Cloud Firestore — same interface, different rules file. Everything
above `mbpp/repository.py` is unaware of which is active.

---

## 1. Realtime Database

The project (`mbpp-7347c`) is on the Spark plan, which includes the Realtime
Database. The instance already exists at
`https://mbpp-7347c-default-rtdb.firebaseio.com`; push the rules:

```bash
npm install -g firebase-tools
firebase login

firebase deploy --only database --project mbpp-7347c
```

### Data layout

```
predictions/
  -NxAbC1234...            <- push key: chronologically sortable
    text, text_sha256, text_length, truncated,
    personality_type, axes/{ei,sn,tf,jp},
    model_version, latency_ms, source, request_id,
    client_ip_hash, user_agent,
    created_at             <- ServerValue.TIMESTAMP (ms)
    expires_at             <- ms, absent when TTL is off
stats/
  total                    <- int
  types/{TYPE}             <- int per MBTI type
  updated_at               <- ms
```

`database.rules.json` carries no comments because the CLI validates the schema,
so the reasoning lives here:

- **Everything is denied.** The backend uses the Admin SDK, which bypasses rules
  entirely, so no rule is needed for it to work — and any rule permissive enough
  for a browser would expose user-submitted text and let anyone forge the
  counters. History reaches the UI through `/api/v1/predictions`, which returns
  an allow-listed projection (no IP hash, no user agent).
- **`.indexOn: ["personality_type", "created_at"]`** backs the `?type=INFP`
  filter and the prune script's range query. Without it RTDB still answers, but
  by downloading the node and filtering in the client — with a warning in the
  logs and a bill to match.

### Three RTDB-specific behaviours

1. **History sorts by push key, not by a timestamp.** Firebase push keys embed
   their creation time and sort lexicographically, so `order_by_key()
   .limit_to_last(n)` is exactly "the n newest" — no index, no extra field. RTDB
   cannot sort descending, so the bounded slice is reversed in Python.
2. **Counters use a transaction.** The Python Admin SDK does not expose the
   `increment` server value, so `/stats` is updated with a compare-and-set
   transaction. That is a second round trip after the push: if it fails, the
   prediction is still stored and only the totals go stale (logged as
   `stats_update_failed`). `tools/rebuild_stats.py` repairs them.
3. **There is no TTL.** Firestore expires documents server-side; RTDB has no such
   feature, so `expires_at` is advisory and deletion is your job:

```bash
python tools/prune_predictions.py --dry-run     # report what would go
python tools/prune_predictions.py               # delete, honouring PREDICTION_TTL_DAYS
python tools/rebuild_stats.py                   # realign counters after pruning
```

Schedule the prune (Cloud Scheduler, GitHub Actions cron, host crontab).
Unpruned, history grows until the 1 GB free-tier ceiling, and every `/history`
read pays for a bigger tree.

### Free-tier budget

Each prediction costs one `push` plus one counter transaction. Spark's limits are
1 GB stored and 10 GB/month downloaded, with 100 simultaneous connections — the
Admin SDK uses the REST interface, so a request is not a persistent connection
and that last limit is not in play. `/api/v1/stats` reads a single small node
regardless of history size, and `/history` reads only the newest N records.

---

## 2. Backend container

### Build and run locally

```bash
docker compose up --build          # app on :8080
curl -s localhost:8080/readyz | jq '.checks.database'
curl -s -X POST localhost:8080/api/v1/predict \
     -H 'Content-Type: application/json' \
     -d '{"text":"welcome, nice to meet you"}' | jq '{personality_type, stored, id}'
```

`"stored": true` means the write reached the database. Compose defaults to the
real RTDB instance and needs credentials; to avoid touching production data (and
Spark quota), run the emulator on the host and uncomment
`FIREBASE_DATABASE_EMULATOR_HOST` in docker-compose.yml:

```bash
firebase emulators:start --only database    # :9000, plus a UI on :4000
```

Unlike Firestore, the RTDB emulator has no standalone container image — it ships
inside firebase-tools and needs a JRE — which is why it runs on the host rather
than as a compose service.

### Deploy to Cloud Run

Cloud Run is the natural target — the same project, Application Default
Credentials with no key file, and scale-to-zero. **It requires the Blaze plan**
(Spark covers the Realtime Database but not Cloud Run); Fly.io, Render or any container host
works identically, only the credential step differs.

```bash
PROJECT=mbpp-7347c
REGION=us-central1

gcloud artifacts repositories create mbpp --repository-format=docker \
  --location=$REGION --project=$PROJECT

gcloud builds submit --project=$PROJECT \
  --tag $REGION-docker.pkg.dev/$PROJECT/mbpp/backend:$(git rev-parse --short HEAD)

# A dedicated service account with only the database role it needs.
# NOTE: the Realtime Database and Firestore use different roles --
# firebasedatabase.admin for RTDB, datastore.user for Firestore. Granting the
# Firestore role to an RTDB backend produces permission errors on every write.
gcloud iam service-accounts create mbpp-backend --project=$PROJECT
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:mbpp-backend@$PROJECT.iam.gserviceaccount.com \
  --role=roles/firebasedatabase.admin

gcloud run deploy mbpp-backend \
  --project=$PROJECT --region=$REGION \
  --image=$REGION-docker.pkg.dev/$PROJECT/mbpp/backend:$(git rev-parse --short HEAD) \
  --service-account=mbpp-backend@$PROJECT.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --memory=2Gi --cpu=2 --concurrency=8 --min-instances=0 --max-instances=4 \
  --timeout=120 \
  --set-env-vars=APP_ENV=production,FIREBASE_PROJECT_ID=$PROJECT,DATABASE_BACKEND=rtdb,FIREBASE_DATABASE_URL=https://mbpp-7347c-default-rtdb.firebaseio.com,TRUSTED_PROXY_COUNT=2,LOG_JSON=true \
  --set-secrets=SECRET_KEY=mbpp-secret-key:latest,IP_HASH_SALT=mbpp-ip-salt:latest
```

Notes that matter in practice:

- **Memory ≥ 2Gi.** Each gunicorn worker holds its own copy of four pipelines
  (~250 MB). `preload_app` shares them copy-on-write after fork, but Python
  touches enough pages that you should budget per worker.
- **`TRUSTED_PROXY_COUNT=2`** when traffic arrives via Netlify → Cloud Run
  (Netlify is one hop, Cloud Run's front end another). Set `1` if clients hit
  Cloud Run directly. Too high lets a client forge `X-Forwarded-For` and evade
  rate limiting.
- **No key file.** ADC comes from `--service-account`. Never mount a downloaded
  service-account JSON on Cloud Run.
- **Secrets in Secret Manager**, not `--set-env-vars`. Create them once:
  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(48))" | \
    gcloud secrets create mbpp-secret-key --data-file=- --project=$PROJECT
  python -c "import secrets; print(secrets.token_hex(32))" | \
    gcloud secrets create mbpp-ip-salt --data-file=- --project=$PROJECT
  ```
  Changing `IP_HASH_SALT` later invalidates comparisons against previously
  stored hashes, which is a feature, not a bug.
- **`--concurrency=8`** matches `GUNICORN_THREADS`. Higher just queues requests
  behind the CPU.

### Credentials on non-Google hosts

Fly/Render/Railway have no ADC. Create a service-account key, then paste it (or
its base64) into `FIREBASE_SERVICE_ACCOUNT_JSON`:

```bash
gcloud iam service-accounts keys create key.json \
  --iam-account=mbpp-backend@mbpp-7347c.iam.gserviceaccount.com
base64 -w0 key.json     # paste into the platform's secret store, then delete key.json
```

---

## 3. Netlify frontend

```
Build command:      pip install -q jinja2==3.1.4 && python tools/build_static.py
Publish directory:  dist
Environment:        BACKEND_URL = https://mbpp-backend-xxxxxxxxxx-uc.a.run.app
```

`tools/build_static.py` renders the same Jinja templates Flask uses into
`dist/`, copies `static/`, and generates `dist/_redirects` with `BACKEND_URL`
substituted in. `netlify.toml` cannot interpolate env vars into redirect
targets, which is exactly why the real rules are generated at build time — and
why `_redirects` (which takes precedence over `netlify.toml`) is the file to
check when the proxy misbehaves.

**After changing `BACKEND_URL` you must redeploy.** The value is baked into
`_redirects` at build time; an env-var change alone does nothing.

Verify a deploy:

```bash
curl -s https://<site>.netlify.app/healthz                     # proxied to the backend
curl -s -X POST https://<site>.netlify.app/api/v1/predict \
     -H 'Content-Type: application/json' -d '{"text":"hello there friend"}'
```

If predictions 404, `BACKEND_URL` was unset at build time — the build prints a
warning and writes a `_redirects` file that says so.

---

## 4. Operations

| Concern | Where |
| --- | --- |
| Liveness | `GET /healthz` — no external checks, so a database blip cannot trigger a restart loop |
| Readiness | `GET /readyz` — models + NLTK corpora gate the verdict; the database is reported (with its backend name) but non-fatal |
| Deployed version | `GET /api/v1/meta` — app version, content-hashed model version, active database backend |
| Logs | one JSON line per request (`LOG_JSON=true`): status, `duration_ms`, `request_id` |
| Tracing a report | `X-Request-ID` on every response; honours an inbound value |
| Rate limits | `X-RateLimit-*` headers; 429 with `Retry-After` |

Useful queries once logs are in Cloud Logging:

```
resource.type="cloud_run_revision" jsonPayload.message="prediction"
resource.type="cloud_run_revision" jsonPayload.message="prediction_save_failed"
resource.type="cloud_run_revision" jsonPayload.severity="ERROR"
```

`prediction_save_failed` is the signal that the database is degrading while
predictions still succeed — worth an alert, since nothing else surfaces it (the
API returns 200 with `"stored": false`). `stats_update_failed` means the record
landed but the counters did not; `tools/rebuild_stats.py` fixes those.

### Rate limiting is per worker

The limiter is in-process, so the effective ceiling is
`RATE_LIMIT_REQUESTS × workers × instances`, and it resets on deploy. That is
deliberate: it exists to stop one client from saturating a CPU-bound server. For
an exact global limit, enforce it at the edge or swap in flask-limiter with
Redis — `enforce_rate_limit()` in `mbpp/__init__.py` is the only call site.

---

## 5. Modernising the ML stack

The Python floor is 3.8 and scikit-learn is pinned to 0.23.2 for one reason:
`models/*.joblib` were serialised by scikit-learn 0.23.0 (the pickles carry
`_sklearn_version`), and `ColumnTransformer`'s internals changed in 1.0, so
modern scikit-learn cannot deserialise them. 0.23.2 is the newest release that
loads these artifacts and ships a manylinux wheel; its newest supported
interpreter is CPython 3.8.

Python 3.8 and scikit-learn 0.23 are both end-of-life, so this floor is a
liability worth clearing. The fix is retraining, not repackaging:

1. Re-run `final_notebooks/06_final_model.ipynb` on a current stack
   (Python 3.12, scikit-learn 1.5+, imbalanced-learn 0.12+) against
   `data/mbti_1.csv`.
2. Compare per-axis accuracy/ROC-AUC against the current artifacts before
   swapping them in.
3. While retraining, fix the known wart in `mbpp/preprocess.py`: `lemmitize()`
   discards the lemmatizer's output and only drops stopwords. It is preserved
   as-is today precisely because the models were fitted on that behaviour.
4. Replace `models/*.joblib`, drop the pins in `requirements.txt`, and bump the
   Dockerfile base image. `MODEL_VERSION` (or the content hash) makes the change
   visible in every stored prediction.
