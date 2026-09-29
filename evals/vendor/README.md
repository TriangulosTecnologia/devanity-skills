# Vendored eval suites

Other projects' eval suites, copied into this repository as they are, so devanity is measured by the same tests its field publishes, with the same files and the same commands. Our own harness is [`../harness/`](../harness/); this directory holds only what someone else wrote, plus the runner that adds `devanity` as one more arm.

```
vendor/
  MANIFEST.json   per tree: repository, commit, licence, and the sha256 of every file
  run.py          ours: fetches the competitor plugins at their pins, runs a suite with the devanity arm
  ponytail/       DietrichGebert/ponytail @ e3ba2aa: LICENSE, benchmarks/, skills/ponytail/
  caveman/        JuliusBrussee/caveman @ 2fd153c: LICENSE, LICENSING.md, evals/, benchmarks/, skills/
```

## The rule

- **A vendored tree is never edited.** The harness selftest (`python3 evals/harness/run.py --selftest`, `_selftest_vendor`) is red if any byte of a file listed in `MANIFEST.json` changes, or if a file is added under a tree. To update, re-copy the whole tree at a new commit with `git archive <commit> <paths>` and regenerate the manifest; never patch a file in place.
- **Their licence travels with the files.** Each tree keeps its own licence (MIT for both), which governs those files; this repository's CC BY-NC 4.0 covers only what we wrote. From caveman we copy only MIT paths (its `LICENSING.md` lists the BSL-1.1 directories, none of them copied).
- **The harness reads the shared tasks from here.** The 23 tasks our harness shares with ponytail (the safety tier, `reuse-*`, `trace-transfer`, the 12 `tmpl-*` tickets) are the objects of `ponytail/benchmarks/agentic/tasks.py`, imported by `../harness/tasks.py`, not a copy of them. The one change our harness makes is `todo-null`'s boot wait (see the harness README, Provenance).
- **superpowers' eval repository is not here.** `prime-radiant-inc/superpowers-evals` ships no licence, so nothing of it may be copied. superpowers itself (MIT) still runs as an arm of our harness.

## Running a suite

```bash
python3 evals/harness/build_plugins.py        # the devanity arm, from plugin/
python3 evals/vendor/run.py plugins           # ponytail, caveman, superpowers, feature-dev, security-guidance at their pins
cd evals/harness
./container.sh python3 ../vendor/run.py --list
./container.sh python3 ../vendor/run.py <suite> -- <the suite's own arguments>
```

Each run copies the tree to `$DEVANITY_HARNESS_RUNS_DIR/vendor/<suite>-<stamp>/`, adds the devanity arm to that copy, and runs the authors' command there. The outputs are the authors' own (their `runs/`, `results/`, snapshot), inside the copy, next to a `<suite>-<stamp>.json` with the commit and the exact commands. Every suite runs in the harness container, because most of them execute the code the model wrote.

| suite | the authors' command | needs | the devanity arm |
|---|---|---|---|
| `ponytail-agentic` | `benchmarks/agentic/run.py` (39 tasks, Claude Code headless, `--plugin-dir` arms) | the `tmpl-*` tickets need the fixture (`python3 evals/harness/fixture.py --clone`) | an `ARMS` entry and a `PLUGIN_ARMS` member, the way ponytail and caveman are declared there; runs from `plugin/` as users install it |
| `ponytail-promptfoo` | `npx promptfoo@latest eval -c benchmarks/promptfooconfig.yaml` (5 single-shot tasks) | `ANTHROPIC_API_KEY` | `arms/devanity.js` (their `ponytail.js`, skill path swapped) and one more `prompts` entry |
| `ponytail-behavior` | the same with `benchmarks/behavior.yaml` (3 behavior gates) | `ANTHROPIC_API_KEY` | the same |
| `ponytail-robustness` | `node benchmarks/robustness-audit.js` (16 edge-case tasks, OpenAI models) | `OPENAI_API_KEY` | run twice: as shipped, then with the devanity kernel at `skills/ponytail/SKILL.md` in its own copy |
| `ponytail-claude-email` | `node benchmarks/claude-email.js` | `ANTHROPIC_API_KEY` | run twice, as above |
| `ponytail-model-email` | `node benchmarks/model-email.js` | `OPENAI_API_KEY` | run twice, as above |
| `caveman-evals` | `python3 evals/llm_run.py`, then `evals/measure.py` (10 prompts, every `skills/*/SKILL.md` an arm) | a venv with `tiktoken` in the copy (network) | `skills/devanity/SKILL.md` in the copy |
| `caveman-benchmarks` | `python3 benchmarks/run.py` (10 prompts, Messages API) | `ANTHROPIC_API_KEY`, a venv with `anthropic` | run twice: as shipped, then with the devanity kernel at `skills/caveman/SKILL.md` |

**Where each suite puts devanity.** Devanity is built to work in a repository. Only `ponytail-agentic` runs it there, as a plugin in a workspace; every other suite gives it the kernel as a system prompt with no files, which is outside its design. Those numbers are a field comparison, never a gate and never a target for the kernel.

`DEVANITY_VENDOR_EXPERIMENT=<arm>` (an arm of `evals/harness/build_plugins.EXPERIMENTS`, built by `build_plugins.py`) adds that arm beside `devanity` in the same run, the same way, so a kernel candidate meets the same models at the same hour as the control; the run's json records the sha256 of every kernel it used.

The authors' suggested arguments are theirs to read in each tree (for example `--repeat 10` for the promptfoo configs, `--arms baseline,caveman,ponytail,yagni-oneliner --models haiku --runs 4` for the agentic suite).

**One difference from the authors' own runs, deliberately.** The copy has no `CLAUDE.md` or `AGENTS.md` above it. In their repositories the default run directory sits under the repository root, whose `AGENTS.md` is ponytail's own ruleset (and caveman's root carries a `CLAUDE.md` and an `AGENTS.md`), so a cell there inherits them in every arm, baseline included. Reproducing that would put ponytail's rules into the devanity cells; the files and commands are theirs, the ancestors are clean.

**Not wired, with the reason:** ponytail's `benchmark-local.py` (runs through a local Ollama model); ponytail's v4 hardening A–F and caveman's wrap benchmark (their harnesses are not published, only the writeups); caveman's `engine/evals` (BSL-1.1, and it measures the compressor, not the agent).
