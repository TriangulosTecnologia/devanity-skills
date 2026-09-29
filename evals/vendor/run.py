#!/usr/bin/env python3
"""Run a vendored eval suite as its authors run it, with `devanity` as one more arm (evals/vendor/README.md).

  python3 evals/vendor/run.py plugins                  # the competitor plugins at their pins -> evals/harness/plugins/
  ./container.sh python3 ../vendor/run.py <suite> [-- <the suite's own arguments>]
  python3 evals/vendor/run.py --list

The vendored trees (evals/vendor/<name>/, byte-identical: MANIFEST.json) are never edited and never
run in place: each run copies the tree to $DEVANITY_HARNESS_RUNS_DIR/vendor/<suite>-<stamp>/, which has
no CLAUDE.md or AGENTS.md above it, adds only the devanity arm there, and runs the authors' command
unchanged. Their outputs (runs/, results/, snapshots) land in that copy. Every suite runs in the
harness container: most of them execute the code the model wrote.

How the devanity arm is added, per shape of harness:
  - a harness that loads plugins (ponytail agentic): devanity joins ARMS and PLUGIN_ARMS in the imported
    module, the way ponytail and caveman are declared there, and runs from plugin/ as users install it;
  - a harness with a list of text arms (promptfoo configs, caveman evals/): one more entry, the devanity
    kernel as a file next to theirs;
  - a script with one fixed skill path (robustness-audit.js, claude-email.js, model-email.js, caveman
    benchmarks/run.py): the script runs twice, once as shipped and once with the devanity kernel at that
    path in its own copy. The skill arm of the second run is devanity; the rest of the run is identical.
"""
import argparse, datetime, json, os, shutil, subprocess, sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parent
ROOT = VENDOR.parents[1]
HARNESS = ROOT / "evals" / "harness"
PLUGINS = HARNESS / "plugins"                       # gitignored; the harness resolves arms here too
KERNEL = ROOT / "plugin" / "skills" / "devanity" / "SKILL.md"

# Competitor plugins at pinned commits: the arms both harnesses load. superpowers, feature-dev and
# security-guidance at the commits the official marketplace pins (claude-plugins-official@fbe07fb6).
COMPETITORS = {
    "ponytail":          ("https://github.com/DietrichGebert/ponytail", "e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156", ""),
    "caveman":           ("https://github.com/JuliusBrussee/caveman", "2fd153c67988e980fb0b2455c90832159a6a5a25", ""),
    "superpowers":       ("https://github.com/obra/superpowers", "5bf4e78011075bcfc0dc295f0724994cd123ee71", ""),
    "feature-dev":       ("https://github.com/anthropics/claude-plugins-official", "fbe07fb6ce7d51d8e86ca6efdf050059894cdb80", "plugins/feature-dev"),
    "security-guidance": ("https://github.com/anthropics/claude-plugins-official", "fbe07fb6ce7d51d8e86ca6efdf050059894cdb80", "plugins/security-guidance"),
}

def _git(*args, cwd=None):
    subprocess.run(["git", *args], cwd=cwd, check=True, stdout=subprocess.DEVNULL)

def fetch_plugins():
    """Each competitor plugin as a plain tree at its pin under evals/harness/plugins/<name>, where both
    harnesses resolve it (evals/harness/run.py _plugin_dir, and the env this script sets)."""
    work = PLUGINS / "_src"
    for name, (url, sha, sub) in COMPETITORS.items():
        repo = work / url.rsplit("/", 1)[1]
        if not (repo / ".git").is_dir():
            repo.mkdir(parents=True, exist_ok=True)
            _git("init", "-q", cwd=repo); _git("remote", "add", "origin", url, cwd=repo)
        if subprocess.run(["git", "cat-file", "-e", f"{sha}^{{commit}}"], cwd=repo, capture_output=True).returncode:
            _git("fetch", "-q", "--filter=blob:none", "origin", cwd=repo)
        out = PLUGINS / name
        if out.exists(): shutil.rmtree(out)
        out.mkdir(parents=True)
        tar = subprocess.run(["git", "archive", sha, *([sub] if sub else [])], cwd=repo, check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", str(out), *([f"--strip-components={sub.count('/') + 1}"] if sub else [])],
                       input=tar, check=True)
        if not (out / ".claude-plugin" / "plugin.json").is_file(): sys.exit(f"{name}@{sha[:7]}: no .claude-plugin/plugin.json")
        print(f"{name:18} {sha[:7]}  {out}")

