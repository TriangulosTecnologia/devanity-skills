#!/usr/bin/env python3
"""Generate the harness-local devanity plugins (evals/harness/plugins/, gitignored).

  python3 evals/harness/build_plugins.py             # devanity-released from RELEASED_REF, devanity from the working tree
  DEVANITY_RELEASED_REF=v0.5.0 python3 evals/harness/build_plugins.py

`devanity-released` is what users had before v1: the skills/ and agents/ of the released ref (default
RELEASED_REF, the pre-v1 `main`), exported with `git archive` so a moved or edited working tree can never leak into the
regression reference. `devanity` is the candidate: the working tree's plugin/, the installable unit
the marketplace ships, copied whole, so the arm measures exactly what a user installs. Layout follows
Claude Code's plugin contract: .claude-plugin/plugin.json at the root, skills/<name>/SKILL.md with its
reference/ and modes/, and agents/*.md so the worker/verifier subagents the skills delegate to exist.

`devanity-v0` is the control (PLAN F1.1; decision G-035, 2026-09-25): a control isolates one
variable, so v0 is LOADED the way the candidate's kernel is. It carries the candidate's SessionStart
inject entry (same event and matcher, the same plugin/hooks/devanity-runtime.js) pointed at its own text,
and the same agents. What differs from the candidate, all of it named here:
  - the text: arms/devanity-v0/SKILL.md instead of plugin/skills/devanity (+ its reference/ and modes/);
  - the hooks v0 does not have: SubagentStart (kernel for subagents), UserPromptSubmit (the mode
    and on/off state), PreToolUse (the guard), Stop (the proof oracle); and, inside the inject
    itself, the repository-rules and open-change (ledger) sections and the autonomous-session line.
run.py --selftest (_selftest_control_arm) asserts v0 has exactly that one hook and injects exactly its text.
"""
import io, json, os, re, shutil, subprocess, sys, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIT = ROOT / "plugin"                                   # the installable unit (marketplace source)
PLUGINS = Path(__file__).resolve().parent / "plugins"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")

def _frontmatter_version(skill_md: Path):
    """The skill's frontmatter version; 0.0.0 when absent so the manifest stays valid."""
    try:
        m = re.search(r"^\s*version:\s*['\"]?([0-9][^'\"\s]*)", skill_md.read_text(encoding="utf-8").split("---", 2)[1], re.M)
        return m.group(1) if m else "0.0.0"
    except Exception:
        return "0.0.0"

def _manifest(out: Path, name: str, version: str, description: str):
    (out / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    (out / ".claude-plugin" / "plugin.json").write_text(
        json.dumps({"name": name, "version": version, "description": description}, indent=2) + "\n", encoding="utf-8")

RELEASED_REF = "890cb4824860e3eb446c9d44d9516749b12cfc15"   # main as released before the v1 merge (see main())


def build_released(ref: str):
    """Export skills/ and agents/ of `ref` with git archive: the released tree, never the working tree."""
    out = PLUGINS / "devanity-released"
    if out.exists(): shutil.rmtree(out)
    r = subprocess.run(["git", "-C", str(ROOT), "archive", "--format=tar", ref, "skills", "agents"], capture_output=True)
    if r.returncode != 0:
        sys.exit(f"git archive {ref} failed: {r.stderr.decode(errors='ignore').strip()} (set DEVANITY_RELEASED_REF to a ref that has skills/ and agents/)")
    out.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(r.stdout)) as tar:
        tar.extractall(out, filter="data")
    skills = sorted(p.parent.name for p in (out / "skills").glob("*/SKILL.md"))
    if not skills: sys.exit(f"{ref} has no skills/*/SKILL.md")
    entry = out / "skills" / ("maestro" if "maestro" in skills else skills[0]) / "SKILL.md"
    _manifest(out, "devanity-released", _frontmatter_version(entry), f"Devanity as released at {ref}, packaged for the harness")
    return out, skills

def build_candidate():
    """The working tree's plugin/, copied whole: what the marketplace installs is what the arm runs."""
    if not (UNIT / "skills" / "devanity" / "SKILL.md").exists(): return None, []
    out = PLUGINS / "devanity"
    if out.exists(): shutil.rmtree(out)
    shutil.copytree(UNIT, out, ignore=IGNORE)
    return out, ["devanity"]

def build_control(out=None):
    """devanity-v0 (PLAN F1.1): the harness-only control kernel in arms/devanity-v0, packaged as a
    plugin with the same agents, so the only difference from the candidate is the kernel text."""
    src = Path(__file__).resolve().parent / "arms" / "devanity-v0"
    out = Path(out) if out else PLUGINS / "devanity-v0"
    if out.exists(): shutil.rmtree(out)
    shutil.copytree(src, out / "skills" / "devanity-v0", ignore=IGNORE)
    shutil.copytree(UNIT / "agents", out / "agents", ignore=IGNORE)
    _manifest(out, "devanity-v0", "0.0.0", "Devanity v0 control arm (craft ladder only), harness-only, never released")
    # The candidate's SessionStart entry, verbatim but for the script it runs (G-035).
    entry = json.loads((UNIT / "hooks" / "hooks.json").read_text(encoding="utf-8"))["hooks"]["SessionStart"]
    entry = json.loads(json.dumps(entry).replace("devanity-inject.js", "devanity-v0-inject.js"))
    (out / "hooks").mkdir()
    shutil.copy(UNIT / "hooks" / "devanity-runtime.js", out / "hooks" / "devanity-runtime.js")
    (out / "hooks" / "devanity-v0-inject.js").write_text(V0_INJECT, encoding="utf-8")
    (out / "hooks" / "hooks.json").write_text(json.dumps({"hooks": {"SessionStart": entry}}, indent=2) + "\n", encoding="utf-8")
    manifest = out / ".claude-plugin" / "plugin.json"
    manifest.write_text(json.dumps({**json.loads(manifest.read_text(encoding="utf-8")), "hooks": "./hooks/hooks.json"}, indent=2) + "\n", encoding="utf-8")
    return out

