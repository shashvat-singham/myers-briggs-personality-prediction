"""Environment-driven configuration.

Every knob is an env var so the same image runs in dev, staging and prod
without a rebuild. Nothing here reads secrets from disk except through
GOOGLE_APPLICATION_CREDENTIALS, which is the Google-standard path.
"""
import os


def _bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int(name, default):
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float(name, default):
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _list(name, default=()):
    raw = os.environ.get(name)
    if not raw:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


class Config(object):
    """Base config. Values are resolved at import time from the environment."""

    ENV = os.environ.get("APP_ENV", "production")
    DEBUG = False
    TESTING = False

    # Flask needs a secret for flashing / signed cookies. Fail loudly in prod
    # rather than silently shipping a default key (see validate()).
    SECRET_KEY = os.environ.get("SECRET_KEY", "")

    # --- request handling -------------------------------------------------
    # Bounds the form/JSON body Flask will even parse.
    MAX_CONTENT_LENGTH = _int("MAX_CONTENT_LENGTH", 64 * 1024)
    MAX_SNIPPET_CHARS = _int("MAX_SNIPPET_CHARS", 5000)
    MIN_SNIPPET_CHARS = _int("MIN_SNIPPET_CHARS", 3)
    JSON_SORT_KEYS = False

    # --- models -----------------------------------------------------------
    MODEL_DIR = os.environ.get("MODEL_DIR", "models")
    # Load all four classifiers during startup instead of on first request, so
    # a broken/missing artifact fails the deploy rather than a user's request.
    PRELOAD_MODELS = _bool("PRELOAD_MODELS", True)

    # --- database ---------------------------------------------------------
    # "rtdb" (Firebase Realtime Database, the provisioned database for this
    # project) or "firestore". See mbpp/repository.py.
    DATABASE_BACKEND = os.environ.get("DATABASE_BACKEND", "rtdb").strip().lower()
    # FIRESTORE_ENABLED is the legacy name for this flag and still works.
    DATABASE_ENABLED = _bool(
        "DATABASE_ENABLED", _bool("FIRESTORE_ENABLED", True)
    )
    FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get(
        "GOOGLE_CLOUD_PROJECT"
    )
    # Inline credentials for platforms with no writable secret files. Accepts
    # raw JSON or standard base64 of the JSON.
    FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")

    # Hard ceiling on how long a request will wait on the database.
    # Persistence is best-effort: a slow database must never turn into a slow
    # prediction.
    DB_TIMEOUT_SECONDS = _float(
        "DB_TIMEOUT_SECONDS", _float("FIRESTORE_TIMEOUT_SECONDS", 5.0)
    )
    DB_RETRIES = _int("DB_RETRIES", _int("FIRESTORE_RETRIES", 2))

    # --- realtime database (DATABASE_BACKEND=rtdb) ------------------------
    # e.g. https://mbpp-7347c-default-rtdb.firebaseio.com -- copy it from the
    # Realtime Database page in the Firebase console.
    FIREBASE_DATABASE_URL = os.environ.get("FIREBASE_DATABASE_URL", "")
    RTDB_PREDICTIONS_PATH = os.environ.get("RTDB_PREDICTIONS_PATH", "predictions")
    RTDB_STATS_PATH = os.environ.get("RTDB_STATS_PATH", "stats")

    # --- firestore (DATABASE_BACKEND=firestore) ---------------------------
    FIRESTORE_DATABASE = os.environ.get("FIRESTORE_DATABASE", "(default)")
    FIRESTORE_PREDICTIONS_COLLECTION = os.environ.get(
        "FIRESTORE_PREDICTIONS_COLLECTION", "predictions"
    )
    FIRESTORE_STATS_COLLECTION = os.environ.get("FIRESTORE_STATS_COLLECTION", "stats")
    FIRESTORE_STATS_DOC = os.environ.get("FIRESTORE_STATS_DOC", "global")
    # Persist the submitted snippet (truncated) alongside the prediction.
    # Turn off for privacy-sensitive deployments; the SHA-256 is always stored.
    STORE_RAW_TEXT = _bool("STORE_RAW_TEXT", True)
    STORED_TEXT_MAX_CHARS = _int("STORED_TEXT_MAX_CHARS", 1000)
    # Days after which a prediction becomes eligible for deletion. 0 disables
    # expiry. Firestore enforces this server-side via a TTL policy on
    # `expires_at`; the Realtime Database has no TTL feature, so there it is
    # advisory and tools/prune_predictions.py does the deleting.
    PREDICTION_TTL_DAYS = _int("PREDICTION_TTL_DAYS", 90)
    HISTORY_PAGE_SIZE = _int("HISTORY_PAGE_SIZE", 20)
    HISTORY_MAX_PAGE_SIZE = _int("HISTORY_MAX_PAGE_SIZE", 100)

    # Salt for hashing client IPs. Without it, IPs are not stored at all --
    # an unsalted IP hash is trivially reversible.
    IP_HASH_SALT = os.environ.get("IP_HASH_SALT", "")

    # --- http / edge ------------------------------------------------------
    # Netlify -> backend adds one proxy hop; Cloud Run adds another.
    TRUSTED_PROXY_COUNT = _int("TRUSTED_PROXY_COUNT", 1)
    CORS_ALLOWED_ORIGINS = _list("CORS_ALLOWED_ORIGINS")
    ENABLE_HSTS = _bool("ENABLE_HSTS", True)

    # --- rate limiting ----------------------------------------------------
    RATE_LIMIT_ENABLED = _bool("RATE_LIMIT_ENABLED", True)
    RATE_LIMIT_REQUESTS = _int("RATE_LIMIT_REQUESTS", 30)
    RATE_LIMIT_WINDOW_SECONDS = _int("RATE_LIMIT_WINDOW_SECONDS", 60)

    # --- logging ----------------------------------------------------------
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
    LOG_JSON = _bool("LOG_JSON", True)

    @classmethod
    def validate(cls):
        """Return a list of fatal misconfigurations for this environment."""
        problems = []
        if cls.ENV == "production":
            if not cls.SECRET_KEY:
                problems.append("SECRET_KEY must be set in production")
            if cls.DATABASE_ENABLED and not cls.FIREBASE_PROJECT_ID:
                problems.append(
                    "FIREBASE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) must be set "
                    "when DATABASE_ENABLED is true"
                )
            # Without the URL the RTDB backend cannot resolve a database at all,
            # so every write would silently degrade. Catch it at boot.
            if (
                cls.DATABASE_ENABLED
                and cls.DATABASE_BACKEND == "rtdb"
                and not cls.FIREBASE_DATABASE_URL
                and not os.environ.get("FIREBASE_DATABASE_EMULATOR_HOST")
            ):
                problems.append(
                    "FIREBASE_DATABASE_URL must be set for DATABASE_BACKEND=rtdb "
                    "(e.g. https://mbpp-7347c-default-rtdb.firebaseio.com)"
                )
        if cls.DATABASE_BACKEND not in ("rtdb", "firestore"):
            problems.append(
                "DATABASE_BACKEND must be 'rtdb' or 'firestore', got %r"
                % cls.DATABASE_BACKEND
            )
        if cls.MIN_SNIPPET_CHARS > cls.MAX_SNIPPET_CHARS:
            problems.append("MIN_SNIPPET_CHARS cannot exceed MAX_SNIPPET_CHARS")
        return problems


class DevelopmentConfig(Config):
    ENV = "development"
    DEBUG = True
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-insecure-key")
    LOG_JSON = _bool("LOG_JSON", False)
    ENABLE_HSTS = False


class TestingConfig(Config):
    ENV = "testing"
    TESTING = True
    DEBUG = False
    SECRET_KEY = "testing-key"
    DATABASE_ENABLED = False
    PRELOAD_MODELS = False
    RATE_LIMIT_ENABLED = False
    LOG_JSON = False


_CONFIGS = {
    "production": Config,
    "development": DevelopmentConfig,
    "testing": TestingConfig,
}


def get_config(name=None):
    """Resolve a config class by name, defaulting to APP_ENV."""
    key = (name or os.environ.get("APP_ENV") or "production").strip().lower()
    return _CONFIGS.get(key, Config)
