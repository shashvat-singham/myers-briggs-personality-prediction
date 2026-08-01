"""Application factory for the Myers-Briggs personality predictor.

Wiring lives here; behaviour lives in the blueprints. The factory pattern lets
tests build an isolated app with a different config instead of importing a
module-level singleton that has already read the environment.
"""
import logging
import os
import time

from flask import Flask, g, request
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import get_config
from .errors import RateLimitedError, register_error_handlers
from .firestore_repo import FirestoreRepository
from .logging_utils import REQUEST_ID_HEADER, configure_logging, get_request_id
from .predictor import ModelLoadError, get_predictor
from .ratelimit import RateLimiter

__version__ = "2.0.0"

log = logging.getLogger(__name__)

# Hosts the templates actually load assets from. Keeping this explicit means a
# newly added third-party script is a deliberate change, not a silent one.
DEFAULT_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://code.jquery.com "
    "https://cdn.jsdelivr.net https://stackpath.bootstrapcdn.com "
    "https://cdnjs.cloudflare.com; "
    "style-src 'self' 'unsafe-inline' https://stackpath.bootstrapcdn.com "
    "https://cdnjs.cloudflare.com https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


def create_app(config_name=None, config_overrides=None):
    config = get_config(config_name)
    configure_logging(level=config.LOG_LEVEL, as_json=config.LOG_JSON)

    app = Flask(
        __name__,
        template_folder=os.path.join(_project_root(), "templates"),
        static_folder=os.path.join(_project_root(), "static"),
    )
    app.config.from_object(config)
    if config_overrides:
        app.config.update(config_overrides)

    problems = config.validate()
    if problems:
        if app.config.get("ENV") == "production" and not app.config.get("TESTING"):
            # Fail the deploy, not the first request.
            raise RuntimeError("invalid configuration: " + "; ".join(problems))
        for problem in problems:
            log.warning("config_problem", extra={"detail": problem})

    # Trust exactly as many forwarding hops as we are told to. Netlify's proxy
    # is one hop; Cloud Run in front of it is another. Trusting blindly would
    # let a client spoof its own IP and defeat rate limiting.
    hops = int(app.config.get("TRUSTED_PROXY_COUNT") or 0)
    if hops > 0:
        app.wsgi_app = ProxyFix(
            app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops, x_prefix=hops
        )

    app.extensions["firestore_repo"] = FirestoreRepository(config)
    app.extensions["predictor"] = get_predictor(
        model_dir=app.config.get("MODEL_DIR"),
        version_override=os.environ.get("MODEL_VERSION"),
    )
    app.extensions["rate_limiter"] = RateLimiter(
        max_requests=app.config.get("RATE_LIMIT_REQUESTS", 30),
        window_seconds=app.config.get("RATE_LIMIT_WINDOW_SECONDS", 60),
    )

    _register_hooks(app)
    register_error_handlers(app)

    from .routes.api import api_bp
    from .routes.health import health_bp
    from .routes.web import web_bp

    app.register_blueprint(web_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(health_bp)

    if app.config.get("PRELOAD_MODELS"):
        _preload(app)

    log.info(
        "app_created",
        extra={
            "app_version": __version__,
            "env": app.config.get("ENV"),
            "firestore_enabled": bool(app.config.get("FIRESTORE_ENABLED")),
        },
    )
    return app


def _project_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _preload(app):
    """Load models and verify NLTK corpora during startup.

    A container that cannot serve predictions should fail its readiness probe
    immediately rather than accept traffic and 500 on the first request.
    """
    from .preprocess import ensure_nltk_data

    missing = ensure_nltk_data(download_missing=False)
    if missing:
        log.error("nltk_data_missing", extra={"packages": ",".join(missing)})

    try:
        app.extensions["predictor"].load_models()
    except ModelLoadError as exc:
        log.error("model_preload_failed", extra={"error": str(exc)})


def client_ip():
    """Best available client address, post-ProxyFix."""
    return request.remote_addr or "unknown"


def enforce_rate_limit(app, scope="predict"):
    limiter = app.extensions.get("rate_limiter")
    if not app.config.get("RATE_LIMIT_ENABLED") or limiter is None:
        return
    allowed, remaining, retry_after = limiter.check("%s:%s" % (scope, client_ip()))
    g.rate_limit_remaining = remaining
    if not allowed:
        log.warning("rate_limited", extra={"scope": scope})
        raise RateLimitedError(retry_after=retry_after)


def _register_hooks(app):
    @app.before_request
    def _start_request():
        g.request_started = time.time()
        get_request_id()
        # Answer CORS preflights here rather than with a catch-all OPTIONS
        # route: a route would claim every /api/* URL and turn unknown paths
        # into 405s instead of 404s.
        if request.method == "OPTIONS" and request.path.startswith("/api/"):
            return app.make_default_options_response()

    @app.after_request
    def _finish_request(response):
        request_id = get_request_id()
        if request_id:
            response.headers[REQUEST_ID_HEADER] = request_id

        started = getattr(g, "request_started", None)
        duration_ms = int((time.time() - started) * 1000) if started else None
        # One structured line per request: the minimum needed to build latency
        # and error-rate dashboards without an APM agent.
        if not request.path.startswith("/static/"):
            log.info(
                "request",
                extra={
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                    "remote_ip": client_ip(),
                },
            )

        _apply_security_headers(app, response)
        _apply_cors(app, response)
        remaining = getattr(g, "rate_limit_remaining", None)
        if remaining is not None:
            response.headers["X-RateLimit-Limit"] = str(
                app.config.get("RATE_LIMIT_REQUESTS")
            )
            response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


def _apply_security_headers(app, response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
    )
    if response.mimetype == "text/html":
        response.headers.setdefault(
            "Content-Security-Policy",
            os.environ.get("CONTENT_SECURITY_POLICY", DEFAULT_CSP),
        )
    if app.config.get("ENABLE_HSTS") and request.is_secure:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


def _apply_cors(app, response):
    """Reflect only explicitly allow-listed origins.

    Wildcard CORS on a write endpoint invites drive-by abuse from any page, so
    an empty allow-list means no CORS headers at all -- the Netlify proxy path
    is same-origin and needs none.
    """
    allowed = app.config.get("CORS_ALLOWED_ORIGINS") or []
    origin = request.headers.get("Origin")
    if not origin or not allowed:
        return response
    if origin in allowed or "*" in allowed:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, X-Request-ID"
        )
        response.headers["Access-Control-Max-Age"] = "600"
    return response
