"""Structured logging and request correlation.

Cloud Run / Cloud Logging parses stdout JSON lines, so `LOG_JSON=true`
gives searchable fields instead of prose. Every log line carries the
request id, which is also returned to the client as `X-Request-ID` so a
user-reported failure can be found in the logs.
"""
import json
import logging
import sys
import time
import uuid

from flask import g, has_request_context, request

REQUEST_ID_HEADER = "X-Request-ID"

# Reserved LogRecord attributes; anything else on the record is user context.
_RESERVED = set(
    vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()
) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record."""

    def format(self, record):
        payload = {
            "severity": record.levelname,
            "time": time.strftime(
                "%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)
            )
            + ".%03dZ" % int(record.msecs),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        for key, value in vars(record).items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value

        if has_request_context():
            payload.setdefault("request_id", get_request_id())
            payload.setdefault("path", request.path)
            payload.setdefault("method", request.method)

        try:
            return json.dumps(payload, default=str)
        except (TypeError, ValueError):
            return json.dumps(
                {"severity": record.levelname, "message": record.getMessage()}
            )


class TextFormatter(logging.Formatter):
    """Human-readable format for local development."""

    def __init__(self):
        super(TextFormatter, self).__init__(
            fmt="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
            datefmt="%H:%M:%S",
        )


def configure_logging(level="INFO", as_json=True):
    """Install a single stdout handler on the root logger (idempotent)."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if as_json else TextFormatter())
    root.addHandler(handler)
    root.setLevel(getattr(logging, str(level).upper(), logging.INFO))

    # These are noisy at INFO and duplicate our own request log.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    logging.getLogger("google.api_core").setLevel(logging.WARNING)
    logging.getLogger("google.auth").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def get_request_id():
    """Request id for the current request, honouring an inbound header."""
    if not has_request_context():
        return None
    request_id = getattr(g, "request_id", None)
    if request_id is None:
        inbound = request.headers.get(REQUEST_ID_HEADER, "")
        # Bound the length: this value ends up in logs and response headers.
        request_id = inbound.strip()[:64] or uuid.uuid4().hex
        g.request_id = request_id
    return request_id
