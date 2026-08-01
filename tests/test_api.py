"""HTTP contract tests for the JSON API and the HTML routes."""
import pytest

from mbpp.predictor import ModelLoadError
from tests.conftest import StubPredictor


class TestPredictEndpoint:
    def test_returns_type_axes_and_document_id(self, client, fake_repo):
        response = client.post("/api/v1/predict", json={"text": "hello there friend"})

        assert response.status_code == 200
        body = response.get_json()
        assert body["personality_type"] == "INFP"
        assert set(body["axes"]) == {"ei", "sn", "tf", "jp"}
        assert body["axes"]["ei"]["probability"] == 0.71
        assert body["stored"] is True
        assert body["id"] == "doc-1"
        assert body["reference_url"].endswith("/infp-personality")
        assert len(fake_repo.saved) == 1

    def test_persists_prediction_metadata(self, client, fake_repo):
        client.post("/api/v1/predict", json={"text": "a snippet worth storing"})

        document = fake_repo.saved[0]
        assert document["personality_type"] == "INFP"
        assert document["source"] == "api"
        assert document["model_version"] == "test-model"
        assert document["request_id"]

    def test_accepts_legacy_field_names(self, client):
        response = client.post("/api/v1/predict", json={"fsnippet": "legacy field"})
        assert response.status_code == 200

    def test_accepts_form_encoded_body(self, client):
        response = client.post("/api/v1/predict", data={"fsnippet": "form encoded"})
        assert response.status_code == 200

    @pytest.mark.parametrize(
        "payload,expected_fragment",
        [
            ({}, "required"),
            ({"text": ""}, "at least"),
            ({"text": "ab"}, "at least"),
            ({"text": 42}, "must be a string"),
        ],
    )
    def test_rejects_invalid_input(self, client, payload, expected_fragment):
        response = client.post("/api/v1/predict", json=payload)
        assert response.status_code == 400
        body = response.get_json()
        assert body["error"]["code"] == "validation_error"
        assert expected_fragment in body["error"]["message"]

    def test_rejects_oversized_input(self, client, app):
        limit = app.config["MAX_SNIPPET_CHARS"]
        response = client.post("/api/v1/predict", json={"text": "x" * (limit + 1)})
        assert response.status_code == 400
        assert response.get_json()["error"]["details"]["max_chars"] == limit

    def test_strips_control_characters(self, client, stub_predictor):
        client.post("/api/v1/predict", json={"text": "clean\x00text\x07here"})
        assert stub_predictor.calls[-1] == "cleantexthere"

    def test_prediction_succeeds_when_storage_is_down(self, client, fake_repo):
        fake_repo.fail_writes = True
        response = client.post("/api/v1/predict", json={"text": "storage is broken"})

        assert response.status_code == 200
        body = response.get_json()
        assert body["personality_type"] == "INFP"
        assert body["stored"] is False
        assert body["id"] is None

    def test_returns_503_when_models_cannot_load(self, app, client):
        app.extensions["predictor"] = StubPredictor(
            fail_with=ModelLoadError("artifact missing")
        )
        response = client.post("/api/v1/predict", json={"text": "no models here"})

        assert response.status_code == 503
        assert response.get_json()["error"]["code"] == "model_unavailable"

    def test_rejects_get(self, client):
        assert client.get("/api/v1/predict").status_code == 405

    def test_echoes_request_id(self, client):
        response = client.post(
            "/api/v1/predict",
            json={"text": "trace me"},
            headers={"X-Request-ID": "abc123"},
        )
        assert response.headers["X-Request-ID"] == "abc123"


