"""Unit tests for the Firestore repository.

Firestore itself is never contacted: the document-building, hashing and
credential-parsing logic is pure, and the write path is exercised against a
fake client that records the batch operations.
"""
import base64
import json

import pytest

from mbpp.config import TestingConfig
from mbpp.firestore_repo import FirestoreRepository


class Config(TestingConfig):
    DATABASE_ENABLED = True
    DATABASE_BACKEND = "firestore"
    IP_HASH_SALT = "unit-test-salt"
    STORE_RAW_TEXT = True
    STORED_TEXT_MAX_CHARS = 10
    PREDICTION_TTL_DAYS = 30


RESULT = {
    "personality_type": "ENTJ",
    "axes": {"ei": {"letter": "E", "probability": 0.8}},
    "model_version": "sha256:abc",
}


@pytest.fixture
def repo():
    return FirestoreRepository(Config)


class TestDocumentBuilding:
    def test_includes_hash_and_metadata(self, repo):
        document = repo.build_document(
            text="hello world",
            result=RESULT,
            source="api",
            request_id="req-1",
            latency_ms=42,
        )
        assert document["personality_type"] == "ENTJ"
        assert document["text_sha256"] == repo.hash_text("hello world")
        assert document["text_length"] == 11
        assert document["latency_ms"] == 42
        assert document["source"] == "api"

    def test_truncates_stored_text_and_flags_it(self, repo):
        document = repo.build_document(text="x" * 50, result=RESULT)
        assert document["text"] == "x" * 10
        assert document["truncated"] is True
        # The full length is still recorded even though the text is truncated.
        assert document["text_length"] == 50

    def test_omits_text_when_storage_is_disabled(self):
        class NoText(Config):
            STORE_RAW_TEXT = False

        document = FirestoreRepository(NoText).build_document(
            text="sensitive content", result=RESULT
        )
        assert document["text"] is None
        # The hash survives, so duplicate submissions are still detectable.
        assert document["text_sha256"]

    def test_hashes_ip_with_salt(self, repo):
        document = repo.build_document(
            text="hello world", result=RESULT, client_ip="203.0.113.7"
        )
        assert document["client_ip_hash"] != "203.0.113.7"
        assert document["client_ip_hash"] == repo.hash_ip("203.0.113.7")

    def test_drops_ip_entirely_without_a_salt(self):
        class NoSalt(Config):
            IP_HASH_SALT = ""

        repo = FirestoreRepository(NoSalt)
        document = repo.build_document(
            text="hello world", result=RESULT, client_ip="203.0.113.7"
        )
        assert "client_ip_hash" not in document

    def test_truncates_user_agent(self, repo):
        document = repo.build_document(
            text="hello world", result=RESULT, user_agent="U" * 500
        )
        assert len(document["user_agent"]) == 256


class TestCredentialParsing:
    def test_parses_raw_json(self):
        info = {"type": "service_account", "project_id": "mbpp-7347c"}
        assert FirestoreRepository._parse_service_account(json.dumps(info)) == info

    def test_parses_base64_json(self):
        info = {"type": "service_account", "project_id": "mbpp-7347c"}
        encoded = base64.b64encode(json.dumps(info).encode("utf-8")).decode("ascii")
        assert FirestoreRepository._parse_service_account(encoded) == info

    def test_rejects_garbage_with_a_clear_message(self):
        with pytest.raises(RuntimeError, match="neither valid JSON nor base64"):
            FirestoreRepository._parse_service_account("not json {{{")


class TestDegradedBehaviour:
    def test_disabled_repo_is_a_no_op(self):
        repo = FirestoreRepository(TestingConfig)  # DATABASE_ENABLED = False
        assert repo.enabled is False
        assert repo.client() is None
        assert repo.save_prediction({"personality_type": "INFP"}) is None
        assert repo.recent_predictions() == []
        assert repo.stats() is None
        assert repo.ping() == (True, "disabled")

    def test_write_failure_is_swallowed(self, repo, monkeypatch):
        class ExplodingClient(object):
            def collection(self, _name):
                raise RuntimeError("firestore is down")

        monkeypatch.setattr(repo, "client", lambda: ExplodingClient())
        assert repo.save_prediction({"personality_type": "INFP"}) is None

    def test_read_failure_returns_empty_list(self, repo, monkeypatch):
        class ExplodingClient(object):
            def collection(self, _name):
                raise RuntimeError("firestore is down")

        monkeypatch.setattr(repo, "client", lambda: ExplodingClient())
        assert repo.recent_predictions() == []
        assert repo.stats() is None

    def test_init_failure_is_not_retried_per_request(self, repo, monkeypatch):
        attempts = []

        def failing_build():
            attempts.append(1)
            raise RuntimeError("no credentials")

        monkeypatch.setattr(repo, "_build_client", failing_build)
        assert repo.client() is None
        assert repo.client() is None
        assert len(attempts) == 1


class TestWritePath:
    """Verify the batch shape without a real Firestore."""

    def test_single_batch_writes_document_and_counters(self, repo, monkeypatch):
        recorded = {"sets": [], "commits": 0}

        class FakeDocRef(object):
            def __init__(self, doc_id):
                self.id = doc_id

        class FakeCollection(object):
            def __init__(self, name):
                self.name = name

            def document(self, doc_id=None):
                return FakeDocRef(doc_id or "generated-id")

        class FakeBatch(object):
            def set(self, ref, payload, merge=False):
                recorded["sets"].append((ref, payload, merge))

            def commit(self, **kwargs):
                recorded["commits"] += 1
                recorded["commit_kwargs"] = kwargs

        class FakeClient(object):
            def collection(self, name):
                return FakeCollection(name)

            def batch(self):
                return FakeBatch()

        monkeypatch.setattr(repo, "client", lambda: FakeClient())

        document_id = repo.save_prediction(
            {"personality_type": "ENTJ", "text": "hello world"}
        )

        assert document_id == "generated-id"
        # One RPC for both the document and the aggregate counters.
        assert recorded["commits"] == 1
        assert len(recorded["sets"]) == 2

        prediction_payload = recorded["sets"][0][1]
        assert "created_at" in prediction_payload
        assert "expires_at" in prediction_payload  # TTL enabled in this config

        stats_ref, stats_payload, merge = recorded["sets"][1]
        assert merge is True
        assert "total" in stats_payload
        assert "ENTJ" in stats_payload["types"]
        assert recorded["commit_kwargs"]["timeout"] == Config.DB_TIMEOUT_SECONDS

    def test_ttl_field_omitted_when_disabled(self, monkeypatch):
        class NoTtl(Config):
            PREDICTION_TTL_DAYS = 0

        repo = FirestoreRepository(NoTtl)
        assert repo._expiry() is None
