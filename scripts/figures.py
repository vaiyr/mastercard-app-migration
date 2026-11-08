#!/usr/bin/env python3
"""Draw the deck figures from summary.csv files.

    python3 scripts/figures.py ladder results/practice-h1.csv results/practice-h2.csv ... -o results/figures/ladder.png
    python3 scripts/figures.py models results/mastercard-composer.csv results/mastercard-grok.csv -o results/figures/mastercard.png

ladder: one bar per step (distinct repos passing) with the step's total dollars under
each label. A step CSV may list a repo twice (first run plus a later lever); passes
count the repo once and dollars count every run.
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
        repos = {row["repo"] for row in rows}
        n = max(n, len(repos))
        xs.append(index)
        passes.append(len({row["repo"] for row in rows if row["maximal"] == "1"}))
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
