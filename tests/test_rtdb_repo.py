"""Unit tests for the Realtime Database repository.

No network: a fake stand-in for `firebase_admin.db` records what the repository
would send. The RTDB-specific behaviour worth pinning is the query shape --
push-key ordering for history, `equal_to` for the type filter, and a
compare-and-set transaction for the counters.
"""
import pytest

from mbpp.config import TestingConfig
from mbpp.repository import DisabledRepository, create_repository
from mbpp.rtdb_repo import RealtimeDatabaseRepository, _iso


class Config(TestingConfig):
    DATABASE_ENABLED = True
    DATABASE_BACKEND = "rtdb"
    FIREBASE_PROJECT_ID = "mbpp-7347c"
    FIREBASE_DATABASE_URL = "https://mbpp-7347c-default-rtdb.firebaseio.com"
    IP_HASH_SALT = "unit-test-salt"
    STORE_RAW_TEXT = True
    STORED_TEXT_MAX_CHARS = 10
    PREDICTION_TTL_DAYS = 30
    RTDB_PREDICTIONS_PATH = "predictions"
    RTDB_STATS_PATH = "stats"


RESULT = {
    "personality_type": "ENTJ",
    "axes": {"ei": {"letter": "E", "probability": 0.8}},
    "model_version": "sha256:abc",
}


# --------------------------------------------------------------------- fakes
class FakeQuery(object):
    def __init__(self, ref, kind, value=None):
        self.ref = ref
        self.kind = kind
        self.value = value
        self._limit = None
        self._equal_to = None

    def equal_to(self, value):
        self._equal_to = value
        return self

    def limit_to_last(self, count):
        self._limit = count
        return self

    def limit_to_first(self, count):
        self._limit = count
        return self

    def end_at(self, value):
        return self

    def get(self):
        self.ref.calls.append(
            {
                "op": "query",
                "kind": self.kind,
                "child": self.value,
                "equal_to": self._equal_to,
                "limit": self._limit,
            }
        )
        data = self.ref.store
        if self._equal_to is not None:
            data = {
                key: value
                for key, value in data.items()
                if value.get(self.value) == self._equal_to
            }
        # RTDB returns ascending order; keys here are chosen to sort that way.
        items = sorted(data.items())
        if self._limit:
            items = items[-self._limit:]
        return dict(items)


class FakeReference(object):
    def __init__(self, path, store=None, calls=None, counter=None):
        self.path = path
        self.store = store if store is not None else {}
        self.calls = calls if calls is not None else []
        # Shared across every reference to the same database, mirroring RTDB:
        # a per-reference counter would hand out colliding keys.
        self.counter = counter if counter is not None else [0]
        self.key = None

    # writes -------------------------------------------------------------
    def push(self, value):
        self.counter[0] += 1
        # Mimic a push key: lexicographically increasing with time.
        key = "-Nx%08d" % self.counter[0]
        self.store[key] = value
        self.calls.append({"op": "push", "path": self.path, "value": value})
        child = FakeReference(
            self.path + "/" + key, self.store, self.calls, self.counter
        )
        child.key = key
        return child

    def set(self, value):
        self.calls.append({"op": "set", "path": self.path, "value": value})
        self.store.clear()
        if isinstance(value, dict):
            self.store.update(value)

    def update(self, values):
        self.calls.append({"op": "update", "path": self.path, "value": values})
        for key, value in values.items():
            if value is None:
                self.store.pop(key, None)
            else:
                self.store[key] = value

    def transaction(self, function):
        self.calls.append({"op": "transaction", "path": self.path})
        current = dict(self.store) if self.store else None
        result = function(current)
        self.store.clear()
        self.store.update(result)
        return result

    # reads --------------------------------------------------------------
    def get(self, shallow=False):
        self.calls.append({"op": "get", "path": self.path, "shallow": shallow})
        return dict(self.store)

    def order_by_key(self):
        return FakeQuery(self, "key")

    def order_by_child(self, child):
        return FakeQuery(self, "child", child)


class FakeServerValue(object):
    TIMESTAMP = {"__sv__": "timestamp"}


class FakeDb(object):
    """Stands in for the `firebase_admin.db` module."""

    ServerValue = FakeServerValue

    def __init__(self):
        self.stores = {}
        self.calls = []
        self.counter = [0]

    def reference(self, path, app=None):
        store = self.stores.setdefault(path, {})
        return FakeReference(path, store, self.calls, self.counter)


