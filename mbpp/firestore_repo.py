"""Cloud Firestore persistence for predictions.

Design rules this module follows:

* **Best-effort writes.** A prediction is the product the user asked for;
  storing it is bookkeeping. Every Firestore call is wrapped, bounded by a
  timeout and degraded to a logged warning, so a Firestore outage shows up in
  dashboards, not in 500s.
* **Server-authoritative time.** `created_at` is `SERVER_TIMESTAMP`; client
  clocks are never trusted for ordering.
* **One round trip per prediction.** The document write and the aggregate
  counter increment go in a single `WriteBatch`, which halves both latency and
  billed operations.
* **Counters, not scans.** `/stats/global` is maintained with atomic
  `Increment`, so the stats endpoint is one document read regardless of how
  many predictions exist.
* **Admin credentials.** This process uses the Admin SDK, which bypasses
  security rules; `firestore.rules` therefore denies all direct client access.

Document shape in `predictions/{auto-id}`:

    {
      "text":            str | None,   # truncated, omitted when STORE_RAW_TEXT=false
      "text_sha256":     str,          # stable id for the input, always present
      "text_length":     int,
      "truncated":       bool,
      "personality_type":str,          # e.g. "INFP"
      "axes":            {"ei": {...}, "sn": {...}, "tf": {...}, "jp": {...}},
      "model_version":   str,
      "latency_ms":      int,
      "source":          str,          # "web" | "api"
      "request_id":      str,
      "client_ip_hash":  str | None,   # salted SHA-256, only if IP_HASH_SALT set
      "user_agent":      str | None,
      "created_at":      timestamp,    # server-side
      "expires_at":      timestamp | None,  # for the Firestore TTL policy
    }
"""
import base64
import binascii
import datetime
import hashlib
import json
import logging
import os
import threading

log = logging.getLogger(__name__)


