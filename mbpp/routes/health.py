"""Liveness and readiness probes.

The split matters in production: a liveness failure gets the container
restarted, a readiness failure only takes it out of the load balancer. So
`/healthz` deliberately checks nothing external -- a Firestore outage must not
trigger a restart loop across the whole fleet -- while `/readyz` checks the
dependencies a real request needs.
"""
import logging

from flask import Blueprint, current_app, jsonify

log = logging.getLogger(__name__)

health_bp = Blueprint("health", __name__)


@health_bp.route("/healthz")
def healthz():
    """Liveness: is the process serving HTTP at all?"""
    return jsonify({"status": "ok"})


@health_bp.route("/readyz")
def readyz():
    """Readiness: can this instance serve a prediction and persist it?"""
    predictor = current_app.extensions["predictor"]
    repo = current_app.extensions["firestore_repo"]

    checks = {}

    missing = predictor.missing_artifacts()
    if missing:
        checks["models"] = {"ok": False, "detail": "missing: %s" % ", ".join(missing)}
    else:
        checks["models"] = {
            "ok": predictor.loaded,
            "detail": "loaded" if predictor.loaded else "not loaded yet",
        }

    from ..preprocess import ensure_nltk_data

    nltk_missing = ensure_nltk_data(download_missing=False)
    checks["nltk_data"] = {
        "ok": not nltk_missing,
        "detail": "ok" if not nltk_missing else "missing: %s" % ",".join(nltk_missing),
    }

    firestore_ok, firestore_detail = repo.ping()
    checks["firestore"] = {"ok": firestore_ok, "detail": firestore_detail}

    # Firestore is intentionally excluded from the readiness verdict: writes are
    # best-effort, so an instance that can still predict should keep serving.
    ready = checks["models"]["ok"] and checks["nltk_data"]["ok"]
    payload = {
        "status": "ready" if ready else "not_ready",
        "checks": checks,
        "model_version": predictor.model_version(),
    }
    return jsonify(payload), (200 if ready else 503)
