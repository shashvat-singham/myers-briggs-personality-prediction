"""Shared fixtures.

The tests never load the real joblib artifacts: they need scikit-learn 0.23 on
Python 3.8 (see requirements.txt) and add seconds per case. A stub predictor is
installed instead, so the suite verifies the HTTP contract, validation,
persistence wiring and error handling on any modern interpreter. Tests that
genuinely need the models are marked `models` and skip when unavailable.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mbpp import create_app  # noqa: E402


class StubPredictor(object):
    """Stand-in for mbpp.predictor.Predictor with the same surface."""

    def __init__(self, personality_type="INFP", fail_with=None):
        self.personality_type = personality_type
        self.fail_with = fail_with
        self.calls = []
        self.loaded = True

    def predict(self, text):
        if self.fail_with:
            raise self.fail_with
        self.calls.append(text)
        return {
            "personality_type": self.personality_type,
            "axes": {
                "ei": {"name": "extraversion", "letter": self.personality_type[0],
                       "probability": 0.71, "confidence": 0.42},
                "sn": {"name": "sensing", "letter": self.personality_type[1],
                       "probability": 0.66, "confidence": 0.32},
                "tf": {"name": "thinking", "letter": self.personality_type[2],
                       "probability": 0.58, "confidence": 0.16},
                "jp": {"name": "judging", "letter": self.personality_type[3],
                       "probability": 0.63, "confidence": 0.26},
            },
            "model_version": "test-model",
            "features_ms": 1,
            "inference_ms": 1,
        }

    def model_version(self):
        return "test-model"

    def missing_artifacts(self):
        return []


class FakeRepository(object):
    """In-memory stand-in for FirestoreRepository."""

    def __init__(self, enabled=True, fail_writes=False):
        self._enabled = enabled
        self.fail_writes = fail_writes
        self.saved = []
        self.next_id = 1

    @property
    def enabled(self):
        return self._enabled

    def client(self):
        return object() if self._enabled else None

    def build_document(self, text, result, **kwargs):
        document = {
            "text": text,
            "text_sha256": "hash-of-%s" % text[:8],
            "text_length": len(text),
            "personality_type": result.get("personality_type"),
            "axes": result.get("axes") or {},
            "model_version": result.get("model_version"),
        }
        document.update({k: v for k, v in kwargs.items() if v is not None})
        return document

    def save_prediction(self, document):
        if self.fail_writes:
            return None  # matches the real repo: degrade, never raise
        document_id = "doc-%d" % self.next_id
        self.next_id += 1
        self.saved.append(document)
        return document_id

    def recent_predictions(self, limit=20, personality_type=None):
        items = list(reversed(self.saved))
        if personality_type:
            items = [i for i in items if i.get("personality_type") == personality_type]
        return [
            {
                "id": "doc-%d" % (index + 1),
                "text": item.get("text"),
                "personality_type": item.get("personality_type"),
                "axes": item.get("axes"),
                "created_at": "2026-01-01T00:00:00+00:00",
                "source": item.get("source"),
            }
            for index, item in enumerate(items[:limit])
        ]

    def stats(self):
        counts = {}
        for item in self.saved:
            key = item.get("personality_type")
            counts[key] = counts.get(key, 0) + 1
        return {"total": len(self.saved), "types": counts, "updated_at": None}

    def ping(self):
        return (True, "ok") if self._enabled else (True, "disabled")


@pytest.fixture
def stub_predictor():
    return StubPredictor()


@pytest.fixture
def fake_repo():
    return FakeRepository()


@pytest.fixture
def app(stub_predictor, fake_repo):
    application = create_app("testing")
    application.extensions["predictor"] = stub_predictor
    application.extensions["firestore_repo"] = fake_repo
    return application


@pytest.fixture
def client(app):
    return app.test_client()
