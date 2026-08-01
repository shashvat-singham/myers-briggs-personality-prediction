#!/usr/bin/env python
"""Delete expired predictions from the Realtime Database.

The Realtime Database has no TTL feature -- Firestore does, which is why the
Firestore backend needs no equivalent script. Here, `expires_at` is advisory
until something acts on it, and that something is this script.

Run it on a schedule (Cloud Scheduler, GitHub Actions cron, a host crontab):

    python tools/prune_predictions.py --dry-run     # report only
    python tools/prune_predictions.py               # delete
    python tools/prune_predictions.py --older-than-days 30

Without pruning, history grows until it hits the 1 GB free-tier ceiling, and
every `/history` read pays for a larger tree.

Credentials and the database URL come from the same env vars the app uses; see
.env.example.
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


def now_ms():
    return int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)


def find_expired(handle, repo, cutoff_ms, batch_size):
    """Return {key: record} for predictions created before `cutoff_ms`.

    Queried by `created_at` (indexed in database.rules.json) rather than
    `expires_at`, because records written while TTL was disabled have no
    `expires_at` at all and would otherwise be invisible to pruning.
    """
    ref = handle.db.reference(repo.config.RTDB_PREDICTIONS_PATH, app=handle.app)
    snapshot = (
        ref.order_by_child("created_at").end_at(cutoff_ms).limit_to_first(batch_size).get()
    )
    return {
        key: value
        for key, value in (snapshot or {}).items()
        if isinstance(value, dict)
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--older-than-days",
        type=int,
        default=None,
        help="override PREDICTION_TTL_DAYS for this run",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="records to fetch per pass (default 500)",
    )
    parser.add_argument(
        "--max-batches",
        type=int,
        default=20,
        help="safety stop, so a cron run cannot loop forever (default 20)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    config = get_config()
    if config.DATABASE_BACKEND != "rtdb":
        print(
            "This script prunes the Realtime Database; DATABASE_BACKEND is %r. "
            "Firestore expires documents itself via its TTL policy."
            % config.DATABASE_BACKEND
        )
        return 1

    days = args.older_than_days
    if days is None:
        days = int(getattr(config, "PREDICTION_TTL_DAYS", 0) or 0)
    if days <= 0:
        print(
            "No retention window configured (PREDICTION_TTL_DAYS=0). "
            "Pass --older-than-days N to prune anyway."
        )
        return 1

    repo = create_repository(config)
    handle = repo.client()
    if handle is None:
        print("Could not connect to the database; check credentials and URL.")
        return 2

    cutoff_ms = now_ms() - days * 86400 * 1000
    cutoff_iso = datetime.datetime.fromtimestamp(
        cutoff_ms / 1000.0, tz=datetime.timezone.utc
    ).isoformat()
    print("Pruning predictions created before %s (%d days)" % (cutoff_iso, days))

    deleted = 0
    for batch_number in range(args.max_batches):
        expired = find_expired(handle, repo, cutoff_ms, args.batch_size)
        if not expired:
            break

        if args.dry_run:
            for key, record in expired.items():
                print(
                    "  would delete %s (%s, created_at=%s)"
                    % (key, record.get("personality_type"), record.get("created_at"))
                )
            deleted += len(expired)
            break  # nothing is removed, so a second pass would repeat itself

        # One multi-path update per batch instead of N deletes: a single request,
        # and the whole batch lands or none of it does.
        ref = handle.db.reference(repo.config.RTDB_PREDICTIONS_PATH, app=handle.app)
        ref.update({key: None for key in expired})
        deleted += len(expired)
        print("  batch %d: deleted %d" % (batch_number + 1, len(expired)))

        if len(expired) < args.batch_size:
            break

    print("%s %d record(s)" % ("Would delete" if args.dry_run else "Deleted", deleted))
    if not args.dry_run and deleted:
        print(
            "Counters in /stats still include the deleted records. "
            "Run tools/rebuild_stats.py if you need them to match."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