# The candidate's injection path (devanity-runtime.js: stdin, frontmatter strip, SessionStart
# output) with its own text and nothing else: no rules, no ledger, no autonomy line, no subagents.
V0_INJECT = """#!/usr/bin/env node
'use strict';
// devanity-v0 control (harness-only, generated by evals/harness/build_plugins.py): SessionStart injects this arm's text.
const fs = require('fs'), path = require('path'), rt = require('./devanity-runtime');
rt.readStdinJson(() => {
  let text = '';
  try { text = rt.stripFrontmatter(fs.readFileSync(path.join(rt.pluginRoot(), 'skills', 'devanity-v0', 'SKILL.md'), 'utf8')).trimEnd(); } catch (e) { text = ''; }
  rt.emit('SessionStart', text);
});
"""

# Experiment arms (PLAN V5 agenda, 2026-09-28): the candidate, copied whole, plus exactly one declared
# difference, so a delta against `devanity` has one cause. A sentence earns the kernel only by moving
# a number (SPEC guardrail 1); these arms are where it is measured first.
#   devanity-examples: one kernel sentence, plain-language acceptance examples for vibe coding
#     (read on vibe-app-cli, vibe-app-web, vibe-autonomous-billing: complete, has_check).
#   devanity-nudge: arms/devanity-nudge.js behind one PostToolUse and one more Stop entry, one-line
#     reminders at the trigger (read on judge-loosen, judge-falsetest, core-pivot, authority-ship;
#     the cell's `nudges` says whether a trigger fired at all).
# run.py --selftest (_selftest_experiment_arms) asserts each arm is the candidate plus that difference.
EXAMPLES_ANCHOR = "3. **Changes behavior?** → one check that **fails first**, then the fix. Not the other way round.\n"
EXAMPLES_SENTENCE = ("   Greenfield, or a request with no acceptance criteria → before code, write 3–5 acceptance examples in plain "
                     "language (`given … → expect …`), show them, and make each one a check.\n")
_NUDGE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/devanity-nudge.js"'
_NUDGE_ENTRY = {"hooks": [{"type": "command", "command": _NUDGE_CMD, "timeout": 5}]}
EXPERIMENTS = {
    "devanity-examples": {"kernel": (EXAMPLES_ANCHOR, EXAMPLES_SENTENCE),
                          "description": "Devanity candidate plus one kernel sentence (acceptance examples), harness-only"},
    "devanity-nudge": {"files": {"hooks/devanity-nudge.js": "arms/devanity-nudge.js"},
                       "hooks": {"PostToolUse": {"matcher": "Edit|Write|MultiEdit|NotebookEdit", **_NUDGE_ENTRY}, "Stop": _NUDGE_ENTRY},
                       "description": "Devanity candidate plus one-line reminders at the trigger, harness-only"},
}

def build_experiment(name, out=None):
    """One experiment arm: the working tree's plugin/ plus EXPERIMENTS[name], nothing else."""
    spec = EXPERIMENTS[name]
    out = Path(out) if out else PLUGINS / name
    if out.exists(): shutil.rmtree(out)
    shutil.copytree(UNIT, out, ignore=IGNORE)
    if "kernel" in spec:
        anchor, sentence = spec["kernel"]
        skill = out / "skills" / "devanity" / "SKILL.md"
        text = skill.read_text(encoding="utf-8")
        if text.count(anchor) != 1: sys.exit(f"{name}: the kernel anchor is not in plugin/skills/devanity/SKILL.md exactly once; re-anchor EXPERIMENTS")
        skill.write_text(text.replace(anchor, anchor + sentence), encoding="utf-8")
    for dest, src in spec.get("files", {}).items():
        shutil.copy(Path(__file__).resolve().parent / src, out / dest)
    if spec.get("hooks"):
        hooks_file = out / "hooks" / "hooks.json"
        hooks = json.loads(hooks_file.read_text(encoding="utf-8"))
        for event, entry in spec["hooks"].items(): hooks["hooks"].setdefault(event, []).append(entry)
        hooks_file.write_text(json.dumps(hooks, indent=2) + "\n", encoding="utf-8")
    manifest = out / ".claude-plugin" / "plugin.json"
    manifest.write_text(json.dumps({**json.loads(manifest.read_text(encoding="utf-8")), "name": name,
                                    "description": spec["description"]}, indent=2) + "\n", encoding="utf-8")
    return out

def main():
    # The released baseline is pinned: once the v1 PR merges, `main` is the candidate itself, and an
    # arm built from it would measure devanity against devanity. 890cb48 is main before that merge
    # (skills maestro, archer, guardian). Override with DEVANITY_RELEASED_REF for another release.
    ref = os.environ.get("DEVANITY_RELEASED_REF", RELEASED_REF)
    out, skills = build_released(ref)
    print(f"built {out} from {ref} ({sum(1 for p in out.rglob('*') if p.is_file())} files: skills {', '.join(skills)})")
    out = build_control()
    print(f"built {out} from arms/devanity-v0 ({sum(1 for p in out.rglob('*') if p.is_file())} files)")
    out, skills = build_candidate()
    if out: print(f"built {out} from the working tree ({sum(1 for p in out.rglob('*') if p.is_file())} files)")
    else: print("candidate: skills/devanity/SKILL.md not present, nothing built"); return
    for name in EXPERIMENTS:
        print(f"built {build_experiment(name)} (the candidate plus the {name} difference)")

if __name__ == "__main__":
    main()