def _plugin(name):
    p = PLUGINS / name
    if not (p / ".claude-plugin" / "plugin.json").is_file():
        hint = "python3 evals/harness/build_plugins.py" if name == "devanity" else "python3 evals/vendor/run.py plugins"
        sys.exit(f"plugin {name} not found at {p}: run `{hint}` first")
    return str(p)

# --- the devanity arm, per suite -------------------------------------------------------------------
def _put_kernel(copy, rel):
    """The devanity kernel as the file an arm reads, byte for byte (the arms read theirs whole)."""
    (copy / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(KERNEL, copy / rel)

def _promptfoo_arm(copy, config):
    """ponytail's arms/ponytail.js with the skill path swapped, and the config with one more prompt."""
    arms = copy / "benchmarks" / "arms"
    js = (arms / "ponytail.js").read_text(encoding="utf-8")
    if js.count("'skills', 'ponytail', 'SKILL.md'") != 1: sys.exit("arms/ponytail.js changed shape; re-derive the devanity arm")
    (arms / "devanity.js").write_text(js.replace("// Ponytail arm", "// Devanity arm (added by evals/vendor/run.py)")
                                        .replace("'skills', 'ponytail', 'SKILL.md'", "'skills', 'devanity', 'SKILL.md'"), encoding="utf-8")
    _put_kernel(copy, "skills/devanity/SKILL.md")
    text = (copy / "benchmarks" / config).read_text(encoding="utf-8")
    entry = "  - id: file://arms/ponytail.js\n    label: ponytail\n"
    if text.count(entry) != 1: sys.exit(f"{config} changed shape; re-derive the devanity arm")
    out = config.replace(".yaml", ".devanity.yaml")
    (copy / "benchmarks" / out).write_text(text.replace(entry, entry + "  - id: file://arms/devanity.js\n    label: devanity\n"), encoding="utf-8")
    return out

def _agentic(copy, args):
    env = {"PONYTAIL_PLUGIN_DIR": _plugin("ponytail"), "CAVEMAN_PLUGIN_DIR": _plugin("caveman"),
           "DEVANITY_PLUGIN_DIR": _plugin("devanity")}
    tmpl = HARNESS / "fixtures" / "full-stack-fastapi-template"
    if tmpl.is_dir(): env["PONYTAIL_TMPL"] = str(tmpl)
    return [(copy, [sys.executable, str(Path(__file__).resolve()), "_agentic-main", str(copy), *args])], env

def agentic_main(copy, args):
    """ponytail's agentic run.py, imported from the copy, with devanity declared the way it declares
    ponytail and caveman: an ARMS entry and a PLUGIN_ARMS member, loaded with --plugin-dir. Its selftest
    deletes PONYTAIL_PLUGIN_DIR after checking the override (run.py _selftest_plugin_dir), which would
    point the live ponytail arm at a plugin cache this container does not have; the value is put back."""
    sys.path.insert(0, str(copy / "benchmarks" / "agentic"))
    sys.argv = ["run.py", *args]
    import run as pt
    pt.ARMS["devanity"] = lambda: None
    pt.PLUGIN_ARMS = (*pt.PLUGIN_ARMS, "devanity")
    shipped = pt.selftest
    def selftest():
        saved = os.environ.get("PONYTAIL_PLUGIN_DIR")
        try: return shipped()
        finally:
            if saved is not None: os.environ["PONYTAIL_PLUGIN_DIR"] = saved
    pt.selftest = selftest
    pt.main()

def _promptfoo(config):
    def build(copy, args):
        # promptfoo exits 100 when a test fails, which here is the measurement, not a broken run
        return ([(copy, ["npx", "--yes", "promptfoo@latest", "eval", "-c", f"benchmarks/{_promptfoo_arm(copy, config)}", *args])],
                {"PROMPTFOO_FAILED_TEST_EXIT_CODE": "0"})
    return build

def _twice(script, skill_rel, runner):
    """Run as shipped, then with the devanity kernel at the script's one skill path (in its own copy)."""
    def build(copy, args):
        ours = copy.with_name(copy.name + "-devanity")
        shutil.copytree(copy, ours)
        _put_kernel(ours, skill_rel)
        return [(c, [*runner(c), script, *args]) for c in (copy, ours)], {}
    return build

def _venv(copy, *pkgs):
    subprocess.run([sys.executable, "-m", "venv", str(copy / ".venv")], check=True)
    subprocess.run([str(copy / ".venv" / "bin" / "pip"), "install", "-q", *pkgs], check=True)
    return str(copy / ".venv" / "bin" / "python")

def _caveman_evals(copy, args):
    _put_kernel(copy, "skills/devanity/SKILL.md")          # llm_run.py runs every skills/*/SKILL.md as an arm
    return [(copy, [sys.executable, "evals/llm_run.py", *args]), (copy, [_venv(copy, "tiktoken"), "evals/measure.py"])], {}

def _caveman_benchmarks(copy, args):
    build = _twice("benchmarks/run.py", "skills/caveman/SKILL.md", lambda c: [_venv(c, "anthropic>=0.40.0")])
    return build(copy, args)

# suite -> (vendored tree, what it needs besides the container, how to build its commands)
SUITES = {
    "ponytail-agentic":      ("ponytail", (), _agentic),
    "ponytail-promptfoo":    ("ponytail", ("ANTHROPIC_API_KEY",), _promptfoo("promptfooconfig.yaml")),
    "ponytail-behavior":     ("ponytail", ("ANTHROPIC_API_KEY",), _promptfoo("behavior.yaml")),
    "ponytail-robustness":   ("ponytail", ("OPENAI_API_KEY",), _twice("benchmarks/robustness-audit.js", "skills/ponytail/SKILL.md", lambda c: ["node"])),
    "ponytail-claude-email": ("ponytail", ("ANTHROPIC_API_KEY",), _twice("benchmarks/claude-email.js", "skills/ponytail/SKILL.md", lambda c: ["node"])),
    "ponytail-model-email":  ("ponytail", ("OPENAI_API_KEY",), _twice("benchmarks/model-email.js", "skills/ponytail/SKILL.md", lambda c: ["node"])),
    "caveman-evals":         ("caveman", (), _caveman_evals),
    "caveman-benchmarks":    ("caveman", ("ANTHROPIC_API_KEY",), _caveman_benchmarks),
}

def run_suite(suite, args):
    tree, needs, build = SUITES[suite]
    if os.environ.get("DEVANITY_HARNESS_CONTAINER") != "1":
        sys.exit(f"{suite} runs the model's code or a live CLI: run it in the harness container (./container.sh python3 ../vendor/run.py {suite})")
    missing = [k for k in needs if not os.environ.get(k)]
    if missing: sys.exit(f"{suite} calls the provider API directly and needs {', '.join(missing)} (an OAuth token does not work there)")
    sys.path.insert(0, str(HARNESS))
    from run import memory_guard                         # the harness's rule: no CLAUDE.md/AGENTS.md above a cell
    base = Path(os.environ.get("DEVANITY_HARNESS_RUNS_DIR", "")) if os.environ.get("DEVANITY_HARNESS_RUNS_DIR") else None
    if base is None: sys.exit("set DEVANITY_HARNESS_RUNS_DIR (container.sh mounts it at /runs)")
    memory_guard(base)
    copy = base / "vendor" / f"{suite}-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    shutil.copytree(VENDOR / tree, copy)
    cmds, env = build(copy, args)
    commit = json.loads((VENDOR / "MANIFEST.json").read_text(encoding="utf-8"))[tree]["commit"]
    (copy.parent / f"{copy.name}.json").write_text(json.dumps({"suite": suite, "tree": tree, "commit": commit,
                                                              "commands": [[str(c), cmd] for c, cmd in cmds]}, indent=2), encoding="utf-8")
    for cwd, cmd in cmds:
        print(f"\n$ ({cwd}) {' '.join(cmd)}", flush=True)
        r = subprocess.run(cmd, cwd=cwd, env={**os.environ, **env})
        if r.returncode: sys.exit(f"{suite}: exited {r.returncode}; the copy is kept at {cwd}")
    print(f"\n{suite}: outputs under {copy}")

def main():
    if sys.argv[1:2] == ["_agentic-main"]: return agentic_main(Path(sys.argv[2]), sys.argv[3:])
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("suite", nargs="?", help="plugins, or one of: " + ", ".join(SUITES))
    ap.add_argument("--list", action="store_true")
    ap.add_argument("rest", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    if a.list or not a.suite:
        for s, (tree, needs, _) in SUITES.items(): print(f"{s:22} {tree:9} needs: container{''.join(', ' + n for n in needs)}")
        return
    if a.suite == "plugins": return fetch_plugins()
    if a.suite not in SUITES: sys.exit(f"unknown suite {a.suite}; --list shows them")
    run_suite(a.suite, [x for x in a.rest if x != "--"])

if __name__ == "__main__":
    main()
