# Vendored eval code

Another project's eval code, copied into this repository as it is, so the tasks devanity shares with the field are the field's own objects and cannot drift. Our harness is [`../harness/`](../harness/); this directory holds only what someone else wrote.

```
vendor/
  MANIFEST.json   per tree: repository, commit, licence, and the sha256 of every file
  ponytail/       DietrichGebert/ponytail @ e3ba2aa: LICENSE, benchmarks/agentic/tasks.py
```

## The rule

- **A vendored tree is never edited.** The harness selftest (`python3 evals/harness/run.py --selftest`, `_selftest_vendor`) is red if any byte of a file listed in `MANIFEST.json` changes, or if a file is added under a tree. To update, re-copy the files at a new commit with `git archive <commit> <paths>` and regenerate the manifest; never patch a file in place.
- **Their licence travels with the files.** ponytail's MIT licence governs its files; this repository's CC BY-NC 4.0 covers only what we wrote.
- **The harness reads the shared tasks from here.** The tasks our harness shares with ponytail (the safety tier, `trace-transfer`, four `tmpl-*` tickets) are the objects of `ponytail/benchmarks/agentic/tasks.py`, imported by `../harness/tasks.py`, not a copy of them.

## What is not here, and why

Devanity is built to work in a repository (README, "Where it works"). The field's other suites were vendored once and removed on 2026-09-29 (PLAN): ponytail's promptfoo, behavior, email and robustness suites and caveman's evals and benchmarks give the kernel as a system prompt with no files, which is outside devanity's design; ponytail's own agentic runner repeats, beside toy greenfield apps, what our harness already runs on the same task objects. Their numbers from that round stay in [`../results/2026-09-29-field-suites.md`](../results/2026-09-29-field-suites.md). `prime-radiant-inc/superpowers-evals` ships no licence, so nothing of it was ever copied; superpowers itself (MIT) runs as an arm of our harness.
