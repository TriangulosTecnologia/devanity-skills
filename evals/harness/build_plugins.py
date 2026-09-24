#!/usr/bin/env python3
"""Generate the harness-local devanity plugins (evals/harness/plugins/, gitignored).

  python3 evals/harness/build_plugins.py             # devanity-released from `main`, devanity from the working tree
  DEVANITY_RELEASED_REF=v0.5.0 python3 evals/harness/build_plugins.py

`devanity-released` is what users have today: the skills/ and agents/ of the released ref (default
`main`), exported with `git archive` so a moved or edited working tree can never leak into the
regression reference. `devanity` is the candidate: the working tree's skills/devanity + agents/ (+
hooks/ and .claude-plugin/ once phase 1 ships them). Layout follows Claude Code's plugin contract:
.claude-plugin/plugin.json at the root, skills/<name>/SKILL.md with its reference/ and modes/, and
agents/*.md so the worker/verifier subagents the skills delegate to exist in the cell.
"""
import io, json, os, re, shutil, subprocess, sys, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
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
    """The working tree's skills/devanity (+ hooks/, .claude-plugin/ when present) and agents/."""
    src = ROOT / "skills" / "devanity"
    if not (src / "SKILL.md").exists(): return None, []
    out = PLUGINS / "devanity"
    if out.exists(): shutil.rmtree(out)
    shutil.copytree(src, out / "skills" / "devanity", ignore=IGNORE)
    shutil.copytree(ROOT / "agents", out / "agents", ignore=IGNORE)
    for extra in ("hooks",):
        if (ROOT / extra).exists(): shutil.copytree(ROOT / extra, out / extra, ignore=IGNORE)
    manifest = ROOT / ".claude-plugin" / "plugin.json"
    if manifest.exists():                                   # phase 1 ships the real manifest; reuse it
        (out / ".claude-plugin").mkdir(parents=True, exist_ok=True)
        shutil.copy(manifest, out / ".claude-plugin" / "plugin.json")
    else:
        _manifest(out, "devanity", _frontmatter_version(src / "SKILL.md"), "Devanity candidate (working tree), packaged for the harness")
    return out, ["devanity"]

def build_control():
    """devanity-v0 (PLAN F1.1): the harness-only control kernel in arms/devanity-v0, packaged as a
    plugin with the same agents, so the only difference from the candidate is the kernel text."""
    src = Path(__file__).resolve().parent / "arms" / "devanity-v0"
    out = PLUGINS / "devanity-v0"
    if out.exists(): shutil.rmtree(out)
    shutil.copytree(src, out / "skills" / "devanity-v0", ignore=IGNORE)
    shutil.copytree(ROOT / "agents", out / "agents", ignore=IGNORE)
    _manifest(out, "devanity-v0", "0.0.0", "Devanity v0 control arm (craft ladder only), harness-only, never released")
    return out

def main():
    ref = os.environ.get("DEVANITY_RELEASED_REF", "main")
    out, skills = build_released(ref)
    print(f"built {out} from {ref} ({sum(1 for p in out.rglob('*') if p.is_file())} files: skills {', '.join(skills)})")
    out = build_control()
    print(f"built {out} from arms/devanity-v0 ({sum(1 for p in out.rglob('*') if p.is_file())} files)")
    out, skills = build_candidate()
    if out: print(f"built {out} from the working tree ({sum(1 for p in out.rglob('*') if p.is_file())} files)")
    else: print("candidate: skills/devanity/SKILL.md not present, nothing built")

if __name__ == "__main__":
    main()