class FirestoreRepository(object):
    """Thin repository over the `predictions` collection.

    Construction is cheap and never touches the network; the client is built on
    first use so that importing the app (tests, `--check` runs) needs no
    credentials.
    """

    def __init__(self, config):
        self.config = config
        self._client = None
        self._lock = threading.Lock()
        self._init_failed = False
        self._init_error = None

    # ------------------------------------------------------------------ setup
    @property
    def enabled(self):
        return bool(getattr(self.config, "FIRESTORE_ENABLED", False))

    @property
    def emulated(self):
        return bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))

    def client(self):
        """Return a Firestore client, or None if unavailable.

        Initialisation is attempted once. After a hard failure we stay
        degraded instead of retrying credential resolution on every request.
        """
        if not self.enabled or self._init_failed:
            return None
        if self._client is not None:
            return self._client
        with self._lock:
            if self._client is not None:
                return self._client
            try:
                self._client = self._build_client()
                log.info(
                    "firestore_initialised",
                    extra={
                        "project_id": self.config.FIREBASE_PROJECT_ID,
                        "database": self.config.FIRESTORE_DATABASE,
                        "emulator": self.emulated,
                    },
                )
            except Exception as exc:  # pragma: no cover - credential paths
                self._init_failed = True
                self._init_error = str(exc)
                log.error(
                    "firestore_init_failed",
                    extra={"error": str(exc), "exc_type": type(exc).__name__},
                )
                return None
        return self._client

    def _build_client(self):
        project_id = self.config.FIREBASE_PROJECT_ID
        database = self.config.FIRESTORE_DATABASE or "(default)"

        if self.emulator_client_needed():
            # The emulator accepts any credentials; the Admin SDK would still
            # insist on resolving real ones, so bypass it entirely.
            from google.auth.credentials import AnonymousCredentials
            from google.cloud import firestore as gcf

            kwargs = {"project": project_id or "demo-mbpp",
                      "credentials": AnonymousCredentials()}
            if database and database != "(default)":
                kwargs["database"] = database
            return gcf.Client(**kwargs)

        import firebase_admin
        from firebase_admin import credentials, firestore

        app_name = "mbpp"
        try:
            app = firebase_admin.get_app(app_name)
        except ValueError:
            options = {}
            if project_id:
                options["projectId"] = project_id
            app = firebase_admin.initialize_app(
                self._resolve_credentials(credentials), options, name=app_name
            )

        if database and database != "(default)":
            try:
                return firestore.client(app=app, database_id=database)
            except TypeError:  # firebase-admin < 6.5 has no database_id
                log.warning(
                    "firestore_named_database_unsupported",
                    extra={"database": database},
                )
        return firestore.client(app=app)

    def emulator_client_needed(self):
        return self.emulated

    def _resolve_credentials(self, credentials):
        """Pick credentials in order of explicitness.

        1. `FIREBASE_SERVICE_ACCOUNT_JSON` -- inline JSON or base64 of it, for
           platforms that only offer env vars (Render, Fly, Netlify build).
        2. `GOOGLE_APPLICATION_CREDENTIALS` -- a key file path.
        3. Application Default Credentials -- the right answer on Cloud Run,
           where the runtime service account is injected and no key exists.
        """
        inline = (self.config.FIREBASE_SERVICE_ACCOUNT_JSON or "").strip()
        if inline:
            info = self._parse_service_account(inline)
            return credentials.Certificate(info)

        key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if key_path:
            if not os.path.exists(key_path):
                raise RuntimeError(
                    "GOOGLE_APPLICATION_CREDENTIALS points at a missing file: %s"
                    % key_path
                )
            return credentials.Certificate(key_path)

        return credentials.ApplicationDefault()

    @staticmethod
    def _parse_service_account(raw):
        try:
            return json.loads(raw)
        except ValueError:
            pass
        try:
            decoded = base64.b64decode(raw, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
            raise RuntimeError(
                "FIREBASE_SERVICE_ACCOUNT_JSON is neither valid JSON nor base64"
            ) from exc
        try:
            return json.loads(decoded)
        except ValueError as exc:
            raise RuntimeError(
                "FIREBASE_SERVICE_ACCOUNT_JSON decoded from base64 but is not JSON"
            ) from exc

    # --------------------------------------------------------------- helpers
    def _call_kwargs(self):
        """Timeout + retry policy applied to every Firestore RPC."""
        kwargs = {"timeout": self.config.FIRESTORE_TIMEOUT_SECONDS}
        retries = int(getattr(self.config, "FIRESTORE_RETRIES", 0) or 0)
        if retries > 0:
            try:
                from google.api_core import exceptions as gexc
                from google.api_core import retry as gretry

                kwargs["retry"] = gretry.Retry(
                    predicate=gretry.if_exception_type(
                        gexc.ServiceUnavailable,
                        gexc.DeadlineExceeded,
                        gexc.InternalServerError,
                        gexc.Aborted,
                    ),
                    initial=0.1,
                    maximum=1.0,
                    multiplier=2.0,
                    deadline=self.config.FIRESTORE_TIMEOUT_SECONDS * (retries + 1),
                )
            except ImportError:  # pragma: no cover
                pass
        return kwargs

    def hash_text(self, text):
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def hash_ip(self, ip):
        """Salted hash, or None when no salt is configured.

        An unsalted IP hash is reversible by brute force over the IPv4 space,
        so storing one would be worse than storing nothing.
        """
        salt = (self.config.IP_HASH_SALT or "").strip()
        if not salt or not ip:
            return None
        return hashlib.sha256(("%s|%s" % (salt, ip)).encode("utf-8")).hexdigest()

    def _expiry(self):
        days = int(getattr(self.config, "PREDICTION_TTL_DAYS", 0) or 0)
        if days <= 0:
            return None
        return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            days=days
        )

    def build_document(
        self,
        text,
        result,
        source="api",
        request_id=None,
        client_ip=None,
        user_agent=None,
        latency_ms=None,
    ):
        """Assemble the document for a prediction (pure; no I/O)."""
        stored_text = None
        truncated = False
        if self.config.STORE_RAW_TEXT:
            limit = int(self.config.STORED_TEXT_MAX_CHARS)
            stored_text = text[:limit]
            truncated = len(text) > limit

        doc = {
            "text": stored_text,
            "text_sha256": self.hash_text(text),
            "text_length": len(text),
            "truncated": truncated,
            "personality_type": result.get("personality_type"),
            "axes": result.get("axes") or {},
            "model_version": result.get("model_version"),
            "latency_ms": int(latency_ms) if latency_ms is not None else None,
            "source": source,
            "request_id": request_id,
            "client_ip_hash": self.hash_ip(client_ip),
            "user_agent": (user_agent or None) and str(user_agent)[:256],
        }
        return {k: v for k, v in doc.items() if v is not None or k == "text"}

    # ----------------------------------------------------------------- writes
    def save_prediction(self, document):
        """Persist one prediction plus aggregate counters.

        Returns the new document id, or None when Firestore is unavailable.
        Never raises.
        """
        client = self.client()
        if client is None:
            return None
        try:
            from google.cloud import firestore as gcf

            doc_ref = client.collection(
                self.config.FIRESTORE_PREDICTIONS_COLLECTION
            ).document()

            payload = dict(document)
            payload["created_at"] = gcf.SERVER_TIMESTAMP
            expires_at = self._expiry()
            if expires_at is not None:
                payload["expires_at"] = expires_at

            stats_ref = client.collection(
                self.config.FIRESTORE_STATS_COLLECTION
            ).document(self.config.FIRESTORE_STATS_DOC)

            personality_type = document.get("personality_type") or "unknown"
            stats_update = {
                "total": gcf.Increment(1),
                "types": {personality_type: gcf.Increment(1)},
                "updated_at": gcf.SERVER_TIMESTAMP,
            }

            batch = client.batch()
            batch.set(doc_ref, payload)
            # merge=True so the stats doc does not need to pre-exist and other
            # type counters are preserved.
            batch.set(stats_ref, stats_update, merge=True)
            batch.commit(**self._call_kwargs())

            log.info(
                "prediction_saved",
                extra={
                    "doc_id": doc_ref.id,
                    "personality_type": personality_type,
                },
            )
            return doc_ref.id
        except Exception as exc:
            log.warning(
                "prediction_save_failed",
                extra={"error": str(exc), "exc_type": type(exc).__name__},
            )
            return None

    # ------------------------------------------------------------------ reads
    def recent_predictions(self, limit=20, personality_type=None):
        """Most recent predictions, newest first. Returns [] when degraded."""
        client = self.client()
        if client is None:
            return []
        try:
            from google.cloud import firestore as gcf

            query = client.collection(self.config.FIRESTORE_PREDICTIONS_COLLECTION)
            if personality_type:
                query = query.where(
                    filter=gcf.FieldFilter(
                        "personality_type", "==", personality_type.upper()
                    )
                )
            query = query.order_by(
                "created_at", direction=gcf.Query.DESCENDING
            ).limit(int(limit))

            out = []
            for snapshot in query.stream(**self._call_kwargs()):
                out.append(self._to_public_dict(snapshot))
            return out
        except Exception as exc:
            log.warning(
                "recent_predictions_failed",
                extra={"error": str(exc), "exc_type": type(exc).__name__},
            )
            return []

    def stats(self):
        """Aggregate counters, or None when degraded."""
        client = self.client()
        if client is None:
            return None
        try:
            snapshot = (
                client.collection(self.config.FIRESTORE_STATS_COLLECTION)
                .document(self.config.FIRESTORE_STATS_DOC)
                .get(**self._call_kwargs())
            )
            if not snapshot.exists:
                return {"total": 0, "types": {}}
            data = snapshot.to_dict() or {}
            return {
                "total": int(data.get("total") or 0),
                "types": {
                    str(k): int(v)
                    for k, v in (data.get("types") or {}).items()
                    if isinstance(v, (int, float))
                },
                "updated_at": _iso(data.get("updated_at")),
            }
        except Exception as exc:
            log.warning(
                "stats_read_failed",
                extra={"error": str(exc), "exc_type": type(exc).__name__},
            )
            return None

    def ping(self):
        """Cheap connectivity probe for the readiness endpoint.

        Returns (ok, detail). A document read is used rather than a write so
        that probes cost nothing and cannot pollute data.
        """
        if not self.enabled:
            return True, "disabled"
        client = self.client()
        if client is None:
            return False, self._init_error or "client unavailable"
        try:
            client.collection(self.config.FIRESTORE_STATS_COLLECTION).document(
                self.config.FIRESTORE_STATS_DOC
            ).get(timeout=min(2.0, self.config.FIRESTORE_TIMEOUT_SECONDS))
            return True, "ok"
        except Exception as exc:
            return False, "%s: %s" % (type(exc).__name__, exc)

    def _to_public_dict(self, snapshot):
        """Map a snapshot to the JSON we are willing to expose.

        Allow-list, not the raw document: `client_ip_hash` and `user_agent`
        stay server-side.
        """
        data = snapshot.to_dict() or {}
        return {
            "id": snapshot.id,
            "text": data.get("text"),
            "text_length": data.get("text_length"),
            "personality_type": data.get("personality_type"),
            "axes": data.get("axes") or {},
            "model_version": data.get("model_version"),
            "source": data.get("source"),
            "created_at": _iso(data.get("created_at")),
        }


def _iso(value):
    """Firestore timestamps -> ISO-8601 strings; anything else -> None."""
    if value is None:
        return None
    try:
        if hasattr(value, "isoformat"):
            return value.isoformat()
        if hasattr(value, "rfc3339"):
            return value.rfc3339()
    except Exception:  # pragma: no cover
        return None
    return None
