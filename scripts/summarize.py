#!/usr/bin/env python3
"""Print the tables the deck uses from one or more summary.csv files.

    python3 scripts/summarize.py results/*.csv
    python3 scripts/summarize.py out/*/summary.csv

One row per run in the input. Output: a per-run table and a per-(run) ladder
with passes, cents, minutes, and tool calls.
"""

import csv
import sys
from collections import OrderedDict


def load(paths):
    rows = []
    for path in paths:
        with open(path, newline="") as handle:
            rows.extend(csv.DictReader(handle))
    return rows


def num(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def checks(row):
    return "".join("." if row.get(key) == "1" else "x" for key in ("r1", "r2", "r3", "r4", "r5"))


def main(paths):
    rows = load(paths)
    if not rows:
        print("no rows")
        return
    print(f"{'run':34} {'repo':44} {'model':14} {'r1-r5':6} {'pass':4} {'calls':>5} {'min':>6} {'$':>7} {'stop':12}")
    for row in sorted(rows, key=lambda r: (r["run"], r["repo"])):
        print(
            f"{row['run'][:34]:34} {row['repo'][:44]:44} {row['model'][:14]:14} {checks(row):6} "
            f"{'PASS' if row['maximal'] == '1' else 'fail':4} {row['calls']:>5} {num(row['minutes']):>6.1f} "
            f"{num(row['charged_cents']) / 100:>7.3f} {row.get('stop_reason', '')[:12]:12}"
        )
    print()
    ladder = OrderedDict()
    for row in rows:
        entry = ladder.setdefault(row["run"], {"n": 0, "pass": 0, "cents": 0.0, "minutes": 0.0, "calls": 0, "model": row["model"], "setup": row["setup"]})
        entry["n"] += 1
        entry["pass"] += row["maximal"] == "1"
        entry["cents"] += num(row["charged_cents"])
        entry["minutes"] += num(row["minutes"])
        entry["calls"] += int(num(row["calls"]))
    print(f"{'run':34} {'setup':5} {'model':14} {'pass':>7} {'$ total':>8} {'$/app':>7} {'min/app':>8} {'calls/app':>9}")
    for name, entry in ladder.items():
        n = entry["n"] or 1
        print(
            f"{name[:34]:34} {entry['setup']:5} {entry['model'][:14]:14} {entry['pass']:>3}/{entry['n']:<3} "
            f"{entry['cents'] / 100:>8.2f} {entry['cents'] / 100 / n:>7.3f} {entry['minutes'] / n:>8.1f} {entry['calls'] / n:>9.1f}"
        )


if __name__ == "__main__":
    main(sys.argv[1:] or ["results/summary.csv"])
