"""Development entry point and backwards-compatible `app:app` target.

Routes and wiring now live in the `mbpp` package (see mbpp/__init__.py).
Production uses `gunicorn wsgi:application`; this file keeps `python app.py`
working for local runs.
"""
import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

from mbpp import create_app

if __name__ == "__main__":
    # Local runs default to the development config so a missing SECRET_KEY
    # doesn't stop you; production is strict about it on purpose.
    os.environ.setdefault("APP_ENV", "development")
    app = create_app()
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", 5000)),
        debug=app.config.get("DEBUG", False),
    )
else:
    app = create_app()