class TestPredictionsEndpoint:
    def test_lists_newest_first(self, client):
        client.post("/api/v1/predict", json={"text": "first snippet"})
        client.post("/api/v1/predict", json={"text": "second snippet"})

        body = client.get("/api/v1/predictions").get_json()
        assert body["count"] == 2
        assert body["items"][0]["text"] == "second snippet"

    def test_honours_limit(self, client):
        for index in range(3):
            client.post("/api/v1/predict", json={"text": "snippet %d" % index})
        body = client.get("/api/v1/predictions?limit=2").get_json()
        assert body["count"] == 2

    @pytest.mark.parametrize("limit", ["0", "-1", "1000", "abc"])
    def test_rejects_bad_limit(self, client, limit):
        response = client.get("/api/v1/predictions?limit=%s" % limit)
        assert response.status_code == 400

    def test_rejects_bad_type_filter(self, client):
        response = client.get("/api/v1/predictions?type=NOTATYPE")
        assert response.status_code == 400

    def test_filters_by_type(self, client):
        client.post("/api/v1/predict", json={"text": "matching snippet"})
        body = client.get("/api/v1/predictions?type=infp").get_json()
        assert body["type"] == "INFP"
        assert body["count"] == 1

    def test_never_exposes_client_identifiers(self, client):
        client.post("/api/v1/predict", json={"text": "private snippet"})
        body = client.get("/api/v1/predictions").get_json()
        assert "client_ip_hash" not in body["items"][0]
        assert "user_agent" not in body["items"][0]


class TestStatsAndMeta:
    def test_stats_counts_by_type(self, client):
        client.post("/api/v1/predict", json={"text": "counted snippet"})
        body = client.get("/api/v1/stats").get_json()
        assert body["total"] == 1
        assert body["types"]["INFP"] == 1
        assert body["storage_available"] is True

    def test_meta_reports_versions_and_limits(self, client):
        body = client.get("/api/v1/meta").get_json()
        assert body["model_version"] == "test-model"
        assert body["limits"]["max_snippet_chars"] > 0


class TestHealth:
    def test_healthz_is_dependency_free(self, client):
        assert client.get("/healthz").get_json() == {"status": "ok"}

    def test_readyz_reports_checks(self, client, monkeypatch):
        monkeypatch.setattr(
            "mbpp.preprocess.ensure_nltk_data", lambda download_missing=False: []
        )
        body = client.get("/readyz").get_json()
        assert body["status"] == "ready"
        assert body["checks"]["models"]["ok"] is True

    def test_readyz_is_not_ready_without_nltk_data(self, client, monkeypatch):
        monkeypatch.setattr(
            "mbpp.preprocess.ensure_nltk_data",
            lambda download_missing=False: ["punkt"],
        )
        response = client.get("/readyz")
        assert response.status_code == 503
        assert response.get_json()["status"] == "not_ready"

    def test_readyz_tolerates_firestore_outage(self, client, fake_repo, monkeypatch):
        monkeypatch.setattr(
            "mbpp.preprocess.ensure_nltk_data", lambda download_missing=False: []
        )
        fake_repo.ping = lambda: (False, "unreachable")
        response = client.get("/readyz")

        # Persistence is best-effort, so an instance that can still predict
        # must stay in the load balancer.
        assert response.status_code == 200
        assert response.get_json()["checks"]["firestore"]["ok"] is False


class TestWebRoutes:
    @pytest.mark.parametrize(
        "path", ["/", "/response", "/analysis", "/methodology", "/about", "/history"]
    )
    def test_pages_render(self, client, path):
        response = client.get(path)
        assert response.status_code == 200
        assert b"MB|PREDICTOR" in response.data

    def test_form_post_renders_prediction(self, client):
        response = client.post("/response", data={"fsnippet": "a forum post"})
        assert response.status_code == 200
        assert b"INFP" in response.data

    def test_form_post_rejects_short_input(self, client):
        response = client.post("/response", data={"fsnippet": "x"})
        assert response.status_code == 400
        assert b"at least" in response.data

    def test_unknown_page_returns_html_404(self, client):
        response = client.get("/does-not-exist")
        assert response.status_code == 404
        assert b"MB|PREDICTOR" in response.data

    def test_unknown_api_route_returns_json_404(self, client):
        response = client.get("/api/v1/nope")
        assert response.status_code == 404
        assert response.is_json

    def test_security_headers_present(self, client):
        headers = client.get("/").headers
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["X-Frame-Options"] == "DENY"
        assert "Content-Security-Policy" in headers

    def test_robots_disallows_api(self, client):
        assert b"Disallow: /api/" in client.get("/robots.txt").data
