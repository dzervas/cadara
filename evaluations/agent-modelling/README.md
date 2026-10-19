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

V1 trace export deliberately refuses references that cannot be uniquely label-selected (duplicate labels within one owner and session-scoped tangent handles), naming the exact step/reference in `SemanticTraceError` while retaining the complete recorded-command log. Full reference provenance is tracked in `cadara-kkl.17`. Traces record completed commands (including writes/inspection), accepted-invalid commands under explicit author-invalid intent, and any command with live-applied state. Not-applied failures, rejections, conflicts, unavailable/canceled calls and selection errors are omitted; typed errors and terminal results retain their full evidence. After caught not-applied errors, a script's trace replays to its final model and supports disposable probes. Failed-but-live-applied edits remain document history and halt replay/probes at that genuinely failed state; replay does not reproduce script control flow.

### Shipped SDK two-model rerun (2026-10-19)

Fresh isolated agents used the shipped `cadara-cli/sdk` and `cadara script`, not the prototype SDK. The matrix is t1–t5 plus t6 (an independent t5 repeat) for each model, with the original prompts, 45-minute timeout and 90-call hard cap. The independent checker from this checkout was run sequentially against the trial package at `/home/dzervas/Lab/cadara/.pi/trials/agent-interface/sdk-shipped/package/main.js`; fresh `.verdict.json` files remain beside each of the 11 delivered models. The twelfth run, GPT t6, is pending at collection and is explicitly null in `results.json`, not a pass or a failure.

| Model             | Tier  | Nominal geometry       | Fully parametric       | Median time | Median tool calls | Median context | Cost         |
| ----------------- | ----- | ---------------------- | ---------------------- | ----------- | ----------------- | -------------- | ------------ |
| claude-sonnet-5-5 | t1–t4 | 4/4                    | 1/1 (t1)               | 98.5 s      | 14.5              | 0.66 M         | $1.495       |
| claude-sonnet-5-5 | t5 ×2 | 2/2                    | 0/2                    | 2082.5 s    | 49.5              | 4.80 M         | $2.861       |
| gpt-6.1-sol       | t1–t4 | 4/4                    | 1/1 (t1)               | 226 s       | 34.5              | 1.00 M         | $1.228       |
| gpt-6.1-sol       | t5 ×2 | 1/1 checked; 1 pending | 1/1 checked; 1 pending | 839 s (n=1) | 55 (n=1)          | 2.42 M (n=1)   | $0.480 (n=1) |

“Nominal geometry” is the checker's `pass`, separate from its parametric probes and the agent's claim. “Fully parametric” counts runs passing every probe, only for t1 and t5/t6. Context is input + cache-read + cache-write tokens summed over assistant turns, not peak context occupancy. Time/tool counts/cost come from the collected agent attempt's harness status; time is rounded seconds, cost is the sum of recorded per-run costs (rounded to $0.001), not a median. Pending metrics are excluded; a timed-out attempt with measured metrics is included. Aborted provider attempts and independent-checker time/cost are not included. `model_invocations` counts measured CLI calls excluding `--schema`/`--help`; `failed_invocations` counts their unsuccessful exits, not failed semantic operations. Claude t5's log is in `w/.trial-invocations.jsonl`. No prototype JSONL traces were inferred from shipped recipe traces.

| Task           | Model             | Checker pass | Probes  | Claimed | Wall   | Tool calls | Attempts / notes                                                                    |
| -------------- | ----------------- | ------------ | ------- | ------- | ------ | ---------- | ----------------------------------------------------------------------------------- |
| t1             | gpt-6.1-sol       | yes          | 4/4     | done    | 239 s  | 31         | 1                                                                                   |
| t2             | gpt-6.1-sol       | yes          | —       | done    | 213 s  | 38         | 1                                                                                   |
| t3             | gpt-6.1-sol       | yes          | —       | done    | 244 s  | 40         | 2; first attempt provider 503 before work                                           |
| t4             | gpt-6.1-sol       | yes          | —       | done    | 185 s  | 24         | 1                                                                                   |
| t5             | gpt-6.1-sol       | yes          | 5/5     | done    | 839 s  | 55         | 1; agent reports other edit sequences failing fillet rebuilds                       |
| t6 (t5 repeat) | gpt-6.1-sol       | pending      | pending | —       | —      | —          | 4; 503 mid-run, two 503 startup failures, latest attempt still running              |
| t1             | claude-sonnet-5-5 | yes          | 4/4     | done    | 130 s  | 11         | 1                                                                                   |
| t2             | claude-sonnet-5-5 | yes          | —       | done    | 53 s   | 14         | 1                                                                                   |
| t3             | claude-sonnet-5-5 | yes          | —       | done    | 86 s   | 15         | 1                                                                                   |
| t4             | claude-sonnet-5-5 | yes          | —       | done    | 111 s  | 15         | 1; used XY sketch + offset, not a face-supported sketch                             |
| t5             | claude-sonnet-5-5 | yes          | 3/5     | done    | 1466 s | 43         | 1; width/boss-follow-width probes fail; evidence in `w/`                            |
| t6 (t5 repeat) | claude-sonnet-5-5 | yes          | 3/5     | —       | 2699 s | 56         | 2; first attempt provider 404 after ~25 min; retry timed out at 45 min after saving |

