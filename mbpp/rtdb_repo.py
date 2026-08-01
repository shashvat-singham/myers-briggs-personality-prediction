"""Firebase Realtime Database persistence.

Data layout under the database root:

    predictions/
      -NxAbC1234...      <- push key, chronologically sortable
        text, text_sha256, text_length, truncated,
        personality_type, axes/{ei,sn,tf,jp},
        model_version, latency_ms, source, request_id,
        client_ip_hash, user_agent,
        created_at        <- ServerValue.TIMESTAMP (ms since epoch)
        expires_at        <- ms since epoch, or absent when TTL is off
    stats/
      total              <- int
      types/{TYPE}       <- int per MBTI type
      updated_at         <- ms since epoch

Three RTDB-specific decisions worth knowing:

1. **History is ordered by key, not by a timestamp field.** Firebase push keys
   embed their creation time and sort lexicographically, so
   `order_by_key().limit_to_last(n)` returns exactly the n newest records with
   no index and no extra field. RTDB cannot sort descending, so the slice is
   reversed in Python -- cheap, since n is bounded by HISTORY_MAX_PAGE_SIZE.

2. **Filtering by type still comes back newest-last.** RTDB allows only one
   `order_by`, so `order_by_child("personality_type").equal_to(t)` orders by
   that child; ties (all equal, by definition) break by key, which is
   chronological again. One `.indexOn` covers it.

3. **RTDB has no TTL.** Unlike Firestore, nothing expires server-side, so
   `expires_at` is advisory and `tools/prune_predictions.py` does the deleting.
   Left unpruned, the 1 GB free-tier limit is the only backstop.

Counters use `Reference.transaction`, which is a compare-and-set retry loop, so
concurrent predictions cannot lose an increment. The Python Admin SDK does not
expose the `increment` server value, hence a transaction rather than a
fire-and-forget update.
"""
import datetime
import logging

from .repository import BaseRepository

log = logging.getLogger(__name__)

# RTDB rejects these characters in keys, which matters because MBTI type codes
# are used as child keys under stats/types.
_INVALID_KEY_CHARS = ".$#[]/"

# Server-side timestamp sentinel. Unlike the Node/Java SDKs, the Python Admin
# SDK exposes no `db.ServerValue` helper -- the wire format is sent literally,
# and the database substitutes its own clock. Using the client's clock instead
# would let a skewed machine reorder history, since ordering is by key/time.
SERVER_TIMESTAMP = {".sv": "timestamp"}


