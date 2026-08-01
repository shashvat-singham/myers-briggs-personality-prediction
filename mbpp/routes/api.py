"""Versioned JSON API.

Versioned under /api/v1 so the Netlify frontend and any external client can be
migrated independently of the backend. Every response is JSON, including
errors (see mbpp.errors).
"""
import logging
import re

from flask import Blueprint, current_app, jsonify

from .. import enforce_rate_limit
from ..errors import ValidationError
from ..service import read_snippet_from_request, run_prediction

log = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api/v1")

MBTI_TYPE_RE = re.compile(r"^[EI][NS][FT][JP]$")


@api_bp.route("/predict", methods=["POST"])
def predict_endpoint():
    """Predict a personality type.

    Request:  {"text": "..."}
    Response: {"personality_type": "INFP", "axes": {...}, "id": "...", ...}
    """
    enforce_rate_limit(current_app, scope="predict")
    text = read_snippet_from_request()
    result, _ = run_prediction(text, source="api")
    return jsonify(
        {
            "personality_type": result["personality_type"],
            "axes": result["axes"],
            "model_version": result["model_version"],
            "latency_ms": result["latency_ms"],
            "id": result["id"],
            "stored": result["stored"],
            "reference_url": "https://www.16personalities.com/%s-personality"
            % result["personality_type"].lower(),
        }
    )


@api_bp.route("/predictions", methods=["GET"])
def list_predictions():
    """Recent predictions, newest first.

    Query: ?limit=20&type=INFP
    Returns an empty list (200) rather than an error when the database is
    degraded, so the UI can render without special-casing an outage.
    """
    from flask import request

    repo = current_app.extensions["repository"]

    default_limit = int(current_app.config.get("HISTORY_PAGE_SIZE", 20))
    max_limit = int(current_app.config.get("HISTORY_MAX_PAGE_SIZE", 100))
    raw_limit = request.args.get("limit")
    if raw_limit:
        try:
            limit = int(raw_limit)
        except ValueError:
            raise ValidationError(
                "limit must be an integer.", details={"field": "limit"}
            )
        if limit < 1 or limit > max_limit:
            raise ValidationError(
                "limit must be between 1 and %d." % max_limit,
                details={"field": "limit", "max": max_limit},
            )
    else:
        limit = default_limit

    personality_type = (request.args.get("type") or "").strip().upper() or None
    if personality_type and not MBTI_TYPE_RE.match(personality_type):
        raise ValidationError(
            "type must be a valid MBTI code such as INFP.",
            details={"field": "type"},
        )

    items = repo.recent_predictions(limit=limit, personality_type=personality_type)
    return jsonify(
        {
            "items": items,
            "count": len(items),
            "limit": limit,
            "type": personality_type,
            "storage_available": repo.enabled and repo.client() is not None,
        }
    )


@api_bp.route("/stats", methods=["GET"])
def stats_endpoint():
    """Aggregate counters maintained by atomic increments on write."""
    repo = current_app.extensions["repository"]
    stats = repo.stats()
    if stats is None:
        return (
            jsonify(
                {
                    "total": 0,
                    "types": {},
                    "storage_available": False,
                }
            ),
            200,
        )
    stats["storage_available"] = True
    return jsonify(stats)


@api_bp.route("/meta", methods=["GET"])
def meta_endpoint():
    """Build and model metadata, useful for verifying what is deployed."""
    from .. import __version__

    predictor = current_app.extensions["predictor"]
    repo = current_app.extensions["repository"]
    return jsonify(
        {
            "app_version": __version__,
            "model_version": predictor.model_version(),
            "models_loaded": predictor.loaded,
            "environment": current_app.config.get("ENV"),
            "database": {
                "backend": repo.backend,
                "enabled": repo.enabled,
                "available": repo.enabled and repo.client() is not None,
            },
            "limits": {
                "min_snippet_chars": current_app.config.get("MIN_SNIPPET_CHARS"),
                "max_snippet_chars": current_app.config.get("MAX_SNIPPET_CHARS"),
                "rate_limit_requests": current_app.config.get("RATE_LIMIT_REQUESTS"),
                "rate_limit_window_seconds": current_app.config.get(
                    "RATE_LIMIT_WINDOW_SECONDS"
                ),
            },
        }
    )
