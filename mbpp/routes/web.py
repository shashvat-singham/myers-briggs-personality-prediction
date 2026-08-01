"""Server-rendered pages.

The original routes are preserved (`/`, `/response`, `/analysis`,
`/methodology`, `/about`) so existing links keep working, plus a `/history`
page backed by Firestore. The form still posts to `/response`, which means the
site works with JavaScript disabled; the fetch-based path in
static/javascript/predictor.js is a progressive enhancement.
"""
import logging

from flask import Blueprint, current_app, render_template, request

from .. import enforce_rate_limit
from ..errors import ValidationError
from ..service import run_prediction, validate_snippet

log = logging.getLogger(__name__)

web_bp = Blueprint("web", __name__)


@web_bp.route("/")
def index():
    return render_template("index.html")


@web_bp.route("/response", methods=["GET", "POST"])
def response():
    """Render a prediction.

    GET renders the empty form: the original implementation crashed with an
    UnboundLocalError on GET because `personality_type` was only assigned in
    the POST branch.
    """
    if request.method != "POST":
        return render_template("response.html", name=None, string=None)

    enforce_rate_limit(current_app, scope="predict")
    raw = request.form.get("text", request.form.get("fsnippet"))
    try:
        text = validate_snippet(raw)
    except ValidationError as exc:
        # Re-render the form with the message instead of showing an error page.
        return (
            render_template(
                "response.html", name=None, string=raw or "", error=exc.message
            ),
            400,
        )

    result, _ = run_prediction(text, source="web")
    return render_template(
        "response.html",
        name=result["personality_type"],
        string=text,
        axes=result["axes"],
        model_version=result["model_version"],
        latency_ms=result["latency_ms"],
        stored=result["stored"],
    )


@web_bp.route("/history")
def history():
    """Recent predictions from Firestore.

    Renders with an explicit notice when storage is unavailable rather than
    failing the page.
    """
    repo = current_app.extensions["firestore_repo"]
    limit = int(current_app.config.get("HISTORY_PAGE_SIZE", 20))
    items = repo.recent_predictions(limit=limit)
    stats = repo.stats()
    return render_template(
        "history.html",
        items=items,
        stats=stats,
        storage_available=repo.enabled and repo.client() is not None,
    )


@web_bp.route("/analysis")
def analysis():
    return render_template("analysis.html")


@web_bp.route("/methodology")
def methodology():
    return render_template("methodology.html")


@web_bp.route("/about")
def about():
    return render_template("about.html")


@web_bp.route("/robots.txt")
def robots():
    from flask import Response

    return Response(
        "User-agent: *\nDisallow: /api/\nDisallow: /history\n",
        mimetype="text/plain",
    )
