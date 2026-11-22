# Agent browser benchmark

Measures what the agent browser tools (`browser_*`) cost an agent per task, so
a change to the tools can be compared against a baseline. Each scenario in
`scenarios.yaml` is one task with a checkable answer; six run against the
fixture pages in `site/`, two against live read-only sites.

## 1. Start the daemon with logging on

The MCP bridge appends one JSON line per browser tool call to the file named by
`WARPFORGE_BROWSER_BENCH_LOG`:

```json
{"ts":"…","task":"t_ab12","tool":"browser_type","args":{"ref":"e4","submit":false,"text_len":12},"ok":true,"chars":312,"image_bytes":0,"ms":41}
```

`chars` is the length of the text returned to the agent (an error counts as
its message), `image_bytes` the decoded size of a screenshot. Typed text is
logged by length only.

The variable has to be in the daemon's environment: the daemon copies it into
the bridge entry of every session it starts. The desktop app reuses a daemon
that is already running, so quit the app (which stops a daemon it spawned) and
start the daemon yourself, then open the app:

```bash
cargo build --release
WARPFORGE_BROWSER_BENCH_LOG="$PWD/bench/browser/runs/all.jsonl" target/release/warpforge daemon
```

Launching the app from a shell with the variable exported works as well, as
long as no daemon was running. Only sessions started after the daemon picked up
the variable are logged.

## 2. Start the fixture site

Start the `browser-bench` service from the Runtime panel (or `service_start`).
Its URL, e.g. `http://127.0.0.1:4400`, is `{base}` in the scenarios. Its origin
is allowed automatically; Wikipedia and GitHub ask for approval on first use —
approve "always" for the task, before the run you measure, so the prompt's wait
does not land in `ms`.

## 3. Run a scenario

For each scenario, start a new task on the agent being measured, with `{base}`
replaced in the scenario's `prompt`, and let it finish. Append to every prompt:
"Use only the browser_* tools; do not read files, run shell commands or fetch
URLs any other way." The answers are in `site/` in this repo, so a run with a
correct answer and almost no browser calls read them from disk — discard it.
Use a fresh task per run
so its log lines and its usage carry their own task id. Then cut that run out of
the shared log into `runs/<scenario>-<label>-<n>.jsonl`:

```bash
grep '"task":"t_ab12"' bench/browser/runs/all.jsonl > bench/browser/runs/form-baseline-1.jsonl
```

`<label>` names the build being measured (`baseline`, `interactive-snapshot`, …);
`<n>` numbers repeated runs. Three runs per scenario is a sensible minimum, the
summary reports medians.

## 4. Summarize and compare

```bash
python3 bench/browser/summarize.py baseline --db ~/.warpforge/warpforge.db
python3 bench/browser/summarize.py interactive-snapshot --db ~/.warpforge/warpforge.db
python3 bench/browser/summarize.py --compare baseline interactive-snapshot
```

Each label writes `results/<label>.json` (every run plus medians) and
`results/<label>.md`. Per scenario: browser calls, calls per tool, total chars,
estimated tokens (chars / 4 — an estimate, not a tokenizer count), screenshots,
image bytes, failed calls, time spent in browser calls.

`--db` adds end-to-end numbers from the daemon's own records, which hold every
ACP `usage_update` per task in `session_updates`:

- `cost_usd` — the session's reported cumulative cost, summed over session
  restarts the same way the app's spend view does. Claude and opencode report
  it; Codex does not, so it stays empty there. It covers the whole task, not
  only the browser calls.
- `peak_context` — the largest context-window fill the agent reported.
- `passed` — whether the agent's own messages contain every `expect.contains`
  string of the scenario. The GitHub scenario has no fixed answer and is
  graded by hand.

Without `--db` only the browser-call numbers are produced. To read one task by
hand:

```bash
sqlite3 ~/.warpforge/warpforge.db "SELECT update_json FROM session_updates
  WHERE task_id = 't_ab12' AND json_extract(update_json, '$.kind') = 'usage' ORDER BY id"
```

## Notes

- The fixture pages need no build step; edit them in place. Their success codes
  only appear after the task is done, so an answer cannot be read off the page
  early.
- `covered.html` ignores a click whose centre is covered by another element,
  the way a real pointer would hit the overlay instead.
- `runs/` is ignored by git; commit `results/` when a measurement is worth
  keeping.