class RealtimeDatabaseRepository(BaseRepository):
    backend = "rtdb"

    @property
    def emulated(self):
        import os

        return bool(os.environ.get("FIREBASE_DATABASE_EMULATOR_HOST"))

    def _build_client(self):
        """Return the `firebase_admin.db` module bound to our app.

        The RTDB API is module-level rather than client-object based, so the
        "client" here is a small holder of the module plus the app it should
        act on.
        """
        from firebase_admin import db

        database_url = (getattr(self.config, "FIREBASE_DATABASE_URL", "") or "").strip()
        if not database_url and not self.emulated:
            raise RuntimeError(
                "FIREBASE_DATABASE_URL is required for the Realtime Database "
                "backend (e.g. https://mbpp-7347c-default-rtdb.firebaseio.com)"
            )

        options = {
            # The Python SDK has no per-call timeout for RTDB; this app-level
            # setting is what stops a hung request from parking a worker.
            "httpTimeout": float(getattr(self.config, "DB_TIMEOUT_SECONDS", 5.0)),
        }
        if database_url:
            options["databaseURL"] = database_url
        if self.config.FIREBASE_PROJECT_ID:
            options["projectId"] = self.config.FIREBASE_PROJECT_ID

        app = self._firebase_app("mbpp-rtdb", options)
        return _RtdbHandle(db, app)

    # ----------------------------------------------------------------- helpers
    def _predictions_ref(self, handle):
        return handle.db.reference(
            self.config.RTDB_PREDICTIONS_PATH, app=handle.app
        )

    def _stats_ref(self, handle):
        return handle.db.reference(self.config.RTDB_STATS_PATH, app=handle.app)

    @staticmethod
    def _safe_key(value):
        """Make a value usable as an RTDB child key."""
        text = str(value or "unknown")
        for char in _INVALID_KEY_CHARS:
            text = text.replace(char, "_")
        return text or "unknown"

    # ------------------------------------------------------------------ writes
    def save_prediction(self, document):
        """Persist one prediction and bump the counters.

        Returns the push key, or None when the database is unavailable. Never
        raises: persistence is best-effort by design.
        """
        handle = self.client()
        if handle is None:
            return None

        try:
            payload = dict(document)
            payload["created_at"] = SERVER_TIMESTAMP
            expires_at = self._expiry()
            if expires_at is not None:
                payload["expires_at"] = int(expires_at.timestamp() * 1000)

            new_ref = self._predictions_ref(handle).push(payload)
            record_id = new_ref.key
        except Exception as exc:
            log.warning(
                "prediction_save_failed",
                extra={"error": str(exc), "exc_type": type(exc).__name__},
            )
            return None

        # Counters are a separate round trip (RTDB cannot increment inside the
        # same write without the sentinel the Python SDK lacks). A failure here
        # leaves the prediction stored and only the totals stale, which
        # tools/rebuild_stats.py can repair -- so it is logged, not raised.
        self._bump_counters(handle, document.get("personality_type"))
        log.info(
            "prediction_saved",
            extra={
                "record_id": record_id,
                "personality_type": document.get("personality_type"),
                "backend": self.backend,
            },
        )
        return record_id

    def _bump_counters(self, handle, personality_type):
        type_key = self._safe_key(personality_type)

        def increment(current):
            # `current` is the whole stats node, or None on the first write.
            current = current or {}
            types = dict(current.get("types") or {})
            types[type_key] = int(types.get(type_key) or 0) + 1
            return {
                "total": int(current.get("total") or 0) + 1,
                "types": types,
                "updated_at": int(
                    datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000
                ),
            }

        try:
            self._stats_ref(handle).transaction(increment)
        except Exception as exc:
            log.warning(
                "stats_update_failed",
                extra={"error": str(exc), "exc_type": type(exc).__name__},
            )

    # ------------------------------------------------------------------- reads
    def recent_predictions(self, limit=20, personality_type=None):
        """Newest-first predictions. Returns [] when degraded."""
        handle = self.client()
        if handle is None:
            return []

        try:
            limit = max(1, int(limit))
            ref = self._predictions_ref(handle)
            if personality_type:
                query = (
                    ref.order_by_child("personality_type")
                    .equal_to(personality_type.upper())
                    .limit_to_last(limit)
                )
            else:
                # Push keys are time-ordered, so the last n keys are the n most
                # recent records -- no timestamp index required.
                query = ref.order_by_key().limit_to_last(limit)

            snapshot = query.get() or {}
            items = [
                self._to_public_dict(key, value)
                for key, value in snapshot.items()
                if isinstance(value, dict)
            ]
            # RTDB only sorts ascending; the API contract is newest first.
            items.sort(key=lambda item: item.get("_sort_key") or "", reverse=True)
            for item in items:
                item.pop("_sort_key", None)
            return items
        except Exception as exc:
            log.warning(
                "recent_predictions_failed",
                extra={"error": str(exc), "exc_type": type(exc).__name__},
            )
            return []

    def stats(self):
        """Aggregate counters, or None when degraded."""
        handle = self.client()
        if handle is None:
            return None
        try:
            data = self._stats_ref(handle).get() or {}
            if not isinstance(data, dict):
                return {"total": 0, "types": {}}
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
        """Cheap connectivity probe for the readiness endpoint.

        Reads the stats node shallowly: no writes, so probes cannot pollute
        data, and negligible payload even once history is large.
        """
        if not self.enabled:
            return True, "disabled"
        handle = self.client()
        if handle is None:
            return False, self._init_error or "client unavailable"
        try:
            self._stats_ref(handle).get(shallow=True)
            return True, "ok"
        except Exception as exc:
            return False, "%s: %s" % (type(exc).__name__, exc)

    def _to_public_dict(self, key, data):
        record = self.public_fields(key, data)
        record["created_at"] = _iso(data.get("created_at"))
        # Sort on the push key: it is chronological and always present, unlike
        # created_at, which is null for the instant between write and callback.
        record["_sort_key"] = key
        return record


class _RtdbHandle(object):
    """Bundles the `firebase_admin.db` module with the app it should use."""

    def __init__(self, db_module, app):
        self.db = db_module
        self.app = app


def _iso(value):
    """RTDB millisecond timestamps -> ISO-8601 strings."""
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.datetime.fromtimestamp(
                float(value) / 1000.0, tz=datetime.timezone.utc
            ).isoformat()
        if hasattr(value, "isoformat"):
            return value.isoformat()
    except (ValueError, OverflowError, OSError):
        return None
    return None
