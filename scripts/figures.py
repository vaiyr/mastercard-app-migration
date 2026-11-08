#!/usr/bin/env python3
"""Draw the results figures from summary.csv files.

    python3 scripts/figures.py models results/mastercard-*.csv --labels "Composer, H2" ... -o results/figures/mastercard.png
    python3 scripts/figures.py strips results/fleet-*.csv --labels "Composer, H2" ... -o results/figures/fleet.png

models: one row per repo, one marker per run; fits a handful of repos.
strips: one row per run, one marker per repo; fits a whole estate.
x is dollars charged for the app including any retry; a filled marker passed all five checks.
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


def models(paths, labels, out):
    rows_by_model = OrderedDict()
    repos = []
    for path, label in zip(paths, labels):
        rows = load(path)
        rows_by_model[label] = {row["repo"]: row for row in rows}
        for row in rows:
            if row["repo"] not in repos:
                repos.append(row["repo"])
    count = len(rows_by_model)
    fig, ax = plt.subplots(figsize=(8, 1.6 + 1.1 * len(repos)), dpi=200)
    style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    step = 0.8 / max(count, 1)
    for index, (label, by_repo) in enumerate(rows_by_model.items()):
        color = SERIES[index % len(SERIES)]
        offset = (index - (count - 1) / 2) * step
        for y, repo in enumerate(repos):
            row = by_repo.get(repo)
            if not row:
                continue
            dollars = cents(row) / 100
            passed = row["maximal"] == "1"
            ax.scatter(dollars, y + offset, s=70, color=color if passed else "white", edgecolors=color, linewidths=2, zorder=3,
                       label=label if y == 0 else None)
            ax.annotate(f"${dollars:.2f}" + ("" if passed else "  fail"), (dollars, y + offset), textcoords="offset points", xytext=(8, -3), fontsize=8.5, color=INK_2)
        for y in range(len(repos) - 1):
            ax.axhline(y + 0.5, color=GRID, linewidth=0.8)
    ax.set_yticks(range(len(repos)))
    ax.set_yticklabels([repo.replace("mastercard-", "").replace("-reference-app", "") for repo in repos], color=INK)
    ax.invert_yaxis()
    ax.set_xlabel("dollars charged per app, including any retry (filled = passed all five checks)", color=INK_2)
    ax.set_xlim(0, ax.get_xlim()[1] * 1.12)
    ax.legend(frameon=False, loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=min(count, 4), fontsize=9)
    ax.set_title("Mastercard apps: every cell passed; the cheap model did it for a fifth of the price", loc="left", color=INK, fontsize=11, pad=28)
    fig.tight_layout()
    fig.savefig(out)


def strips(paths, labels, out):
    fig, ax = plt.subplots(figsize=(8, 1.4 + 0.9 * len(paths)), dpi=200)
    style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
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
        ax.annotate(f"{len(passed)}/{len(rows)} passed   ${total:.2f} total   {minutes:.1f} min/app",
                    (1.0, index), xycoords=("axes fraction", "data"), textcoords="offset points", xytext=(-4, 9), ha="right", fontsize=8.5, color=INK_2)
    ax.set_yticks(range(len(paths)))
    ax.set_yticklabels(labels, color=INK)
    ax.invert_yaxis()
    ax.set_xlim(left=0)
    ax.set_xlabel("dollars charged per app, including any retry (filled = passed all five checks)", color=INK_2)
    ax.set_title("Every Mastercard reference app not yet on Java 17: two setups, two models", loc="left", color=INK, fontsize=11)
    fig.tight_layout()
    fig.savefig(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", choices=["models", "strips"])
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--labels", nargs="*", help="one per path; defaults to the run column")
    parser.add_argument("-o", "--out", required=True)
    args = parser.parse_args()
    labels = args.labels or [load(path)[0]["run"] for path in args.paths]
    (models if args.kind == "models" else strips)(args.paths, labels, args.out)
    print(args.out)


if __name__ == "__main__":
    main()