@pytest.fixture
def repo():
    repository = RealtimeDatabaseRepository(Config)
    fake_db = FakeDb()
    from mbpp.rtdb_repo import _RtdbHandle

    repository._client = _RtdbHandle(fake_db, object())
    repository.fake_db = fake_db
    return repository


# --------------------------------------------------------------------- tests
class TestBackendSelection:
    def test_rtdb_is_the_default(self):
        assert create_repository(Config).backend == "rtdb"

    def test_firestore_can_be_selected(self):
        class FirestoreConfig(Config):
            DATABASE_BACKEND = "firestore"

        assert create_repository(FirestoreConfig).backend == "firestore"

    def test_disabled_config_yields_a_no_op_repository(self):
        repository = create_repository(TestingConfig)  # DATABASE_ENABLED = False
        assert isinstance(repository, DisabledRepository)
        assert repository.save_prediction({}) is None
        assert repository.recent_predictions() == []
        assert repository.stats() is None
        assert repository.ping() == (True, "disabled")

    def test_unknown_backend_fails_loudly(self):
        class BadConfig(Config):
            DATABASE_BACKEND = "mysql"

        with pytest.raises(RuntimeError, match="unknown DATABASE_BACKEND"):
            create_repository(BadConfig)

    def test_missing_database_url_is_a_config_error(self):
        class NoUrl(Config):
            ENV = "production"
            TESTING = False
            SECRET_KEY = "x"
            FIREBASE_DATABASE_URL = ""

        problems = NoUrl.validate()
        assert any("FIREBASE_DATABASE_URL" in problem for problem in problems)


class TestWritePath:
    def test_push_stores_the_prediction_with_a_server_timestamp(self, repo):
        record_id = repo.save_prediction(
            {"personality_type": "ENTJ", "text": "hello world"}
        )

        assert record_id.startswith("-Nx")
        stored = repo.fake_db.stores["predictions"][record_id]
        assert stored["personality_type"] == "ENTJ"
        # Server-authoritative time: never the client's clock.
        assert stored["created_at"] == FakeServerValue.TIMESTAMP
        assert "expires_at" in stored  # TTL configured in this config

    def test_counters_increment_transactionally(self, repo):
        repo.save_prediction({"personality_type": "ENTJ"})
        repo.save_prediction({"personality_type": "ENTJ"})
        repo.save_prediction({"personality_type": "INFP"})

        stats = repo.fake_db.stores["stats"]
        assert stats["total"] == 3
        assert stats["types"] == {"ENTJ": 2, "INFP": 1}

        transactions = [c for c in repo.fake_db.calls if c["op"] == "transaction"]
        assert len(transactions) == 3

    def test_counter_failure_does_not_lose_the_prediction(self, repo, monkeypatch):
        """A failed counter transaction must leave the prediction stored.

        The counters are a separate round trip, so this is a real partial
        failure: the record is written, only the totals go stale (recoverable
        with tools/rebuild_stats.py).
        """

        def explode(_function):
            raise RuntimeError("transaction retries exhausted")

        monkeypatch.setattr(FakeReference, "transaction", explode, raising=True)

        record_id = repo.save_prediction({"personality_type": "ENTJ"})

        assert record_id is not None
        assert len(repo.fake_db.stores["predictions"]) == 1

    def test_write_failure_returns_none(self, repo, monkeypatch):
        class ExplodingDb(object):
            ServerValue = FakeServerValue

            def reference(self, path, app=None):
                raise RuntimeError("rtdb is down")

        from mbpp.rtdb_repo import _RtdbHandle

        repo._client = _RtdbHandle(ExplodingDb(), object())
        assert repo.save_prediction({"personality_type": "INFP"}) is None

    def test_type_codes_are_sanitised_for_use_as_keys(self, repo):
        # RTDB rejects . $ # [ ] / in keys.
        repo.save_prediction({"personality_type": "IN/FP"})
        assert "IN_FP" in repo.fake_db.stores["stats"]["types"]

    def test_ttl_field_omitted_when_disabled(self, repo):
        class NoTtl(Config):
            PREDICTION_TTL_DAYS = 0

        repo.config = NoTtl
        record_id = repo.save_prediction({"personality_type": "ENTJ"})
        assert "expires_at" not in repo.fake_db.stores["predictions"][record_id]


