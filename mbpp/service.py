"""Use-case layer shared by the HTML and JSON entry points.

Both blueprints call `run_prediction`, so validation, persistence and logging
behave identically whether the caller is the form on the site or an API client.
"""
import logging
import time

from flask import current_app, request

from .errors import ModelUnavailableError, ValidationError
from .logging_utils import get_request_id
from .predictor import ModelLoadError

log = logging.getLogger(__name__)


def validate_snippet(raw, config=None):
    """Normalise and bounds-check user text.

    Returns the cleaned string; raises ValidationError with a specific message
    so the caller sees what to fix rather than a generic 400.
    """
    config = config or current_app.config
    if raw is None:
        raise ValidationError("A text snippet is required.", details={"field": "text"})
    if not isinstance(raw, str):
        raise ValidationError(
            "The text snippet must be a string.", details={"field": "text"}
        )

    # Strip control characters (except tab/newline); they carry no signal and
    # corrupt log lines and stored documents.
    cleaned = "".join(
        ch for ch in raw if ch in ("\t", "\n", "\r") or ord(ch) >= 32
    ).strip()

    minimum = int(config.get("MIN_SNIPPET_CHARS", 3))
    maximum = int(config.get("MAX_SNIPPET_CHARS", 5000))
    if len(cleaned) < minimum:
        raise ValidationError(
            "The text snippet must be at least %d characters." % minimum,
            details={"field": "text", "min_chars": minimum},
        )
    if len(cleaned) > maximum:
        raise ValidationError(
            "The text snippet must be at most %d characters." % maximum,
            details={
                "field": "text",
                "max_chars": maximum,
                "received_chars": len(cleaned),
            },
        )
    return cleaned


def run_prediction(text, source="api", persist=True):
    """Predict, persist best-effort, and return (result, document_id).

    `result` always comes back on success. `document_id` is None when Firestore
    is disabled or unreachable -- a storage failure never fails the prediction.
    """
    predictor = current_app.extensions["predictor"]
    repo = current_app.extensions["firestore_repo"]

    started = time.time()
    try:
        result = predictor.predict(text)
    except ModelLoadError as exc:
        log.error("model_unavailable", extra={"error": str(exc)})
        raise ModelUnavailableError() from exc
    latency_ms = int((time.time() - started) * 1000)
    result["latency_ms"] = latency_ms

    log.info(
        "prediction",
        extra={
            "personality_type": result.get("personality_type"),
            "latency_ms": latency_ms,
            "text_length": len(text),
            "source": source,
            "model_version": result.get("model_version"),
        },
    )

    document_id = None
    if persist and repo.enabled:
        document = repo.build_document(
            text=text,
            result=result,
            source=source,
            request_id=get_request_id(),
            client_ip=request.remote_addr if request else None,
            user_agent=request.headers.get("User-Agent") if request else None,
            latency_ms=latency_ms,
        )
        document_id = repo.save_prediction(document)

    result["id"] = document_id
    result["stored"] = document_id is not None
    return result, document_id


def read_snippet_from_request():
    """Pull the snippet out of JSON or form data.

    `fsnippet` is the field name the original HTML form used; it stays
    supported so existing bookmarks and the Postman collection keep working.
    """
    if request.is_json:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ValidationError("Request body must be a JSON object.")
        raw = payload.get("text", payload.get("snippet", payload.get("fsnippet")))
    else:
        raw = request.form.get("text", request.form.get("fsnippet"))
        if raw is None:
            raw = request.args.get("text", request.args.get("fsnippet"))
    return validate_snippet(raw)
