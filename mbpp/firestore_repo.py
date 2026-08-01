"""Cloud Firestore persistence (alternative backend).

Active only when `DATABASE_BACKEND=firestore`; the default is the Realtime
Database (see mbpp/rtdb_repo.py), which is what this project's Firebase console
has provisioned. Kept because Firestore is the better fit once history grows:
server-side TTL policies, composite indexes and queries that do not require
pulling a slice of the tree.

Shared hashing, document assembly and credential handling live in
mbpp/repository.py. What is Firestore-specific here:

* **One round trip per prediction.** The document write and the aggregate
  counter increment go in a single `WriteBatch`, halving both latency and
  billed operations.
* **Counters, not scans.** `/stats/global` is maintained with atomic
  `Increment`, so the stats endpoint is one document read regardless of how
  many predictions exist.
* **Server-side expiry.** `expires_at` is a real timestamp that a Firestore TTL
  policy acts on -- no pruning cron needed, unlike RTDB.
* **Admin credentials.** This process bypasses security rules, so
  `firestore.rules` denies all direct client access.
"""
import logging

from .repository import BaseRepository

log = logging.getLogger(__name__)


class FirestoreRepository(BaseRepository):
    backend = "firestore"

    @property
    def emulated(self):
        import os

        return bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))

    def _build_client(self):
        project_id = self.config.FIREBASE_PROJECT_ID
        database = getattr(self.config, "FIRESTORE_DATABASE", "(default)") or "(default)"

        if self.emulated:
            # The emulator accepts any credentials; the Admin SDK would still
            # insist on resolving real ones, so bypass it entirely.
            from google.auth.credentials import AnonymousCredentials
            from google.cloud import firestore as gcf

            kwargs = {
                "project": project_id or "demo-mbpp",
                "credentials": AnonymousCredentials(),
            }
            if database != "(default)":
                kwargs["database"] = database
            return gcf.Client(**kwargs)

        from firebase_admin import firestore

        options = {}
        if project_id:
            options["projectId"] = project_id
        app = self._firebase_app("mbpp-firestore", options)

        if database != "(default)":
            try:
                return firestore.client(app=app, database_id=database)
            except TypeError:  # firebase-admin < 6.5 has no database_id
                log.warning(
                    "firestore_named_database_unsupported",
                    extra={"database": database},
                )
        return firestore.client(app=app)

    # --------------------------------------------------------------- helpers
    def _call_kwargs(self):
        """Timeout + retry policy applied to every Firestore RPC."""
        timeout = float(getattr(self.config, "DB_TIMEOUT_SECONDS", 5.0))
        kwargs = {"timeout": timeout}
        retries = int(getattr(self.config, "DB_RETRIES", 0) or 0)
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
                    deadline=timeout * (retries + 1),
                )
            except ImportError:  # pragma: no cover
                pass
        return kwargs

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
            # merge=True so the stats doc need not pre-exist and other type
            # counters are preserved.
            batch.set(stats_ref, stats_update, merge=True)
            batch.commit(**self._call_kwargs())

            log.info(
                "prediction_saved",
                extra={
                    "record_id": doc_ref.id,
                    "personality_type": personality_type,
                    "backend": self.backend,
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

            return [
                self._to_public_dict(snapshot)
                for snapshot in query.stream(**self._call_kwargs())
            ]
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
                    str(key): int(value)
                    for key, value in (data.get("types") or {}).items()
                    if isinstance(value, (int, float))
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
        """Cheap connectivity probe: a document read, never a write."""
        if not self.enabled:
            return True, "disabled"
        client = self.client()
        if client is None:
            return False, self._init_error or "client unavailable"
        try:
            timeout = float(getattr(self.config, "DB_TIMEOUT_SECONDS", 5.0))
            client.collection(self.config.FIRESTORE_STATS_COLLECTION).document(
                self.config.FIRESTORE_STATS_DOC
            ).get(timeout=min(2.0, timeout))
            return True, "ok"
        except Exception as exc:
            return False, "%s: %s" % (type(exc).__name__, exc)

    def _to_public_dict(self, snapshot):
        data = snapshot.to_dict() or {}
        record = self.public_fields(snapshot.id, data)
        record["created_at"] = _iso(data.get("created_at"))
        return record


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
