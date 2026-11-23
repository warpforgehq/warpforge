#!/usr/bin/env python3
"""Summarize agent browser benchmark runs.

    summarize.py LABEL [--runs DIR] [--db PATH]   write results/LABEL.{json,md}
    summarize.py --compare BASE NEW                 print BASE vs NEW from results/

A run is one file `<scenario>-<label>-<n>.jsonl` in the runs directory, holding
the WARPFORGE_BROWSER_BENCH_LOG lines of one agent session.
"""

import argparse
import json
import re
import sqlite3
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
METRICS = ["calls", "chars", "est_tokens", "screenshots", "image_bytes", "errors", "ms"]
DB_METRICS = ["cost_usd", "peak_context"]


def read_lines(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def expectations():
    """Map scenario id to its `expect.contains` strings, read from scenarios.yaml."""
    found, current = {}, None
    for line in (HERE / "scenarios.yaml").read_text().splitlines():
        if m := re.match(r"- id:\s*(\S+)", line):
            current = m.group(1)
        elif (m := re.match(r"\s+contains:\s*(\[.*\])", line)) and current:
            found[current] = json.loads(m.group(1))
    return found


def task_rows(db, task):
    rows = db.execute(
        "SELECT update_json FROM session_updates WHERE task_id = ? ORDER BY id", (task,)
    )
    return [json.loads(r[0]) for r in rows]


def sum_of_run_peaks(values):
    """Cost is a running total that restarts with the session; sum each run's peak."""
    total, peak = 0.0, None
    for v in values:
        if peak is not None and v < peak:
            total += peak
        peak = v
    return total + (peak or 0.0)


def from_db(db, tasks, expected):
    costs, used, text = [], [], []
    for task in tasks:
        for row in task_rows(db, task):
            kind = row.get("kind")
            if kind == "usage":
                used.append(row.get("used", 0))
                cost = row.get("cost") or {}
                if cost.get("currency") == "USD":
                    costs.append(cost["amount"])
            elif kind == "agent_text":
                text.append(row.get("text", ""))
    answer = "".join(text)
    out = {
        "cost_usd": round(sum_of_run_peaks(costs), 4) if costs else None,
        "peak_context": max(used) if used else None,
    }
    if expected is not None:
        out["passed"] = all(s in answer for s in expected)
    return out


def summarize_run(lines):
    per_tool = {}
    for entry in lines:
        per_tool[entry["tool"]] = per_tool.get(entry["tool"], 0) + 1
    chars = sum(e.get("chars", 0) for e in lines)
    return {
        "calls": len(lines),
        "per_tool": per_tool,
        "chars": chars,
        "est_tokens": chars // 4,
        "screenshots": per_tool.get("browser_screenshot", 0),
        "image_bytes": sum(e.get("image_bytes", 0) for e in lines),
        "errors": sum(1 for e in lines if not e.get("ok", True)),
        "ms": sum(e.get("ms", 0) for e in lines),
        "tasks": sorted({e["task"] for e in lines if e.get("task")}),
    }


def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def summarize(label, runs_dir, db_path):
    pattern = re.compile(rf"^(.+)-{re.escape(label)}-(\d+)\.jsonl$")
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) if db_path else None
    expected = expectations()
    scenarios = {}
    for path in sorted(Path(runs_dir).glob("*.jsonl")):
        if not (m := pattern.match(path.name)):
            continue
        run = summarize_run(read_lines(path))
        run["file"] = path.name
        if db:
            run.update(from_db(db, run["tasks"], expected.get(m.group(1))))
        scenarios.setdefault(m.group(1), []).append(run)

    result = {"label": label, "est_tokens_note": "chars / 4, an estimate", "scenarios": {}}
    for scenario, runs in sorted(scenarios.items()):
        tools = sorted({t for r in runs for t in r["per_tool"]})
        med = {k: median([r.get(k) for r in runs]) for k in METRICS + DB_METRICS}
        med["per_tool"] = {t: median([r["per_tool"].get(t, 0) for r in runs]) for t in tools}
        passed = [r["passed"] for r in runs if "passed" in r]
        if passed:
            med["passed"] = f"{sum(passed)}/{len(passed)}"
        result["scenarios"][scenario] = {"runs": runs, "median": med}
    return result


def fmt(value):
    if value is None:
        return "–"
    if isinstance(value, float) and not value.is_integer():
        return f"{value:.4g}"
    return str(int(value)) if isinstance(value, float) else str(value)


def table(result):
    head = "| scenario | runs | calls | calls per tool | chars | est. tokens | screenshots | errors | cost USD | peak context | passed |"
    rows = [f"Median per scenario for `{result['label']}`. Est. tokens = chars / 4.", "", head, "|" + "---|" * 11]
    for scenario, data in result["scenarios"].items():
        m = data["median"]
        tools = ", ".join(f"{t.removeprefix('browser_')} {fmt(n)}" for t, n in m["per_tool"].items())
        cells = [scenario, len(data["runs"]), m["calls"], tools, m["chars"], m["est_tokens"],
                 m["screenshots"], m["errors"], m["cost_usd"], m["peak_context"], m.get("passed")]
        rows.append("| " + " | ".join(fmt(c) for c in cells) + " |")
    return "\n".join(rows) + "\n"


def compare(base, new):
    a = json.loads((HERE / "results" / f"{base}.json").read_text())["scenarios"]
    b = json.loads((HERE / "results" / f"{new}.json").read_text())["scenarios"]
    keys = ["calls", "chars", "est_tokens", "screenshots", "cost_usd"]
    rows = [f"Median {base} → {new}.", "", "| scenario | " + " | ".join(keys) + " |", "|" + "---|" * (len(keys) + 1)]
    for scenario in sorted(set(a) | set(b)):
        cells = []
        for k in keys:
            x = a.get(scenario, {}).get("median", {}).get(k)
            y = b.get(scenario, {}).get("median", {}).get(k)
            delta = f" ({(y - x) / x:+.0%})" if x and y is not None else ""
            cells.append(f"{fmt(x)} → {fmt(y)}{delta}")
        rows.append(f"| {scenario} | " + " | ".join(cells) + " |")
    return "\n".join(rows) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("label", nargs="?")
    parser.add_argument("--runs", default=HERE / "runs")
    parser.add_argument("--db", help="warpforge database (~/.warpforge/warpforge.db) for cost and pass/fail")
    parser.add_argument("--compare", nargs=2, metavar=("BASE", "NEW"))
    args = parser.parse_args()
    if args.compare:
        print(compare(*args.compare), end="")
        return
    if not args.label:
        parser.error("give a LABEL or --compare BASE NEW")
    result = summarize(args.label, args.runs, args.db)
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    (out / f"{args.label}.json").write_text(json.dumps(result, indent=2) + "\n")
    md = table(result)
    (out / f"{args.label}.md").write_text(md)
    print(md, end="")


if __name__ == "__main__":
    main()
