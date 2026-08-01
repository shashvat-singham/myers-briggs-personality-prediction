"""Fixed-window per-client rate limiter.

Deliberately dependency-free and in-process: the limiter protects a CPU-bound
model server from a single abusive client, which is the failure mode that
actually matters here. Two consequences to know about:

  * The budget is per gunicorn worker, so the effective global limit is
    roughly RATE_LIMIT_REQUESTS x worker count.
  * State is lost on restart.

If you need an exact cluster-wide limit, put it at the edge (Netlify/Cloud
Armor) or swap this for flask-limiter backed by Redis -- `limit()` is the only
call site to change.
"""
import threading
import time


class RateLimiter(object):
    def __init__(self, max_requests, window_seconds, max_tracked_keys=20000):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_tracked_keys = max_tracked_keys
        self._lock = threading.Lock()
        # key -> [window_start, count]
        self._buckets = {}

    def _now(self):
        return time.monotonic()

    def check(self, key):
        """Consume one unit for `key`.

        Returns (allowed, remaining, retry_after_seconds).
        """
        if self.max_requests <= 0:
            return True, 0, 0

        now = self._now()
        with self._lock:
            if len(self._buckets) > self.max_tracked_keys:
                self._evict_expired(now)
                # Still unbounded growth under a distributed flood: drop the
                # whole table rather than leak memory.
                if len(self._buckets) > self.max_tracked_keys:
                    self._buckets.clear()

            bucket = self._buckets.get(key)
            if bucket is None or now - bucket[0] >= self.window_seconds:
                self._buckets[key] = [now, 1]
                return True, self.max_requests - 1, 0

            bucket[1] += 1
            if bucket[1] > self.max_requests:
                retry_after = max(
                    1, int(self.window_seconds - (now - bucket[0])) + 1
                )
                return False, 0, retry_after
            return True, self.max_requests - bucket[1], 0

    def _evict_expired(self, now):
        cutoff = self.window_seconds
        for key in [k for k, v in self._buckets.items() if now - v[0] >= cutoff]:
            self._buckets.pop(key, None)

    def reset(self):
        with self._lock:
            self._buckets.clear()
