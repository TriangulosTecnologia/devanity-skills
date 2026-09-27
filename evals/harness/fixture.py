#!/usr/bin/env python3
"""Real-repo fixture for the harness (SPEC §9, PLAN F0.3): fastapi/full-stack-fastapi-template @ cd83fc1.

The 12 real-repo tickets are copied out of this clone, so the commit must be exactly the one
ponytail's published numbers used or the size comparison is meaningless. This module never guesses:
it reports, refuses, or (only when asked) clones. It never checks out on your behalf -- a clone on
another commit may carry local work.

  python3 fixture.py            status on one line; exit 0 if present AND pinned, else 1 with the fix
  python3 fixture.py --clone    clone + checkout cd83fc1 into the default dir (or --path / DEVANITY_TMPL)
  python3 fixture.py --path P   override the location for either mode

Library use (run.py, before any API spend):  fixture.ensure()  -> Path, or SystemExit with instructions.
"""
import argparse, os, shutil, sys
from pathlib import Path

import tasks

REPO_URL = "https://github.com/fastapi/full-stack-fastapi-template"
PINNED = "cd83fc1"                                    # same commit as ponytail's runs; comparability
DEFAULT_DIR = Path(__file__).resolve().parent / "fixtures" / "full-stack-fastapi-template"

def _git(*args, cwd=None):
    """tasks._git, the harness's one git call (no shell, output captured, hooks and exec-capable
    settings off): the output feeds messages, the user never sees git noise."""
    return tasks._git(cwd, *args)

def resolve() -> Path:
    """DEVANITY_TMPL (the same override tasks.py honours) wins; else the gitignored default under fixtures/."""
    env = os.environ.get("DEVANITY_TMPL")
    return Path(env).expanduser().resolve() if env else DEFAULT_DIR

def status(path=None) -> dict:
    """{"present", "commit", "pinned"}. present = a git work tree lives there (an empty or non-git dir
    counts as absent so --clone can proceed). pinned = HEAD is PINNED's full sha; we resolve PINNED
    inside the clone rather than trusting the 7-char prefix, and fall back to the prefix only when
    the clone is too shallow to hold the object at all (then HEAD's own sha is the only evidence)."""
    path = Path(path) if path else resolve()
    inside = _git("rev-parse", "--is-inside-work-tree", cwd=path) if path.is_dir() else None
    if inside is None or inside.returncode != 0 or inside.stdout.strip() != "true":
        return {"present": False, "commit": None, "pinned": False}
    head = _git("rev-parse", "HEAD", cwd=path).stdout.strip()
    short = _git("rev-parse", "--short", "HEAD", cwd=path).stdout.strip() or None
    full = _git("rev-parse", "--verify", "--quiet", PINNED + "^{commit}", cwd=path)
    pinned = (head == full.stdout.strip()) if full.returncode == 0 and full.stdout.strip() \
             else bool(head) and head.startswith(PINNED)
    return {"present": True, "commit": short, "pinned": pinned}

def _how_to_get(path):
    return (f"  git clone --filter=blob:none {REPO_URL} {path}\n"
            f"  git -C {path} checkout {PINNED}\n"
            f"or: python3 {Path(__file__).name} --clone\n"
            f"or: export DEVANITY_TMPL=/path/to/an/existing/clone/at/{PINNED}")

def ensure(path=None, clone=False) -> Path:
    """Return the fixture path when it is present at PINNED. Otherwise SystemExit with the exact fix:
    a wrong commit is never corrected here (local changes), an absent clone is fetched only with clone=True."""
    path = Path(path) if path else resolve()
    st = status(path)
    if st["present"]:
        if st["pinned"]: return path
        sys.exit(f"fixture at {path} is on commit {st['commit']}, not {PINNED} (ponytail's commit; the size "
                 f"numbers are only comparable at that commit).\nFix, after saving any local work there:\n"
                 f"  git -C {path} checkout {PINNED}")
    if not clone:
        sys.exit(f"fixture not found at {path}. Get it with:\n{_how_to_get(path)}")
    if path.exists() and any(path.iterdir()):
        sys.exit(f"{path} exists and is not empty but is not a git work tree; move it away or pick --path")
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"cloning {REPO_URL} -> {path}", flush=True)
    # Blobless partial clone keeps history (so `cd83fc1^{commit}` resolves) while fetching only the
    # checked-out tree's blobs. Some mirrors/proxies refuse filters; then pay for the plain clone.
    r = _git("clone", "--quiet", "--filter=blob:none", REPO_URL, str(path))
    if r.returncode != 0:
        shutil.rmtree(path, ignore_errors=True)
        print("partial clone refused; retrying a plain clone", flush=True)
        r = _git("clone", "--quiet", REPO_URL, str(path))
    if r.returncode != 0:
        shutil.rmtree(path, ignore_errors=True)
        sys.exit(f"git clone failed (exit {r.returncode}):\n{r.stderr.strip()}\nManual route:\n{_how_to_get(path)}")
    r = _git("checkout", "--quiet", PINNED, cwd=path)
    if r.returncode != 0:
        sys.exit(f"git checkout {PINNED} failed in {path}:\n{r.stderr.strip()}")
    st = status(path)
    if not st["pinned"]:                              # trust the check, not the exit codes above
        sys.exit(f"clone finished but HEAD is {st['commit']}, not {PINNED}; inspect {path}")
    return path

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--clone", action="store_true", help=f"clone + checkout {PINNED} if absent")
    ap.add_argument("--path", help="fixture location (default: $DEVANITY_TMPL or fixtures/full-stack-fastapi-template)")
    args = ap.parse_args()
    path = Path(args.path).expanduser().resolve() if args.path else resolve()
    if args.clone: path = ensure(path, clone=True)
    st = status(path)
    print(f"fixture {path}: present={st['present']} commit={st['commit']} pinned={st['pinned']} (want {PINNED})")
    if not st["pinned"]: ensure(path)                # exits 1 with the exact fix
    sys.exit(0)

if __name__ == "__main__":
    main()