**Failures and interpretation.** All 11 delivered files pass the nominal checker, including the model saved before Claude t6 timed out. Both Claude hard-tier models fail `width_drives_bounds` and `bosses_follow_width`, while height, inset and wall probes pass. Claude t5's final report explicitly acknowledges that width 80 fails with “Cavity derived output invalid” after switching from solid fillet/shell to sketch fillets plus a cavity cut; it also notes literal inner radius 1 rather than a wall-dependent radius. The checker does not isolate the rebuild's root cause, and its passing wall-volume tolerance is not proof that every intended dependency is correct. Claude t6 has only a timeout report, so no final success claim or agent diagnosis is attributed to it. GPT t5 passes the checker's exact five probes but its final report records fillet rebuild failures on other edit sequences and no separate trace replay. This is finite-probe evidence, not arbitrary-edit robustness.

The SDK did not eliminate selection/schema friction: GPT reports generated labels changing after dimensional edits and corrected sketch-label fields; Claude reports large stdout envelopes and schema/direction corrections. Scoped live discovery helped recovery. Claude t4 deliberately avoided the rotated face frame by using an XY sketch with a thickness offset: the nominal checker accepts its geometry but does not enforce that requested construction method. Likewise, nominal success does not certify fully constrained sketches or every prompt requirement. Ten agents claim `done`; one of those (Claude t5) fails parametric probes, although its report candidly states the limitation. Claims are not verdicts.

**Comparison with 2026-10-18.** These comparisons use the original `sdk` prototype and `cli` rows in `results.json`, not the four-arm pooled table above:

- GPT t1–t4 remains 4/4 nominal and 1/1 fully parametric. Shipped median time/tool calls/context are 226 s / 34.5 / 1.00 M, versus prototype SDK 192 s / 23.5 / 0.89 M and CLI 228 s / 33.5 / 1.17 M. Tier costs are $1.228 / $0.856 / $1.180 respectively: no replicated speed or cost gain over the prototype.
- Claude t1–t4 also remains 4/4 nominal and 1/1 fully parametric, but shipped medians are 98.5 s / 14.5 / 0.66 M, versus prototype SDK 67 s / 11 / 0.48 M and CLI 72 s / 11 / 0.48 M. Tier costs are $1.495 / $1.161 / $1.210.
- GPT's checked hard run is fully parametric (1/1, with the repeat pending), versus prototype SDK 0/2 and CLI 1/2. Its 839 s / 55 calls / 2.42 M context compares with the prototype's 414.5 s / 36 / 1.74 M and CLI's 381.5 s / 60 / 1.85 M; one collected run cannot establish a hard-tier improvement. Collected tier costs are $0.480 (one run), $0.765 and $0.873 (two runs each), so totals are not directly comparable.
- Claude hard-tier nominal geometry remains 2/2, but fully parametric drops to 0/2 versus prototype SDK 1/2 and CLI 2/2. Shipped medians are 2082.5 s / 49.5 / 4.80 M, versus prototype SDK 562.5 s / 40 / 2.76 M and CLI 493 s / 38.5 / 3.24 M; costs are $2.861 / $1.731 / $1.963. The timeout and construction choices prevent attributing this difference to the SDK alone.

**Confounds and provenance.** There is n=1 per task/model cell, with only one additional t5 repeat, not a replicated benchmark. Provider 503/404 failures caused retries (including abandoned partial work), concurrent load from parallel validation confounds wall time, and Claude t6 exhausted the trial timeout. The shipped package and prerequisites differ from the prototype trial; the same checker does not make this a controlled API-only experiment. GPT t6's latest run ID is `5600d620-da84-472d-b6ec-0735f9a8e61b` (workflow `38d1dc7a`); its final report/deliverable are still unavailable at collection. Each row records the explicit task/arm/model tuple, run ID, attempt count and provider notes; no hyphen-splitting arm parser was used. Session JSONL supplies token usage, harness `status.json` supplies duration/tool count/cost, and `<runId>_delegate_output.md` supplies the final `TRIAL-RESULT` claim. Raw evidence remains under the untracked `sdk-shipped/runs/`, parent-session subagent artifacts and `/tmp/pi-subagents-uid-1000/async-subagent-runs/`; these records are not committed model artifacts.
