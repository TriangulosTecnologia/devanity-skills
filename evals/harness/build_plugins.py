#!/usr/bin/env python3
"""Generate the harness-local `devanity-current` plugin (evals/harness/plugins/devanity-current/,
gitignored) from the repo's committed skills/ and agents/.

  python3 evals/harness/build_plugins.py

The `devanity-current` arm must measure the skills as committed, never a stale personal install, so
the plugin is rebuilt from source on demand rather than resolved from ~/.claude/plugins. Layout
follows Claude Code's plugin contract: .claude-plugin/plugin.json at the root, skills/<name>/SKILL.md
(with each skill's reference/ and modes/ files, which the SKILL.md links to) and agents/*.md, so the
worker/verifier subagents the skills delegate to are available in the cell.
"""
import json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "plugins" / "devanity-current"
SKILLS = ("archer", "guardian", "maestro")

def _version():
    """Plugin version = maestro's frontmatter version (the entry point a user invokes); 0.0.0 if the
    frontmatter has none, so the manifest is always valid."""
    m = re.search(r"^\s+version:\s*['\"]?([0-9][^'\"\s]*)", (ROOT / "skills" / "maestro" / "SKILL.md")
                  .read_text(encoding="utf-8").split("---", 2)[1], re.M)
    return m.group(1) if m else "0.0.0"

def build():
    missing = [s for s in SKILLS if not (ROOT / "skills" / s / "SKILL.md").exists()]
    if missing: sys.exit(f"skills missing under {ROOT / 'skills'}: {missing}")
    if OUT.exists(): shutil.rmtree(OUT)           # rebuild from scratch: no leftovers from a previous layout
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
    for s in SKILLS:
        shutil.copytree(ROOT / "skills" / s, OUT / "skills" / s, ignore=ignore)
    shutil.copytree(ROOT / "agents", OUT / "agents", ignore=ignore)
    (OUT / ".claude-plugin").mkdir(parents=True)
    manifest = {"name": "devanity-current", "version": _version(),
                "description": "Devanity current capabilities, packaged for the harness"}
    (OUT / ".claude-plugin" / "plugin.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    n = sum(1 for p in OUT.rglob("*") if p.is_file())
    print(f"built {OUT} (v{manifest['version']}, {n} files: skills {', '.join(SKILLS)}; agents "
          f"{', '.join(sorted(p.stem for p in (OUT / 'agents').glob('*.md')))})")

if __name__ == "__main__":
    build()
