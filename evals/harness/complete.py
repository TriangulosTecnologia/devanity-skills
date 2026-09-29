#!/usr/bin/env python3
# Ported from ponytail (https://github.com/DietrichGebert/ponytail), benchmarks/agentic/complete.py,
# commit e3ba2aa (2026-09-14). Copyright (c) 2026 DietrichGebert. MIT License; see LICENSE-ponytail
# in this directory. Modified for devanity-skills: arms, environment names, tiers, and attribution.
"""LLM-judge COMPLETENESS pass for the agentic benchmark.

Fewer lines is only a win if the code still does the job. The real-repo tickets (tmpl-*) are
scored on LOC alone and the unattended billing scorer only proves the queue -- there is no deterministic check that the asked
feature was actually implemented, so an arm could "win" the LOC metric by shipping a stub.
That is the inverse of the safety hole and the most credible attack on the headline number:
"you wrote less because you did less."

This pass closes it. An LLM judge rates how FULLY each submission implements its task, on the
auditable footing: a published rubric, a fixed
model at temperature 0, and a --selftest that must rank a complete reference strictly above a
stub before any real scoring is trusted. Pair the output with run.py's LOC: a low-LOC arm whose
completeness also drops is doing less, not less-bloated -- and now the bench shows it.

  python complete.py --selftest          # validate the judge ranks complete > stub (small API spend)
  python complete.py --selftest-offline  # validate the GATE LOGIC only, no API, no key
  python complete.py --run runs/<stamp>  # completeness-judge every workspace in a matrix run

Judge: claude-sonnet-4-6 via the Messages API (key from ../../.env or ANTHROPIC_API_KEY), or, without a
key, via `claude -p` (no temperature control; the run records which backend judged). ~$0.003/cell.

"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request
from collections import defaultdict
from pathlib import Path

from tasks import TASKS, source_text      # source_text: what the judge reads (the delivery, tests excluded)
import run as _run                      # RUNS_DIR (DEVANITY_HARNESS_RUNS_DIR), memory_guard, PERMISSION_MODE

ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = _run.RUNS_DIR
JUDGE_MODEL = "claude-sonnet-4-6"
# Backend "cli": when no ANTHROPIC_API_KEY exists (a subscription-only maintainer), the judge call
# goes through `claude -p` with the same rubric as system prompt, the same user message and the
# same JSON parse. Two declared losses vs the Messages API: the CLI exposes no temperature (so
# "temperature 0" is not guaranteed; the run records which backend judged), and the judge model is
# whatever the CLI resolves JUDGE_MODEL to. Every tool is disabled, one turn, cwd under RUNS_DIR
# (memory_guard: no CLAUDE.md/AGENTS.md above it, so the judge never inherits the kernel).
JUDGE_BACKEND = "api"   # set by load_key(): "api" with a key, "cli" without one
ARMS_ORDER = list(_run.ARMS)


def load_key():
    """The API key from ../../.env or the environment; None means the `claude -p` backend."""
    global JUDGE_BACKEND
    key = None
    try:
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY=") and len(line) > 18:
                key = line.split("=", 1)[1].strip()
    except Exception:
        pass
    key = key or os.environ.get("ANTHROPIC_API_KEY")
    JUDGE_BACKEND = "api" if key else "cli"
    return key

def judge_backend_label():
    return f"{JUDGE_MODEL} via {'Messages API, temperature 0' if JUDGE_BACKEND == 'api' else 'claude -p (no temperature control)'}"

def _judge_call_cli(user, system, retries=3):
    claude = shutil.which("claude")
    if not claude: return '{"error": "claude CLI not found on PATH"}'
    _run.memory_guard(RUNS_DIR); RUNS_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [claude, "-p", user, "--model", JUDGE_MODEL, "--output-format", "json",
           "--append-system-prompt", system, "--setting-sources", "project,local", "--strict-mcp-config",
           "--tools", "", "--max-turns", "1", "--no-session-persistence",
           "--permission-mode", _run.PERMISSION_MODE]
    for attempt in range(retries):
        try:
            with tempfile.TemporaryDirectory(dir=RUNS_DIR) as d:
                r = subprocess.run(cmd, cwd=d, capture_output=True, text=True, timeout=180)
            j = json.loads(r.stdout)
            if j.get("is_error"): raise RuntimeError(str(j.get("result"))[:120])
            return j.get("result", "")
        except Exception as e:
            if attempt == retries - 1: return f'{{"error": "{str(e)[:120]}"}}'
            time.sleep(2 * (attempt + 1))

def judge_call(task_prompt, files, key, system, retries=3):
    user = f"TASK GIVEN TO THE AUTHOR:\n{task_prompt}\n\nFILES THEY WROTE:\n{files}"
    if not key: return _judge_call_cli(user, system, retries)
    body = json.dumps({"model": JUDGE_MODEL, "max_tokens": 300, "temperature": 0,
                       "system": system, "messages": [{"role": "user", "content": user}]}).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body,
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.loads(r.read())
            return j["content"][0]["text"]
        except Exception as e:
            if attempt == retries - 1: return f'{{"error": "{str(e)[:120]}"}}'
            time.sleep(2 * (attempt + 1))

def parse_score(text):
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m: return None
    try:
        d = json.loads(m.group(0))
        return d
    except Exception:
        return None


SCORE_KEY = "completeness"
FLAG_AT = 1                 # cells scoring <= this are under-delivery (stub/partial) and get listed

RUBRIC = (
    "You are a senior engineer checking whether a code submission ACTUALLY IMPLEMENTS the task it "
    "was given. Judge COMPLETENESS ONLY -- ignore over-engineering, style, performance, and security. "
    "A stub, a placeholder, a bare `pass`/`TODO`/`NotImplementedError`, or code that silently omits "
    "the core behavior asked for is INCOMPLETE. Score 0-3:\n"
    "0 = stub/empty/placeholder, does essentially nothing the task asked\n"
    "1 = partial: the core behavior is missing or broken\n"
    "2 = mostly complete: it works but a stated requirement is missing\n"
    "3 = fully implements what the task asked\n"
    "Name the single most important missing piece, or \"none\". "
    "Respond with ONLY this JSON: {\"completeness\": <0-3 int>, \"why\": \"<one line>\", \"missing\": \"<piece or none>\"}"
)

def judge_prompt(task_id):
    """What the completeness judge is told the task was: its prompt, plus the task's `judge_note`
    when a slice of the right answer is a queued stub the rubric would otherwise call incomplete."""
    t = TASKS[task_id]
    return t["prompt"] + (f"\n\nJudge note: {t['judge_note']}" if t.get("judge_note") else "")

def parse_complete(text):
    d = parse_score(text)
    if d and SCORE_KEY in d:
        try: d[SCORE_KEY] = int(d[SCORE_KEY])
        except Exception: d[SCORE_KEY] = None
    return d

# --- the gate: a complete impl must out-score a stub for the same task ---
def _rank_ok(scores):
    """scores: {(task_id, label): {SCORE_KEY: int}}. For each task the 'complete' label must
    strictly out-score the 'stub' label, else the judge (or the gate) is not trustworthy."""
    ok = True
    for task_id in sorted({t for (t, _) in scores}):
        hi = scores.get((task_id, "complete")) or {}
        lo = scores.get((task_id, "stub")) or {}
        if not (isinstance(hi.get(SCORE_KEY), int) and isinstance(lo.get(SCORE_KEY), int)
                and hi[SCORE_KEY] > lo[SCORE_KEY]):
            print(f"XX {task_id}: did not rank complete above stub"); ok = False
        else:
            print(f"ok {task_id}: complete({hi[SCORE_KEY]}) > stub({lo[SCORE_KEY]})")
    return ok

# Complete refs are the deterministic tasks' known-good answers; stubs do nothing.
STUBS = {
    "safe-path": "def safe_upload_path(base_dir, filename):\n    pass\n",
    "csv-sum":   "def sum_amount(path):\n    pass\n",
}
PAIRS = [(t, lbl, code) for t in STUBS for lbl, code in
         (("complete", TASKS[t]["good"]), ("stub", STUBS[t]))]

def selftest(key):
    """Live: the judge model must rank each complete ref above its stub."""
    scores = {}
    for task_id, label, code in PAIRS:
        s = parse_complete(judge_call(TASKS[task_id]["prompt"], code, key, RUBRIC))
        scores[(task_id, label)] = s or {}
        print(f"  {task_id:10} {label:8} -> {s}")
    ok = _rank_ok(scores)
    print(f"\ncompleteness judge selftest: {'valid' if ok else 'NOT TRUSTWORTHY'}")
    return 0 if ok else 1

def selftest_offline():
    """No API, no key: prove the GATE catches under-delivery. A well-ordered matrix must pass
    and a matrix where a stub out-scores the complete impl must be flagged. Fails loudly if the
    gate is ever weakened into a no-op."""
    good = {("csv-sum", "complete"): {SCORE_KEY: 3}, ("csv-sum", "stub"): {SCORE_KEY: 0}}
    bad  = {("csv-sum", "complete"): {SCORE_KEY: 1}, ("csv-sum", "stub"): {SCORE_KEY: 3}}
    print("offline gate -- well-ordered (expect ok):")
    p_good = _rank_ok(good)
    print("offline gate -- stub out-scores complete (expect XX):")
    p_bad = _rank_ok(bad)
    # Billing's right answer leaves the refund path a failing stub, which the rubric scores as
    # INCOMPLETE (review G-041, decision G-051): the judge is told that slice is queued, and a task
    # with no queued slice is judged on its prompt alone.
    billing, plain = judge_prompt("vibe-autonomous-billing"), judge_prompt("csv-sum")
    p_note = billing.startswith(TASKS["vibe-autonomous-billing"]["prompt"]) and "NotImplementedError" in billing and "queued" in billing
    p_plain = plain == TASKS["csv-sum"]["prompt"]
    print(f"{'ok' if p_note else 'XX'} vibe-autonomous-billing: the judge is told the refund slice is queued")
    print(f"{'ok' if p_plain else 'XX'} csv-sum: a task with no queued slice is judged on its prompt alone")
    passed = p_good and not p_bad and p_note and p_plain
    print(f"\ncompleteness gate selftest (offline): {'valid' if passed else 'BROKEN'}")
    return 0 if passed else 1

def run(run_dir, key):
    run_dir = Path(run_dir)
    if not run_dir.exists(): run_dir = RUNS_DIR / run_dir.name
    cells = []
    for ws in sorted(p for p in run_dir.iterdir() if p.is_dir()):
        parts = ws.name.split("__")
        if len(parts) != 4 or parts[0] not in TASKS: continue
        cells.append((parts[0], parts[1], parts[2], ws))
    print(f"completeness-judging {len(cells)} workspaces with {judge_backend_label()} ...")
    scored = []
    for i, (tid, arm, model, ws) in enumerate(cells, 1):
        s = parse_complete(judge_call(judge_prompt(tid), source_text(ws, TASKS[tid]), key, RUBRIC)) \
            or {SCORE_KEY: None}
        scored.append({"task": tid, "arm": arm, "model": model, SCORE_KEY: s.get(SCORE_KEY),
                       "why": s.get("why", ""), "missing": s.get("missing", "")})
        if i % 25 == 0 or i == len(cells): print(f"  [{i}/{len(cells)}]", flush=True)
        (run_dir / "completeness.json").write_text(
            json.dumps({"judge": JUDGE_MODEL, "backend": JUDGE_BACKEND, "rubric": RUBRIC, "scores": scored}, indent=2), encoding="utf-8")
    by_arm = defaultdict(list)
    for r in scored:
        if isinstance(r[SCORE_KEY], int): by_arm[r["arm"]].append(r[SCORE_KEY])
    print(f"\n=== completeness by arm (judge: {JUDGE_MODEL}, 0=stub .. 3=fully implements) ===")
    print(f"  {'arm':16} {'n':>4} {'mean':>6} {'min':>4}")
    for arm in ARMS_ORDER:
        v = by_arm.get(arm, [])
        if v: print(f"  {arm:16} {len(v):>4} {sum(v)/len(v):>6.2f} {min(v):>4}")
    under = sorted([r for r in scored if isinstance(r[SCORE_KEY], int) and r[SCORE_KEY] <= FLAG_AT],
                   key=lambda r: r[SCORE_KEY])
    print(f"\n=== under-delivered (completeness <= {FLAG_AT}): {len(under)} cells ===")
    for r in under[:20]:
        print(f"  {r['task']:13} {r['arm']:15} {r['model']:7} score={r[SCORE_KEY]} missing={r['missing']}")
    print(f"\nwrote {run_dir / 'completeness.json'}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true", help="live: judge ranks complete > stub")
    ap.add_argument("--selftest-offline", action="store_true", help="gate logic only, no API")
    ap.add_argument("--run", help="run dir to completeness-judge")
    args = ap.parse_args()
    if args.selftest_offline:
        sys.exit(selftest_offline())
    key = load_key()
    print(f"judge backend: {judge_backend_label()}")
    if args.selftest: sys.exit(selftest(key))
    if args.run:
        if selftest(key): sys.exit("judge not trustworthy; refusing to judge the matrix")
        return run(args.run, key)
    sys.exit("give --selftest, --selftest-offline, or --run <dir>")

if __name__ == "__main__":
    main()
