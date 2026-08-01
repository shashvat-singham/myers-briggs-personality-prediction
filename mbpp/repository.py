"""Storage-agnostic repository base and backend selection.

Two Firebase databases can back this app, and they are genuinely different
products, not two names for one thing:

* **Realtime Database** (`DATABASE_BACKEND=rtdb`, the default) -- one JSON tree,
  push keys that sort chronologically, atomic counters via transactions, no TTL.
* **Cloud Firestore** (`DATABASE_BACKEND=firestore`) -- documents and
  collections, composite indexes, server-side TTL policies.

Everything above the repository (routes, service layer, templates) talks to this
interface only, so switching backends is an env var plus a rules deploy.

Shared here: input hashing, document assembly and credential resolution --
identical in both backends and the part with the privacy decisions in it.
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


class BaseRepository(object):
    """Common behaviour for the Firebase-backed repositories.

    Subclasses implement `_build_client`, `save_prediction`,
    `recent_predictions`, `stats` and `ping`.
    """

    #: Human-readable backend name, surfaced by /readyz and /api/v1/meta.
    backend = "unknown"

    def __init__(self, config):
        self.config = config
        self._client = None
        self._lock = threading.Lock()
        self._init_failed = False
        self._init_error = None

    # ------------------------------------------------------------------ setup
    @property
    def enabled(self):
        return bool(getattr(self.config, "DATABASE_ENABLED", False))

    @property
    def emulated(self):
        return False

    def client(self):
        """Return the backend handle, or None if unavailable.

        Initialisation is attempted once. After a hard failure the repository
        stays degraded rather than re-resolving credentials on every request.
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
                    "database_initialised",
                    extra={
                        "backend": self.backend,
                        "project_id": self.config.FIREBASE_PROJECT_ID,
                        "emulator": self.emulated,
                    },
                )
            except Exception as exc:  # pragma: no cover - credential paths
                self._init_failed = True
                self._init_error = str(exc)
                log.error(
                    "database_init_failed",
                    extra={
                        "backend": self.backend,
                        "error": str(exc),
                        "exc_type": type(exc).__name__,
                    },
                )
                return None
        return self._client

    def _build_client(self):  # pragma: no cover - implemented by subclasses
        raise NotImplementedError

    # ------------------------------------------------------- firebase app/creds
    def _firebase_app(self, app_name, options):
        """Return a named firebase_admin app, creating it once.

        A named app (rather than the default one) keeps this process's
        credentials from colliding with anything else that might initialise
        firebase_admin, and makes the app safe to look up repeatedly.
        """
        import firebase_admin
        from firebase_admin import credentials

        try:
            return firebase_admin.get_app(app_name)
        except ValueError:
            return firebase_admin.initialize_app(
                self._resolve_credentials(credentials), options, name=app_name
            )

    def _resolve_credentials(self, credentials):
        """Pick credentials in order of explicitness.

        1. `FIREBASE_SERVICE_ACCOUNT_JSON` -- inline JSON or base64 of it, for
           platforms that only offer env vars (Render, Fly, Netlify build).
        2. `GOOGLE_APPLICATION_CREDENTIALS` -- a key file path.
        3. Application Default Credentials -- the right answer on Cloud Run,
           where the runtime service account is injected and no key exists.
        """
        inline = (
            getattr(self.config, "FIREBASE_SERVICE_ACCOUNT_JSON", "") or ""
        ).strip()
        if inline:
            return credentials.Certificate(self._parse_service_account(inline))

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

    # -------------------------------------------------------------- hashing
    def hash_text(self, text):
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def hash_ip(self, ip):
        """Salted hash, or None when no salt is configured.

        An unsalted IP hash is reversible by brute force over the IPv4 space,
        so storing one would be worse than storing nothing.
        """
        salt = (getattr(self.config, "IP_HASH_SALT", "") or "").strip()
        if not salt or not ip:
            return None
        return hashlib.sha256(("%s|%s" % (salt, ip)).encode("utf-8")).hexdigest()

    def _expiry(self):
        """Deadline after which a prediction may be deleted, or None."""
        days = int(getattr(self.config, "PREDICTION_TTL_DAYS", 0) or 0)
        if days <= 0:
            return None
        return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            days=days
        )

    # ------------------------------------------------------- document shaping
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
        """Assemble the record for a prediction (pure; no I/O)."""
        stored_text = None
        truncated = False
        if getattr(self.config, "STORE_RAW_TEXT", False):
            limit = int(self.config.STORED_TEXT_MAX_CHARS)
            stored_text = text[:limit]
            truncated = len(text) > limit

        document = {
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
        # Keep an explicit null for `text` (it records that storage was off);
        # drop the other absent fields entirely.
        return {k: v for k, v in document.items() if v is not None or k == "text"}

    def public_fields(self, record_id, data):
        """Map a stored record to the JSON we are willing to expose.

        An allow-list, not the raw record: `client_ip_hash` and `user_agent`
        stay server-side.
        """
        return {
            "id": record_id,
            "text": data.get("text"),
            "text_length": data.get("text_length"),
            "personality_type": data.get("personality_type"),
            "axes": data.get("axes") or {},
            "model_version": data.get("model_version"),
            "source": data.get("source"),
            "created_at": data.get("created_at"),
        }

    # ------------------------------------------------- interface (subclasses)
    def save_prediction(self, document):  # pragma: no cover
        raise NotImplementedError

    def recent_predictions(self, limit=20, personality_type=None):  # pragma: no cover
        raise NotImplementedError

    def stats(self):  # pragma: no cover
        raise NotImplementedError

    def ping(self):  # pragma: no cover
        raise NotImplementedError


class DisabledRepository(BaseRepository):
    """No-op repository used when persistence is switched off.

    Lets the rest of the app stay oblivious: predictions simply report
    `stored: false` instead of every call site checking a flag.
    """

    backend = "disabled"

    @property
    def enabled(self):
        return False

    def client(self):
        return None

    def save_prediction(self, document):
        return None

    def recent_predictions(self, limit=20, personality_type=None):
        return []

    def stats(self):
        return None

    def ping(self):
        return True, "disabled"


def create_repository(config):
    """Build the repository named by `DATABASE_BACKEND`."""
    if not getattr(config, "DATABASE_ENABLED", False):
        return DisabledRepository(config)

    backend = (getattr(config, "DATABASE_BACKEND", "rtdb") or "rtdb").strip().lower()

    if backend in ("rtdb", "realtime", "realtime_database", "database"):
        from .rtdb_repo import RealtimeDatabaseRepository

        return RealtimeDatabaseRepository(config)

    if backend == "firestore":
        from .firestore_repo import FirestoreRepository

        return FirestoreRepository(config)

    raise RuntimeError(
        "unknown DATABASE_BACKEND %r (expected 'rtdb' or 'firestore')" % backend
    )
