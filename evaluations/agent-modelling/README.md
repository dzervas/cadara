# Agent modelling evaluations

Modelling tasks that an LLM agent completes through a CADara interface. An independent checker verifies the saved native file. They were introduced for the agent-interface trials (beads `cadara-kkl.1`, `cadara-kkl`; research in `docs/research/agent-modelling-interface.md`).

## Contents

- `tasks.json`: the task prompts.

  | Task | Brief                                                            | Parametric probes |
  | ---- | ---------------------------------------------------------------- | ----------------- |
  | t1   | Parametric mounting plate                                        | 4                 |
  | t2   | Revolved flanged bushing                                         | —                 |
  | t3   | Open box with vent slots                                         | —                 |
  | t4   | Edit an existing plate                                           | —                 |
  | t5   | Hard: parametric enclosure with fillets, shell, bosses and holes | 5                 |

  Every prompt is wrapped by `harness/prompt-template.md`.

- `harness/arms.json`: per-interface instructions. `cli` is the shipped recipe CLI. `sdk-shipped` is the shipped `cadara-cli/sdk` plus `cadara script`; materialize its canonical docs using [harness/SDK-SHIPPED.md](harness/SDK-SHIPPED.md). The historical `sdk`, `rt` and `rtlook` arms used throwaway prototypes; their docs/results remain explicitly historical.
- `checker.py`: the expected outputs. It reopens the saved file through the built CLI and checks:
  - body count and kind
  - bounds
  - STL volume (0.4% tolerance)
  - feature positions (hole and boss axes)
  - parametric probes: `variable.update` on the reopened file, then re-measure

  `python3 checker.py <task> <run-dir>` prints a JSON verdict.

- `reference/<task>/*.json`: recipe chains that produce passing outputs. Run them in name order in one directory; t4 starts from t1's `plate.cadara`. `./verify-references.sh` replays them all and checks them. It needs `bun run build:cli`, or `CADARA_CLI=<main.js>`.
- `results.json`: per-run results from 2026-10-18.

## Results (2026-10-18)

The matrix was 4 arms × 2 models, plus a second t5 repetition. There were 48 runs, each with one isolated agent and a hard limit of 90 tool calls.

| Model             | Tier  | Nominal geometry | Fully parametric | Median time | Median tool calls | Median context | Cost  |
| ----------------- | ----- | ---------------- | ---------------- | ----------- | ----------------- | -------------- | ----- |
| claude-sonnet-5-5 | t1–t4 | 16/16            | 4/4 (t1)         | 70 s        | 12                | 0.52 M         | $4.60 |
| claude-sonnet-5-5 | t5 ×2 | 8/8              | 5/8              | 529 s       | 44                | 3.51 M         | $7.73 |
| gpt-6.1-sol       | t1–t4 | 16/16            | 4/4 (t1)         | 216 s       | 25                | 0.97 M         | $4.36 |
| gpt-6.1-sol       | t5 ×2 | 8/8              | 4/8              | 354 s       | 40                | 1.68 M         | $3.25 |

Context is total processed input (uncached + cache read/write) summed over turns.

- **Interface choice did not change success.** All parametric failures came from construction choices that hit kernel/naming defects (`cadara-0cl`, `cadara-6bu`) or an OCC fillet rejection.
- **The SDK arms helped gpt-6.1-sol on t1–t4,** with about 25% less context and 15–20% less time than the CLI. Sonnet was flat across arms.
- **Agents overclaim.** In the hard tier, 5 of 16 runs reported success while a parametric probe failed.
- Full write-up: `docs/research/agent-modelling-interface.md` §11a.

## Shipped SDK qualification (cadara-kkl.15)

The shipped SDK has its own `sdk-shipped` arm; this does not relabel prototype runs as production evidence. The script command, namespaced operation typing, handles, outcome/error policy, scoped selection/queries, disposable probes, native save/reopen/STEP export, CLI trace replay and consumer declarations are qualified by `src/application/semantic/sdk.spec.ts`, `test/static/sdk-operation-types.spec.ts` and `src/cli/sdk-scripts.spec.ts`.

Reference-model rerun against the built package (`CADARA_CLI=/tmp/cli-kkl-15/main.js`, 2026-10-18):

| Entry seam | t1 plate | t2 bushing | t3 enclosure | t4 face-supported edit | t5 parametric enclosure |
| --- | --- | --- | --- | --- | --- |
| unchanged `verify-references.sh` | pass, 4/4 probes | pass | pass | pass | pass, 5/5 probes |
| shipped `verify-sdk-references.sh` | pass, 4/4 probes | pass | pass | pass | pass, 5/5 probes |

The SDK harness runs unchanged reference recipe data through the shipped SDK's `replay` method inside `cadara script`, then the unchanged independent checker reopens the delivered files and probes them. It tests package/seam parity, not fresh agent performance, generated-ops ergonomics or a new two-model comparison. Run it with `CADARA_CLI=<built main.js> ./verify-sdk-references.sh`.

V1 trace export deliberately refuses references that cannot be uniquely label-selected (duplicate labels within one owner and session-scoped tangent handles), naming the exact step/reference in `SemanticTraceError` while retaining the complete executed command log. Full reference provenance is tracked in `cadara-kkl.17`. Recipes stop at a failed step even when a script catches that error and continues; no full repaired-tail replay claim is made.