class TestReadPath:
    def test_history_is_newest_first(self, repo):
        for index in range(3):
            repo.save_prediction(
                {"personality_type": "INFP", "text": "snippet %d" % index}
            )

        items = repo.recent_predictions(limit=10)
        assert [item["text"] for item in items] == [
            "snippet 2",
            "snippet 1",
            "snippet 0",
        ]

    def test_history_orders_by_push_key(self, repo):
        repo.save_prediction({"personality_type": "INFP"})
        repo.recent_predictions(limit=5)

        query = [c for c in repo.fake_db.calls if c["op"] == "query"][-1]
        # Push keys are chronological, so no timestamp index is needed.
        assert query["kind"] == "key"
        assert query["limit"] == 5

    def test_type_filter_uses_an_indexed_equality_query(self, repo):
        repo.save_prediction({"personality_type": "INFP", "text": "a"})
        repo.save_prediction({"personality_type": "ENTJ", "text": "b"})

        items = repo.recent_predictions(limit=10, personality_type="infp")
        assert [item["text"] for item in items] == ["a"]

        query = [c for c in repo.fake_db.calls if c["op"] == "query"][-1]
        assert query["kind"] == "child"
        assert query["child"] == "personality_type"
        assert query["equal_to"] == "INFP"

    def test_limit_is_respected(self, repo):
        for index in range(5):
            repo.save_prediction({"personality_type": "INFP", "text": str(index)})
        assert len(repo.recent_predictions(limit=2)) == 2

    def test_public_projection_hides_client_identifiers(self, repo):
        repo.save_prediction(
            {
                "personality_type": "INFP",
                "text": "visible",
                "client_ip_hash": "secret-hash",
                "user_agent": "curl/8",
            }
        )
        item = repo.recent_predictions()[0]
        assert item["text"] == "visible"
        assert "client_ip_hash" not in item
        assert "user_agent" not in item
        assert "_sort_key" not in item

    def test_stats_are_normalised(self, repo):
        repo.save_prediction({"personality_type": "INFP"})
        stats = repo.stats()
        assert stats["total"] == 1
        assert stats["types"] == {"INFP": 1}

    def test_read_failure_degrades_quietly(self, repo):
        class ExplodingDb(object):
            ServerValue = FakeServerValue

            def reference(self, path, app=None):
                raise RuntimeError("rtdb is down")

        from mbpp.rtdb_repo import _RtdbHandle

        repo._client = _RtdbHandle(ExplodingDb(), object())
        assert repo.recent_predictions() == []
        assert repo.stats() is None

    def test_ping_reads_shallowly(self, repo):
        assert repo.ping() == (True, "ok")
        get_calls = [c for c in repo.fake_db.calls if c["op"] == "get"]
        assert get_calls[-1]["shallow"] is True


class TestTimestampConversion:
    def test_milliseconds_become_iso(self):
        assert _iso(1767225600000).startswith("2026-01-01T")

    def test_unresolved_server_timestamp_is_none(self):
        # Between push and the server's callback, created_at is a sentinel dict.
        assert _iso({"__sv__": "timestamp"}) is None

    def test_none_is_none(self):
        assert _iso(None) is None


class TestSharedDocumentBuilding:
    """The privacy-relevant logic lives in BaseRepository; verify via RTDB."""

    def test_truncates_text_and_records_true_length(self, repo):
        document = repo.build_document(text="x" * 50, result=RESULT)
        assert document["text"] == "x" * 10
        assert document["truncated"] is True
        assert document["text_length"] == 50

    def test_ip_is_hashed_with_the_salt(self, repo):
        document = repo.build_document(
            text="hello world", result=RESULT, client_ip="203.0.113.7"
        )
        assert document["client_ip_hash"] == repo.hash_ip("203.0.113.7")
        assert "203.0.113.7" not in str(document)

    def test_ip_dropped_without_a_salt(self, repo):
        class NoSalt(Config):
            IP_HASH_SALT = ""

        repo.config = NoSalt
        document = repo.build_document(
            text="hello world", result=RESULT, client_ip="203.0.113.7"
        )
        assert "client_ip_hash" not in document
