#!/usr/bin/env python3
"""Draw the deck figures from summary.csv files.

    python3 scripts/figures.py ladder results/practice-h1.csv results/practice-h2.csv ... -o results/figures/ladder.png
    python3 scripts/figures.py models results/mastercard-composer.csv results/mastercard-grok.csv -o results/figures/mastercard.png

ladder: one bar per run (passes out of n) with total dollars under each label.
models: one row per repo, one marker per model, x = dollars, filled when the run passed.
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


def ladder(paths, labels, out):
    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=200)
    style(ax)
    xs, passes, totals, n = [], [], [], 0
    for index, path in enumerate(paths):
        rows = load(path)
        n = max(n, len(rows))
        xs.append(index)
        passes.append(sum(row["maximal"] == "1" for row in rows))
        totals.append(sum(cents(row) for row in rows) / 100)
    bars = ax.bar(xs, passes, width=0.55, color=SERIES[0], linewidth=0)
    for bar, value in zip(bars, passes):
        ax.text(bar.get_x() + bar.get_width() / 2, value + 0.15, f"{value}/{n}", ha="center", va="bottom", color=INK, fontsize=11)
    ax.set_xticks(xs)
    ax.set_xticklabels([f"{label}\n${total:.2f}" for label, total in zip(labels, totals)], color=INK_2)
    ax.set_ylim(0, n + 1)
    ax.set_ylabel("apps passing all five checks", color=INK_2)
    ax.set_title("Practice set: each lever, passes and total spend", loc="left", color=INK, fontsize=12)
    fig.tight_layout()
    fig.savefig(out)


def models(paths, labels, out):
    rows_by_model = OrderedDict()
    repos = []
    for path, label in zip(paths, labels):
        rows = load(path)
        rows_by_model[label] = {row["repo"]: row for row in rows}
        for row in rows:
            if row["repo"] not in repos:
                repos.append(row["repo"])
    fig, ax = plt.subplots(figsize=(8, 1.2 + 0.7 * len(repos)), dpi=200)
    style(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.yaxis.grid(False)
    for index, (label, by_repo) in enumerate(rows_by_model.items()):
        color = SERIES[index % len(SERIES)]
        for y, repo in enumerate(repos):
            row = by_repo.get(repo)
            if not row:
                continue
            dollars = cents(row) / 100
            passed = row["maximal"] == "1"
            ax.scatter(dollars, y, s=90, color=color if passed else "white", edgecolors=color, linewidths=2, zorder=3,
                       label=label if y == 0 else None)
            ax.annotate(f"${dollars:.2f}" + ("" if passed else " fail"), (dollars, y), textcoords="offset points", xytext=(8, -3), fontsize=9, color=INK_2)
    ax.set_yticks(range(len(repos)))
    ax.set_yticklabels([repo.replace("mastercard-", "").replace("-reference-app", "") for repo in repos], color=INK)
    ax.invert_yaxis()
    ax.set_xlabel("dollars charged per app (filled = passed all five checks)", color=INK_2)
    ax.set_xlim(left=0)
    ax.legend(frameon=False, loc="lower right", fontsize=9)
    ax.set_title("Mastercard apps: cheap model against expensive model, same setup", loc="left", color=INK, fontsize=12)
    fig.tight_layout()
    fig.savefig(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", choices=["ladder", "models"])
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--labels", nargs="*", help="one per path; defaults to the run column")
    parser.add_argument("-o", "--out", required=True)
    args = parser.parse_args()
    labels = args.labels or [load(path)[0]["run"] for path in args.paths]
    (ladder if args.kind == "ladder" else models)(args.paths, labels, args.out)
    print(args.out)


if __name__ == "__main__":
    main()
