#!/usr/bin/env python
"""Recompute the /stats counters from the stored predictions.

The counters at `/stats` are maintained incrementally on write, which is what
keeps `/api/v1/stats` to a single read. Two things can make them drift:

* a counter transaction failed after the prediction was already stored
  (logged as `stats_update_failed`), or
* records were deleted by tools/prune_predictions.py.

This script is the repair. It reads every prediction once, so it is O(history)
and download-billed -- run it deliberately, not on a tight schedule.

    python tools/rebuild_stats.py --dry-run
    python tools/rebuild_stats.py
"""
import argparse
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

from mbpp.config import get_config  # noqa: E402
from mbpp.repository import create_repository  # noqa: E402


def recount(records):
    """Return the counter node implied by `records`."""
    counts = {}
    total = 0
    for record in records.values():
        if not isinstance(record, dict):
            continue
        total += 1
        key = str(record.get("personality_type") or "unknown")
        counts[key] = counts.get(key, 0) + 1
    return {
        "total": total,
        "types": counts,
        "updated_at": int(
            datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000
        ),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    config = get_config()
    if config.DATABASE_BACKEND != "rtdb":
        print(
            "This script targets the Realtime Database; DATABASE_BACKEND is %r."
            % config.DATABASE_BACKEND
        )
        return 1

    repo = create_repository(config)
    handle = repo.client()
    if handle is None:
        print("Could not connect to the database; check credentials and URL.")
        return 2

    predictions_ref = handle.db.reference(
        config.RTDB_PREDICTIONS_PATH, app=handle.app
    )
    records = predictions_ref.get() or {}
    rebuilt = recount(records)

    current = repo.stats() or {"total": 0, "types": {}}
    print("current: total=%s types=%d" % (current.get("total"), len(current.get("types") or {})))
    print("rebuilt: total=%s types=%d" % (rebuilt["total"], len(rebuilt["types"])))

    if int(current.get("total") or 0) == rebuilt["total"] and (
        current.get("types") or {}
    ) == rebuilt["types"]:
        print("Counters already match; nothing to do.")
        return 0

    if args.dry_run:
        print("Dry run: not writing.")
        return 0

    # set(), not update(): stale type keys must disappear, and update() would
    # leave them behind.
    handle.db.reference(config.RTDB_STATS_PATH, app=handle.app).set(rebuilt)
    print("Counters rewritten.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
