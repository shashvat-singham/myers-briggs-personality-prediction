"""Application error types and the handlers that render them.

API paths get JSON, browser paths get HTML. Internal errors never leak a
traceback or exception text to the client -- the request id is the handle
the user gives support, and the traceback stays in the logs.
"""
import logging

from flask import jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from .logging_utils import get_request_id

log = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for errors that are safe to show to a client."""

    status_code = 500
    code = "internal_error"
    message = "An unexpected error occurred."

    def __init__(self, message=None, code=None, status_code=None, details=None):
        super(AppError, self).__init__(message or self.message)
        if message:
            self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details or {}

    def to_dict(self):
        payload = {"error": {"code": self.code, "message": self.message}}
        if self.details:
            payload["error"]["details"] = self.details
        request_id = get_request_id()
        if request_id:
            payload["request_id"] = request_id
        return payload


class ValidationError(AppError):
    status_code = 400
    code = "validation_error"
    message = "The request payload is invalid."


class RateLimitedError(AppError):
    status_code = 429
    code = "rate_limited"
    message = "Too many requests. Please slow down."

    def __init__(self, retry_after=None, **kwargs):
        super(RateLimitedError, self).__init__(**kwargs)
        self.retry_after = retry_after


class ModelUnavailableError(AppError):
    status_code = 503
    code = "model_unavailable"
    message = "The prediction service is temporarily unavailable."


def wants_json():
    """True when the caller is an API client rather than a browser."""
    if request.path.startswith("/api/"):
        return True
    if request.is_json:
        return True
    accept = request.accept_mimetypes
    return accept["application/json"] > accept["text/html"]


def _render(status_code, code, message, retry_after=None, details=None):
    if wants_json():
        body = {"error": {"code": code, "message": message}}
        if details:
            # e.g. which field failed and what the limit is -- the whole point
            # of a 400 is telling the caller how to fix the request.
            body["error"]["details"] = details
        request_id = get_request_id()
        if request_id:
            body["request_id"] = request_id
        response = jsonify(body)
    else:
        try:
            response = render_template(
                "error.html", status_code=status_code, message=message
            ), status_code
            response = _as_response(response)
        except Exception:  # template missing -- never fail inside a handler
            response = jsonify({"error": {"code": code, "message": message}})
    response.status_code = status_code
    if retry_after:
        response.headers["Retry-After"] = str(int(retry_after))
    return response


def _as_response(rendered):
    from flask import make_response

    return make_response(rendered)


def register_error_handlers(app):
    @app.errorhandler(AppError)
    def _handle_app_error(exc):
        if exc.status_code >= 500:
            log.error("app_error", extra={"code": exc.code}, exc_info=exc)
        else:
            log.info("client_error", extra={"code": exc.code, "detail": exc.message})
        return _render(
            exc.status_code,
            exc.code,
            exc.message,
            retry_after=getattr(exc, "retry_after", None),
            details=exc.details,
        )

    @app.errorhandler(HTTPException)
    def _handle_http_exception(exc):
        code = (exc.name or "http_error").lower().replace(" ", "_")
        return _render(exc.code or 500, code, exc.description or exc.name)

    @app.errorhandler(Exception)
    def _handle_unexpected(exc):
        # Anything reaching here is a bug: log it in full, tell the client nothing.
        log.exception("unhandled_exception", extra={"exc_type": type(exc).__name__})
        return _render(
            500,
            "internal_error",
            "An unexpected error occurred. Quote the request id when reporting this.",
        )
