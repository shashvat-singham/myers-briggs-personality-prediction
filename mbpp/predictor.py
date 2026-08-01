"""Model loading and inference.

The four binary classifiers (one per MBTI axis) are loaded once per process and
shared. Each artifact is an imbalanced-learn Pipeline ending in a
LogisticRegressionCV, so genuine per-axis probabilities are available -- the
API returns them instead of a bare four-letter string, and they are stored in
Firestore for later evaluation.

Concurrency: `joblib.load` happens under a lock, and scikit-learn `predict` /
`predict_proba` are read-only on a fitted estimator, so the loaded models are
safe to share across gunicorn's worker threads.
"""
import hashlib
import logging
import os
import threading
import time

from joblib import load

from .preprocess import prep_data

log = logging.getLogger(__name__)

# Axis definition: artifact file, key used in the API/Firestore payload, and
# the letter each class maps to. Order matters -- it spells the type.
AXES = (
    {
        "key": "ei",
        "name": "extraversion",
        "filename": "clf_is_Extrovert.joblib",
        "labels": {0: "I", 1: "E"},
    },
    {
        "key": "sn",
        "name": "sensing",
        "filename": "clf_is_Sensing.joblib",
        "labels": {0: "N", 1: "S"},
    },
    {
        "key": "tf",
        "name": "thinking",
        "filename": "clf_is_Thinking.joblib",
        "labels": {0: "F", 1: "T"},
    },
    {
        "key": "jp",
        "name": "judging",
        "filename": "clf_is_Judging.joblib",
        "labels": {0: "P", 1: "J"},
    },
)


class ModelLoadError(RuntimeError):
    """Raised when an artifact is missing or cannot be deserialised."""


class Predictor(object):
    def __init__(self, model_dir="models", version_override=None):
        self.model_dir = model_dir
        self._version_override = version_override
        self._models = {}
        self._lock = threading.Lock()
        self._version = None

    # ------------------------------------------------------------------ state
    @property
    def loaded(self):
        return len(self._models) == len(AXES)

    def artifact_paths(self):
        return [(a, os.path.join(self.model_dir, a["filename"])) for a in AXES]

    def missing_artifacts(self):
        return [path for _, path in self.artifact_paths() if not os.path.exists(path)]

    def model_version(self):
        """Content-addressed model version.

        Derived from the artifact bytes so that a swapped model is visible in
        every stored prediction. `MODEL_VERSION` overrides it when a release
        tag is more meaningful than a hash.
        """
        if self._version_override:
            return self._version_override
        if self._version is None:
            digest = hashlib.sha256()
            for _, path in self.artifact_paths():
                if not os.path.exists(path):
                    return "unknown"
                digest.update(os.path.basename(path).encode("utf-8"))
                with open(path, "rb") as handle:
                    for chunk in iter(lambda h=handle: h.read(1024 * 1024), b""):
                        digest.update(chunk)
            self._version = "sha256:" + digest.hexdigest()[:16]
        return self._version

    # ----------------------------------------------------------------- loading
    def load_models(self):
        """Load all four artifacts. Idempotent; safe to call concurrently."""
        if self.loaded:
            return
        with self._lock:
            if self.loaded:
                return
            missing = self.missing_artifacts()
            if missing:
                raise ModelLoadError(
                    "missing model artifacts: %s" % ", ".join(missing)
                )
            started = time.time()
            models = {}
            for axis, path in self.artifact_paths():
                try:
                    models[axis["key"]] = load(path)
                except Exception as exc:
                    raise ModelLoadError(
                        "failed to load %s: %s: %s"
                        % (path, type(exc).__name__, exc)
                    ) from exc
            self._models = models
            log.info(
                "models_loaded",
                extra={
                    "count": len(models),
                    "load_ms": int((time.time() - started) * 1000),
                    "model_version": self.model_version(),
                },
            )

    # --------------------------------------------------------------- inference
    def predict(self, text):
        """Predict the MBTI type for `text`.

        Returns:
            {
              "personality_type": "INFP",
              "axes": {"ei": {"letter": "I", "name": ..., "probability": 0.71,
                              "confidence": 0.71}, ...},
              "model_version": "sha256:...",
              "features_ms": 12, "inference_ms": 4,
            }
        """
        if not self.loaded:
            self.load_models()

        feature_start = time.time()
        features = prep_data(text)
        features_ms = int((time.time() - feature_start) * 1000)

        inference_start = time.time()
        letters = []
        axes_payload = {}
        for axis in AXES:
            model = self._models[axis["key"]]
            predicted = model.predict(features)[0]
            letter = axis["labels"].get(
                int(predicted), axis["labels"][max(axis["labels"])]
            )
            letters.append(letter)

            probability = self._probability(model, features, predicted)
            axes_payload[axis["key"]] = {
                "name": axis["name"],
                "letter": letter,
                "probability": probability,
                # Distance from a coin flip, rescaled to 0..1 -- easier to read
                # in a UI than a raw probability.
                "confidence": (
                    round(abs(probability - 0.5) * 2, 4)
                    if probability is not None
                    else None
                ),
            }

        return {
            "personality_type": "".join(letters),
            "axes": axes_payload,
            "model_version": self.model_version(),
            "features_ms": features_ms,
            "inference_ms": int((time.time() - inference_start) * 1000),
        }

    @staticmethod
    def _probability(model, features, predicted):
        """Probability of the predicted class, or None if unsupported."""
        try:
            if not hasattr(model, "predict_proba"):
                return None
            probabilities = model.predict_proba(features)[0]
            classes = list(getattr(model, "classes_", []))
            if classes and predicted in classes:
                return round(float(probabilities[classes.index(predicted)]), 4)
            return round(float(max(probabilities)), 4)
        except Exception as exc:  # a missing probability must not fail a request
            log.warning(
                "probability_unavailable",
                extra={"error": str(exc), "exc_type": type(exc).__name__},
            )
            return None


# --------------------------------------------------------------------- module
# A process-wide default instance so gunicorn's `preload_app` pays the model
# load cost once, before workers fork.
_default_predictor = None
_default_lock = threading.Lock()


def get_predictor(model_dir=None, version_override=None):
    global _default_predictor
    if _default_predictor is None:
        with _default_lock:
            if _default_predictor is None:
                _default_predictor = Predictor(
                    model_dir=model_dir or os.environ.get("MODEL_DIR", "models"),
                    version_override=version_override
                    or os.environ.get("MODEL_VERSION"),
                )
    return _default_predictor


def predict(text):
    """Backwards-compatible helper returning just the four-letter type."""
    return get_predictor().predict(text)["personality_type"]
