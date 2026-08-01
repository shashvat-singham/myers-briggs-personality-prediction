"""Gunicorn configuration.

Tuned for a CPU-bound model server behind a proxy (Cloud Run / Netlify proxy).
Every value is overridable by env var so one image serves every environment.
"""
import os


def _int(name, default):
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


bind = "0.0.0.0:%d" % _int("PORT", 8080)

# Inference holds the GIL in native code (numpy/scipy release it, sklearn
# mostly does), so a couple of processes with threads beats many processes:
# each worker holds its own ~250 MB copy of the four pipelines. Default to 2
# and raise WEB_CONCURRENCY only alongside the memory limit.
workers = _int("WEB_CONCURRENCY", 2)
threads = _int("GUNICORN_THREADS", 8)
worker_class = os.environ.get("GUNICORN_WORKER_CLASS", "gthread")

# preload_app forks workers from a master that has already imported the app and
# loaded the models, so the artifacts are read once and shared copy-on-write.
preload_app = True

# Feature extraction on a long snippet can take seconds on a small instance;
# 30s (the default) kills legitimate requests.
timeout = _int("GUNICORN_TIMEOUT", 120)
graceful_timeout = _int("GUNICORN_GRACEFUL_TIMEOUT", 30)
keepalive = _int("GUNICORN_KEEPALIVE", 5)

# Recycle workers periodically to bound any leak in the native ML stack.
# The jitter avoids all workers restarting at the same moment.
max_requests = _int("GUNICORN_MAX_REQUESTS", 1000)
max_requests_jitter = _int("GUNICORN_MAX_REQUESTS_JITTER", 100)

# The app emits its own structured request log, so gunicorn's access log would
# only duplicate it. Errors still go to stdout for the platform to collect.
accesslog = None
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")

# Containers often mount /tmp as a slow or read-only overlay; the heartbeat
# file belongs on a memory-backed filesystem.
worker_tmp_dir = "/dev/shm" if os.path.isdir("/dev/shm") else None

# Trust the immediate proxy's forwarded headers (ProxyFix does the parsing).
forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "*")


def on_starting(server):
    server.log.info(
        "starting mbpp: workers=%s threads=%s timeout=%s", workers, threads, timeout
    )


def worker_int(worker):
    worker.log.info("worker interrupted, shutting down cleanly (pid=%s)", worker.pid)
