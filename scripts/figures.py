#!/usr/bin/env python3
"""Draw the results figure from summary.csv files.

    python3 scripts/figures.py results/fleet-*.csv --labels "Composer, H2" ... -o results/figures/fleet.png

One row per run, one marker per app at its dollar cost including any retry. A filled marker
passed all five checks.
"""

import argparse
import csv
from collections import OrderedDict

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e6e5e1"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]


def load(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def cents(row):
    try:
        return float(row["charged_cents"])
    except (KeyError, ValueError):
        return 0.0


def style(ax):
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=10)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def strips(paths, labels, out):
    fig, ax = plt.subplots(figsize=(10, 1.4 + 0.9 * len(paths)), dpi=200)
    style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    notes = []
    for index, (path, label) in enumerate(zip(paths, labels)):
        rows = load(path)
        color = SERIES[index % len(SERIES)]
        passed = [cents(row) / 100 for row in rows if row["maximal"] == "1"]
        failed = [cents(row) / 100 for row in rows if row["maximal"] != "1"]
        jitter = lambda n: [index + (i % 5 - 2) * 0.07 for i in range(n)]
        ax.scatter(passed, jitter(len(passed)), s=34, color=color, linewidths=0, zorder=3)
        ax.scatter(failed, jitter(len(failed)), s=34, facecolors="white", edgecolors=color, linewidths=1.5, zorder=3)
        total = sum(cents(row) for row in rows) / 100
        minutes = sum(float(row["minutes"] or 0) for row in rows) / max(len(rows), 1)
        notes.append(f"{len(passed)}/{len(rows)} migrated\n${total:.2f}, {minutes:.1f} min/app")
    ax.set_yticks(range(len(paths)))
    ax.set_yticklabels(labels, color=INK)
    twin = ax.twinx()
    twin.set_ylim(ax.get_ylim())
    twin.set_yticks(range(len(paths)))
    twin.set_yticklabels(notes, color=INK_2, fontsize=8.5)
    for side in ("top", "right", "left", "bottom"):
        twin.spines[side].set_visible(False)
    twin.tick_params(length=0)
    ax.set_xlim(left=0)
    ax.invert_yaxis()
    twin.set_ylim(ax.get_ylim())
    ax.set_xlabel("Cost per migration", color=INK_2)
    fig.tight_layout()
    fig.savefig(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--labels", nargs="*", help="one per path; defaults to the run column")
    parser.add_argument("-o", "--out", required=True)
    args = parser.parse_args()
    labels = args.labels or [load(path)[0]["run"] for path in args.paths]
    strips(args.paths, labels, args.out)
    print(args.out)


if __name__ == "__main__":
    main()
