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
                                        |  Cloud Firestore (mbpp-7347c)|
                                        |  predictions/, stats/global  |
                                        +------------------------------+
```

**Why the split.** Netlify runs the frontend and nothing else: Netlify Functions
support JavaScript/TypeScript and Go, not Python, and this service needs
scikit-learn, scipy, NLTK corpora and 24 MB of joblib artifacts — well past
serverless bundle limits even if Python were an option. So the predictor runs as
a container, and Netlify rewrites `/api/*` to it. The browser only ever sees the
Netlify origin, which means no CORS preflights and no backend URL baked into the
HTML.

**Where the database sits.** Firestore is written and read only by the backend
through the Firebase Admin SDK. No Firebase credentials or SDK reach the
browser, and `firestore.rules` denies all direct client access.

---

## 1. Firestore

The project (`mbpp-7347c`) is already on the Spark plan, which includes
Firestore. Create the database once, then push rules and indexes:

```bash
npm install -g firebase-tools
firebase login

# One-time: create the database in Native mode, in a region near the backend.
gcloud firestore databases create --location=nam5 --project=mbpp-7347c

firebase deploy --only firestore --project mbpp-7347c
```

`firebase.json`, `firestore.rules` and `firestore.indexes.json` carry no
comments on purpose — both the CLI and the Firestore Admin API validate those
schemas and reject unknown keys, so the explanations live here instead:

- **`firestore.rules` denies everything.** The backend uses the Admin SDK, which
  bypasses rules entirely, so no rule is needed for it to work — and any rule
  permissive enough for a browser would expose user-submitted text and let
  anyone forge the `stats/global` counters. History reaches the UI through
  `/api/v1/predictions`, which returns an allow-listed projection of each
  document (no IP hash, no user agent).
- **The one composite index** covers `?type=INFP`, which filters on
  `personality_type` and orders by `created_at` — Firestore rejects that
  combination without it. The unfiltered ordering uses the automatic
  single-field index.
- **`fieldOverrides` exempt `text` and `user_agent` from indexing.** Neither is
  ever queried, so indexing them only costs an index write per document and
  risks the index-entry size limit on long snippets.

### Retention (TTL)

`PREDICTION_TTL_DAYS` stamps each document with `expires_at`. Firestore only
acts on it once a TTL policy exists — the field alone does nothing:

```bash
gcloud firestore fields ttls update expires_at \
  --collection-group=predictions \
  --enable-ttl \
  --project=mbpp-7347c
```

### Free-tier budget

Each prediction costs **2 writes** (the document plus the aggregate counter,
batched into one RPC). Spark allows 20k writes/day, so roughly 10k predictions
per day. `/api/v1/stats` is one read regardless of history size, because counts
come from `stats/global` instead of a scan.

---

## 2. Backend container

### Build and run locally

```bash
docker compose up --build          # app on :8080, Firestore emulator on :8088
curl -s localhost:8080/readyz | jq
curl -s -X POST localhost:8080/api/v1/predict \
     -H 'Content-Type: application/json' \
     -d '{"text":"welcome, nice to meet you"}' | jq
```

Compose points the app at the emulator, so local runs never touch the real
database or consume quota.

### Deploy to Cloud Run

Cloud Run is the natural target — the same project, Application Default
Credentials with no key file, and scale-to-zero. **It requires the Blaze plan**
(Spark covers Firestore but not Cloud Run); Fly.io, Render or any container host
works identically, only the credential step differs.

```bash
PROJECT=mbpp-7347c
REGION=us-central1

gcloud artifacts repositories create mbpp --repository-format=docker \
  --location=$REGION --project=$PROJECT

gcloud builds submit --project=$PROJECT \
  --tag $REGION-docker.pkg.dev/$PROJECT/mbpp/backend:$(git rev-parse --short HEAD)

# A dedicated service account with only the Firestore role it needs.
gcloud iam service-accounts create mbpp-backend --project=$PROJECT
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:mbpp-backend@$PROJECT.iam.gserviceaccount.com \
  --role=roles/datastore.user

gcloud run deploy mbpp-backend \
  --project=$PROJECT --region=$REGION \
  --image=$REGION-docker.pkg.dev/$PROJECT/mbpp/backend:$(git rev-parse --short HEAD) \
  --service-account=mbpp-backend@$PROJECT.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --memory=2Gi --cpu=2 --concurrency=8 --min-instances=0 --max-instances=4 \
  --timeout=120 \
  --set-env-vars=APP_ENV=production,FIREBASE_PROJECT_ID=$PROJECT,TRUSTED_PROXY_COUNT=2,LOG_JSON=true \
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
| Liveness | `GET /healthz` — no external checks, so a Firestore blip cannot trigger a restart loop |
| Readiness | `GET /readyz` — models + NLTK corpora gate the verdict; Firestore is reported but non-fatal |
| Deployed version | `GET /api/v1/meta` — app version, content-hashed model version |
| Logs | one JSON line per request (`LOG_JSON=true`): status, `duration_ms`, `request_id` |
| Tracing a report | `X-Request-ID` on every response; honours an inbound value |
| Rate limits | `X-RateLimit-*` headers; 429 with `Retry-After` |

Useful queries once logs are in Cloud Logging:

```
resource.type="cloud_run_revision" jsonPayload.message="prediction"
resource.type="cloud_run_revision" jsonPayload.message="prediction_save_failed"
resource.type="cloud_run_revision" jsonPayload.severity="ERROR"
```

`prediction_save_failed` is the signal that Firestore is degrading while
predictions still succeed — worth an alert, since nothing else surfaces it.

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
