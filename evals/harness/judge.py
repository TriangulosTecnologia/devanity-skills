#!/usr/bin/env python3
# Ported from ponytail (https://github.com/DietrichGebert/ponytail), benchmarks/agentic/judge.py,
# commit e3ba2aa (2026-09-14). Copyright (c) 2026 DietrichGebert. MIT License; see LICENSE-ponytail
# in this directory. Modified for devanity-skills: arms, environment names, tiers, and attribution.
"""LLM-judge over-engineering pass for the agentic benchmark.

Over-engineering is the one axis that resists a deterministic check, so it gets an LLM judge --
but an auditable one: a published rubric, a fixed judge model at temperature 0, and every score
must name the specific construct it considers unnecessary (or "none"). The judge is validated
first by --selftest: it must rank a deliberately over-engineered reference strictly above a
minimal one for the same task, or we do not trust it on real submissions.

  python judge.py --selftest                 # validate the judge on reference pairs (small spend)
  python judge.py --run runs/<stamp>          # judge every workspace's source in a matrix run

Judge: claude-sonnet-4-6 via the Anthropic Messages API (key from ../../.env), or, without a key,
via `claude -p` (subscription; no temperature control, see JUDGE_BACKEND). Scores the SOURCE
files only (tests excluded -- a test is not over-engineering). Cost is ~$0.003/cell.

stdlib urllib for the API call, no requests dependency.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request
from collections import defaultdict
from pathlib import Path

from tasks import TASKS, source_text      # source_text: what the judges read (complete.py imports it from here)
import run as _run                      # RUNS_DIR (DEVANITY_HARNESS_RUNS_DIR) and memory_guard

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

RUBRIC = (
    "You are a senior engineer reviewing a code submission for OVER-ENGINEERING ONLY. "
    "Ignore correctness, style, performance, and security. Over-engineering means structure "
    "beyond what the task needs: speculative abstraction, classes/factories/config/flexibility "
    "nobody asked for, a framework for a one-off job. Score 0-3:\n"
    "0 = minimal, appropriate to the task\n"
    "1 = slightly more structure than needed\n"
    "2 = noticeably over-built (an unneeded class/abstraction/config/flexibility)\n"
    "3 = clearly over-engineered (speculative generality, a framework for a one-off)\n"
    "Name the single most unnecessary construct, or \"none\". "
    "Respond with ONLY this JSON: {\"over_engineering\": <0-3 int>, \"why\": \"<one line>\", \"cite\": \"<construct or none>\"}"
)

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

def judge_call(task_prompt, files, key, retries=3, system=RUBRIC):
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
        if "over_engineering" in d: d["over_engineering"] = int(d["over_engineering"])
        return d
    except Exception:
        return None

# --- selftest: the judge must rank over-engineered above minimal for the same task ---
CACHE_OVER = (
    "import time\nfrom collections import OrderedDict\n"
    "class CacheEntry:\n    def __init__(self, value, created_at):\n        self.value = value\n        self.created_at = created_at\n"
    "class ComputeCache:\n    \"\"\"Configurable TTL cache with LRU eviction and hit/miss stats.\"\"\"\n"
    "    def __init__(self, max_size=128, ttl_seconds=3600, enable_stats=True):\n"
    "        self.max_size = max_size; self.ttl_seconds = ttl_seconds; self.enable_stats = enable_stats\n"
    "        self._store = OrderedDict(); self._hits = 0; self._misses = 0\n"
    "    def _evict(self):\n        while len(self._store) > self.max_size: self._store.popitem(last=False)\n"
    "    def get_or_compute(self, n, fn):\n        now = time.time()\n"
    "        if n in self._store and now - self._store[n].created_at < self.ttl_seconds:\n"
    "            self._hits += 1; self._store.move_to_end(n); return self._store[n].value\n"
    "        self._misses += 1; v = fn(n); self._store[n] = CacheEntry(v, now); self._evict(); return v\n"
    "_cache = ComputeCache()\n"
    "def compute(n):\n    return _cache.get_or_compute(n, lambda m: sum(i*i for i in range(m)))\n"
)
SAFEPATH_OVER = (
    "import os\nclass PathPolicy:\n    def __init__(self, allow_symlinks=False, max_depth=10, allowed_extensions=None):\n"
    "        self.allow_symlinks = allow_symlinks; self.max_depth = max_depth\n        self.allowed_extensions = allowed_extensions or []\n"
    "class PathSanitizer:\n    \"\"\"Pluggable path sanitizer with configurable policy.\"\"\"\n    def __init__(self, policy=None):\n        self.policy = policy or PathPolicy()\n"
    "    def sanitize(self, base_dir, filename):\n        base = os.path.abspath(base_dir)\n        target = os.path.abspath(os.path.join(base, filename))\n"
    "        if os.path.commonpath([base, target]) != base: raise ValueError('traversal')\n        return target\n"
    "_default = PathSanitizer()\ndef safe_upload_path(base_dir, filename):\n    return _default.sanitize(base_dir, filename)\n"
)
SELFTEST_PAIRS = [
    ("cache", "minimal", TASKS["cache"]["good"]),
    ("cache", "over", CACHE_OVER),
    ("safe-path", "minimal", TASKS["safe-path"]["good"]),
    ("safe-path", "over", SAFEPATH_OVER),
]

def selftest(key):
    scores = {}
    for task_id, label, code in SELFTEST_PAIRS:
        s = parse_score(judge_call(TASKS[task_id]["prompt"], code, key))
        scores[(task_id, label)] = s
        print(f"  {task_id:10} {label:8} -> {s}")
    ok = True
    for task_id in ("cache", "safe-path"):
        lo = scores.get((task_id, "minimal"), {}) or {}
        hi = scores.get((task_id, "over"), {}) or {}
        if not (isinstance(hi.get("over_engineering"), int) and isinstance(lo.get("over_engineering"), int)
                and hi["over_engineering"] > lo["over_engineering"]):
            print(f"XX {task_id}: judge did not rank over-engineered above minimal")
            ok = False
        else:
            print(f"ok {task_id}: over({hi['over_engineering']}) > minimal({lo['over_engineering']})")
    print(f"\njudge selftest: {'valid' if ok else 'NOT TRUSTWORTHY'}")
    return 0 if ok else 1

def run(run_dir, key):
    run_dir = Path(run_dir)
    if not run_dir.exists(): run_dir = RUNS_DIR / run_dir.name
    cells, scored = [], []
    for ws in sorted(p for p in run_dir.iterdir() if p.is_dir()):
        parts = ws.name.split("__")
        if len(parts) != 4 or parts[0] not in TASKS: continue
        cells.append((parts[0], parts[1], parts[2], ws))
    print(f"judging {len(cells)} workspaces with {judge_backend_label()} ...")
    for i, (tid, arm, model, ws) in enumerate(cells, 1):
        s = parse_score(judge_call(TASKS[tid]["prompt"], source_text(ws, TASKS[tid]), key)) or {"over_engineering": None}
        rec = {"task": tid, "arm": arm, "model": model, "over_engineering": s.get("over_engineering"),
               "why": s.get("why", ""), "cite": s.get("cite", "")}
        scored.append(rec)
        if i % 25 == 0 or i == len(cells): print(f"  [{i}/{len(cells)}]", flush=True)
        (run_dir / "judge.json").write_text(json.dumps({"judge": JUDGE_MODEL, "backend": JUDGE_BACKEND, "rubric": RUBRIC, "scores": scored}, indent=2), encoding="utf-8")
    # aggregate
    by_arm = defaultdict(list)
    for r in scored:
        if isinstance(r["over_engineering"], int): by_arm[r["arm"]].append(r["over_engineering"])
    print(f"\n=== over-engineering by arm (judge: {JUDGE_MODEL}, 0=minimal .. 3=over-built) ===")
    print(f"  {'arm':16} {'n':>4} {'mean':>6} {'max':>4}")
    for arm in ARMS_ORDER:
        v = by_arm.get(arm, [])
        if v: print(f"  {arm:16} {len(v):>4} {sum(v)/len(v):>6.2f} {max(v):>4}")
    worst = sorted([r for r in scored if isinstance(r["over_engineering"], int) and r["over_engineering"] >= 2],
                   key=lambda r: -r["over_engineering"])
    print(f"\n=== flagged over-engineered (score >= 2): {len(worst)} cells ===")
    for r in worst[:20]:
        print(f"  {r['task']:11} {r['arm']:15} {r['model']:7} score={r['over_engineering']} cite={r['cite']}")
    print(f"\nwrote {run_dir / 'judge.json'}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--run", help="run dir to judge")
    args = ap.parse_args()
    key = load_key()
    print(f"judge backend: {judge_backend_label()}")
    if args.selftest: sys.exit(selftest(key))
    if args.run:
        if selftest(key): sys.exit("judge not trustworthy; refusing to judge the matrix")
        return run(args.run, key)
    sys.exit("give --selftest or --run <dir>")

if __name__ == "__main__":
    main()
