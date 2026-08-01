"""Tests for the Netlify static build.

The build is the deploy: if it silently stops emitting the API proxy rules, the
site loads and every prediction 404s. These tests pin the parts that break
quietly.
"""
import io

import pytest

from tools import build_static


@pytest.fixture
def built(tmp_path):
    out = tmp_path / "dist"
    build_static.main(["--out", str(out), "--backend-url", "https://backend.example"])
    return out


def read(path):
    with io.open(str(path), encoding="utf-8") as handle:
        return handle.read()


class TestStaticBuild:
    def test_renders_every_page(self, built):
        for name in (
            "index.html",
            "response.html",
            "history.html",
            "analysis.html",
            "methodology.html",
            "about.html",
            "404.html",
        ):
            assert (built / name).exists(), "%s was not generated" % name

    def test_resolves_url_for_to_cdn_paths(self, built):
        html = read(built / "index.html")
        assert "/static/css/stylesheet.css" in html
        # No unrendered Jinja may survive into the published HTML.
        assert "url_for" not in html
        assert "{{" not in html

    def test_copies_static_assets(self, built):
        assert (built / "static" / "css" / "stylesheet.css").exists()
        assert (built / "static" / "javascript" / "predictor.js").exists()

    def test_writes_api_proxy_rules(self, built):
        redirects = read(built / "_redirects")
        assert "/api/*        https://backend.example/api/:splat        200!" in redirects
        assert "https://backend.example/response" in redirects

    def test_writes_clean_url_rules(self, built):
        redirects = read(built / "_redirects")
        for path in ("/history", "/analysis", "/methodology", "/about"):
            assert path in redirects

    def test_generates_frontend_config(self, built):
        config = read(built / "static" / "javascript" / "app-config.js")
        assert "window.MBPP_CONFIG" in config
        assert '"apiBase": "/api/v1"' in config
        assert '"backendConfigured": true' in config

    def test_survives_missing_backend_url_but_flags_it(self, tmp_path, capsys):
        out = tmp_path / "dist-no-backend"
        build_static.main(["--out", str(out), "--backend-url", ""])

        assert (out / "index.html").exists()
        redirects = read(out / "_redirects")
        assert "/api/*" not in redirects
        assert "BACKEND_URL was not set" in redirects
        assert "WARNING" in capsys.readouterr().out

    def test_prerendered_pages_have_no_server_state(self, built):
        # response.html must render its empty shell, not a stale prediction.
        html = read(built / "history.html")
        assert 'id="history-body"' in html
        assert "app-config.js" in html

    def test_rebuild_is_clean(self, tmp_path):
        out = tmp_path / "dist"
        build_static.main(["--out", str(out), "--backend-url", "https://a.example"])
        stray = out / "stale.html"
        stray.write_text("stale", encoding="utf-8")

        build_static.main(["--out", str(out), "--backend-url", "https://b.example"])
        assert not stray.exists()
        assert "https://b.example" in read(out / "_redirects")


class TestUrlFor:
    def test_static_paths(self):
        assert (
            build_static.url_for("static", filename="css/stylesheet.css")
            == "/static/css/stylesheet.css"
        )

    def test_index_maps_to_root(self):
        assert build_static.url_for("web.index") == "/"

    def test_named_endpoints(self):
        assert build_static.url_for("web.history") == "/history"
