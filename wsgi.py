"""WSGI entry point.

`gunicorn wsgi:application` is the production command. Kept separate from
app.py so the server never imports a module with a `__main__` dev-server block.
"""
import os

try:  # optional: convenient locally, absent in prod images
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

from mbpp import create_app

application = create_app()

# Alias for tooling that expects `app`.
app = application

if __name__ == "__main__":  # pragma: no cover
    application.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
