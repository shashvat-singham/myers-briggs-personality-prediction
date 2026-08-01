# syntax=docker/dockerfile:1
#
# Multi-stage build for the prediction backend.
#
# Base image is python:3.8 on purpose: models/*.joblib were pickled with
# scikit-learn 0.23.0, whose last wheel targets CPython 3.8 (see the note in
# requirements.txt). Bumping Python requires retraining the models first.

# ----------------------------------------------------------------- builder ---
FROM python:3.8-slim-bullseye AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# --only-binary keeps this stage compiler-free: if a wheel ever disappears from
# the index the build fails loudly instead of silently compiling from source.
COPY requirements.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade "pip==24.0" "setuptools==68.2.2" "wheel==0.42.0" \
    && /opt/venv/bin/pip install --only-binary=:all: -r requirements.txt

# Bake in only the four corpora the feature pipeline needs. `nltk.downloader
# all` (the previous approach) pulls in gigabytes and needs a writable HOME at
# runtime, which a read-only container does not have.
#
# Only redundant archives are removed. Deleting every *.zip would break the
# image: the downloader leaves wordnet and omw-1.4 zipped and NLTK reads them
# in place, so the zip IS the corpus and the lemmatizer would fail at runtime.
RUN /opt/venv/bin/python -m nltk.downloader -d /usr/share/nltk_data \
    punkt stopwords wordnet omw-1.4 averaged_perceptron_tagger \
    && find /usr/share/nltk_data -name "*.zip" -print0 \
       | while IFS= read -r -d '' archive; do \
             if [ -d "${archive%.zip}" ]; then rm -f "$archive"; fi; \
         done \
    && NLTK_DATA=/usr/share/nltk_data /opt/venv/bin/python -c "\
import nltk; \
from nltk.corpus import stopwords; \
from nltk.stem import WordNetLemmatizer; \
from nltk.tokenize import word_tokenize; \
assert stopwords.words('english'), 'stopwords unusable'; \
assert WordNetLemmatizer().lemmatize('running', 'v') == 'run', 'wordnet unusable'; \
assert nltk.pos_tag(word_tokenize('a quick test')), 'punkt/tagger unusable'; \
print('nltk corpora verified')"

# ----------------------------------------------------------------- runtime ---
FROM python:3.8-slim-bullseye AS runtime

# libgomp1 is the OpenMP runtime scikit-learn/scipy link against; without it
# `import sklearn` fails at load time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=random \
    PATH="/opt/venv/bin:$PATH" \
    NLTK_DATA=/usr/share/nltk_data \
    APP_ENV=production \
    MODEL_DIR=/app/models \
    PORT=8080

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /usr/share/nltk_data /usr/share/nltk_data

WORKDIR /app

# Copy only what the server needs. Notebooks, the training CSV and the docs are
# excluded here and in .dockerignore -- they would roughly double the image.
COPY --chown=root:root mbpp ./mbpp
COPY --chown=root:root models ./models
COPY --chown=root:root templates ./templates
COPY --chown=root:root static ./static
COPY --chown=root:root wsgi.py app.py predict.py preprocess.py gunicorn.conf.py ./

# Run unprivileged. The app writes nothing to disk, so everything stays
# root-owned and read-only to the runtime user.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
USER 10001:10001

EXPOSE 8080

# Liveness only -- /readyz would restart the container on a Firestore blip.
# Cloud Run ignores this and uses its own probes; Compose and plain Docker use it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import os,sys,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/healthz', timeout=4); sys.exit(0 if r.getcode()==200 else 1)"]

CMD ["gunicorn", "-c", "gunicorn.conf.py", "wsgi:application"]
