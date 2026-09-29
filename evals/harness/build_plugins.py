#!/usr/bin/env python3
"""Generate the harness-local plugins (evals/harness/plugins/, gitignored).

  python3 evals/harness/build_plugins.py           # devanity from the working tree
  python3 evals/harness/build_plugins.py --fetch   # also the competitors at their pins

`devanity` is the candidate: the working tree's plugin/, the installable unit the marketplace ships,
copied whole, so the arm measures exactly what a user installs. Layout follows Claude Code's plugin
contract: .claude-plugin/plugin.json at the root, skills/<name>/SKILL.md with its reference/ and
modes/, and agents/*.md so the worker/verifier subagents the skills delegate to exist.
"""
import shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIT = ROOT / "plugin"                                   # the installable unit (marketplace source)
PLUGINS = Path(__file__).resolve().parent / "plugins"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")

# The competitor plugins at pinned commits. ponytail at the commit its vendored benchmark comes from
# (evals/vendor/MANIFEST.json); superpowers at the commit the official marketplace pins
# (claude-plugins-official@fbe07fb6).
COMPETITORS = {
    "ponytail":    ("https://github.com/DietrichGebert/ponytail", "e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156"),
    "superpowers": ("https://github.com/obra/superpowers", "5bf4e78011075bcfc0dc295f0724994cd123ee71"),
}

def build_candidate():
    """The working tree's plugin/, copied whole: what the marketplace installs is what the arm runs."""
    if not (UNIT / "skills" / "devanity" / "SKILL.md").exists():
        sys.exit("plugin/skills/devanity/SKILL.md not present, nothing built")
    out = PLUGINS / "devanity"
    if out.exists(): shutil.rmtree(out)
    shutil.copytree(UNIT, out, ignore=IGNORE)
    return out

def _git(*args, cwd=None):
    subprocess.run(["git", *args], cwd=cwd, check=True, stdout=subprocess.DEVNULL)

def fetch_competitors():
    """Each competitor plugin as a plain tree at its pin under plugins/<name>, where run.py resolves it."""
    for name, (url, sha) in COMPETITORS.items():
        repo = PLUGINS / "_src" / name
        if not (repo / ".git").is_dir():
            repo.mkdir(parents=True, exist_ok=True)
            _git("init", "-q", cwd=repo); _git("remote", "add", "origin", url, cwd=repo)
        if subprocess.run(["git", "cat-file", "-e", f"{sha}^{{commit}}"], cwd=repo, capture_output=True).returncode:
            _git("fetch", "-q", "--filter=blob:none", "origin", cwd=repo)
        out = PLUGINS / name
        if out.exists(): shutil.rmtree(out)
        out.mkdir(parents=True)
        tar = subprocess.run(["git", "archive", sha], cwd=repo, check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", str(out)], input=tar, check=True)
        if not (out / ".claude-plugin" / "plugin.json").is_file(): sys.exit(f"{name}@{sha[:7]}: no .claude-plugin/plugin.json")
        print(f"built {out} from {name}@{sha[:7]}")

def main():
    out = build_candidate()
    print(f"built {out} from the working tree ({sum(1 for p in out.rglob('*') if p.is_file())} files)")
    if "--fetch" in sys.argv[1:]: fetch_competitors()

if __name__ == "__main__":
    main()
