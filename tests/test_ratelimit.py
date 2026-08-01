"""Rate limiter unit tests and the HTTP behaviour it produces."""
from mbpp import create_app
from mbpp.ratelimit import RateLimiter
from tests.conftest import FakeRepository, StubPredictor


class TestRateLimiter:
    def test_allows_up_to_the_limit(self):
        limiter = RateLimiter(max_requests=3, window_seconds=60)
        assert [limiter.check("ip")[0] for _ in range(3)] == [True, True, True]

    def test_blocks_beyond_the_limit(self):
        limiter = RateLimiter(max_requests=2, window_seconds=60)
        limiter.check("ip")
        limiter.check("ip")
        allowed, remaining, retry_after = limiter.check("ip")
        assert allowed is False
        assert remaining == 0
        assert retry_after >= 1

    def test_reports_remaining_budget(self):
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        assert limiter.check("ip")[1] == 4
        assert limiter.check("ip")[1] == 3

    def test_keys_are_independent(self):
        limiter = RateLimiter(max_requests=1, window_seconds=60)
        assert limiter.check("a")[0] is True
        assert limiter.check("b")[0] is True
        assert limiter.check("a")[0] is False

    def test_window_expiry_resets_the_budget(self, monkeypatch):
        limiter = RateLimiter(max_requests=1, window_seconds=60)
        clock = {"now": 1000.0}
        monkeypatch.setattr(limiter, "_now", lambda: clock["now"])

        assert limiter.check("ip")[0] is True
        assert limiter.check("ip")[0] is False
        clock["now"] += 61
        assert limiter.check("ip")[0] is True

    def test_zero_limit_disables_enforcement(self):
        limiter = RateLimiter(max_requests=0, window_seconds=60)
        assert all(limiter.check("ip")[0] for _ in range(10))

    def test_table_is_bounded(self):
        limiter = RateLimiter(max_requests=5, window_seconds=60, max_tracked_keys=10)
        for index in range(50):
            limiter.check("ip-%d" % index)
        assert len(limiter._buckets) <= 11


class TestRateLimitedEndpoint:
    def _app(self):
        app = create_app(
            "testing",
            config_overrides={
                "RATE_LIMIT_ENABLED": True,
                "RATE_LIMIT_REQUESTS": 2,
                "RATE_LIMIT_WINDOW_SECONDS": 60,
            },
        )
        app.extensions["predictor"] = StubPredictor()
        app.extensions["firestore_repo"] = FakeRepository()
        return app

    def test_returns_429_with_retry_after(self):
        client = self._app().test_client()
        for _ in range(2):
            assert client.post("/api/v1/predict", json={"text": "hello there"}).status_code == 200

        response = client.post("/api/v1/predict", json={"text": "hello there"})
        assert response.status_code == 429
        assert response.get_json()["error"]["code"] == "rate_limited"
        assert int(response.headers["Retry-After"]) >= 1

    def test_advertises_remaining_budget(self):
        client = self._app().test_client()
        response = client.post("/api/v1/predict", json={"text": "hello there"})
        assert response.headers["X-RateLimit-Limit"] == "2"
        assert response.headers["X-RateLimit-Remaining"] == "1"

    def test_reads_are_not_rate_limited(self):
        client = self._app().test_client()
        for _ in range(5):
            assert client.get("/api/v1/stats").status_code == 200
