# Shipped SDK arm

The `sdk-shipped` arm uses the built `cadara-cli` package, not the historical `cadara-sdk` prototype wrapper. Build with `bun scripts/build-cli.mjs <package>` and make `{BIN}/cadara` invoke `<package>/main.js` through Bun.

Materialize these canonical documents into each isolated run directory:

| Run document | Repository source |
| --- | --- |
| `SDK.md` | `src/cli/SDK.md` (not this directory's historical `SDK.md`) |
| `SDK_SKILL.md` | `.agents/skills/cadara-sdk-modelling/SKILL.md` |
| `CLI_SKILL.md` | `.agents/skills/cadara-cli-modelling/SKILL.md` |
| `CLI_README.md` | `src/cli/README.md` |
| `CLI_COVERAGE.md` | `src/cli/COVERAGE.md` |

For TypeScript imports, install/link the built package as `cadara-cli` in the run directory (the package exports `cadara-cli/sdk`). Scripts that only consume the injected `doc` need no runtime import; use `import type {SemanticDocument} from "cadara-cli/sdk"` when a typechecked script is desired. Run `{BIN}/cadara script model.ts --trace model.recipe.json`. Input task prompts, time/tool budgets, model pair and independent checker stay unchanged.

`../verify-sdk-references.sh` qualifies the same saved reference parts through the shipped SDK `replay` and script seams. This is a deterministic SDK/package qualification, not an agent performance measurement or evidence that a generated-ops agent script was used.

Trace recipes contain completed commands (including writes/inspection), explicit author-invalid accepted-invalid commands, and any command with `completion.live.kind === "applied"`. Calls that neither succeed nor apply state, and selection errors, remain failure evidence in typed errors/terminal results, not recipe steps. Scripts that catch not-applied errors therefore replay to their final model and remain eligible for disposable probes. Failed-but-live-applied edits stay in document history and stop replay/probes at that genuinely failed state; script control flow is not replayed. V1 still refuses recorded references that are not uniquely label-selectable (`cadara-kkl.17`); retain input assets and inspect replay output paths.

## Reproduce the original trial procedure

- Materialize `runs/<task>-sdk-shipped-<model>/TASK.md` with `prompt-template.md`: substitute the unchanged task title/text from `tasks.json`, `arms.json["sdk-shipped"].instructions`, the document list and absolute run directory / `{BIN}`. Use `t1`–`t5` and duplicate the t5 prompt as `t6` (the checker already aliases t6 to t5), for each of `gpt-6.1-sol` and `claude-sonnet-5-5`: 12 runs. Give t4 an independent reference `plate.cadara` from the unchanged t1 reference recipe, not an agent-generated seed.
- The historical launcher used model IDs `cpa/gpt-6.1-sol` / `cpa/claude-sonnet-5-5`, one isolated agent per directory, a 45-minute timeout, a soft 60-call budget and a **hard 90-call** cap. The prompt asks agents to aim for 60 calls and finish with `TRIAL-RESULT: done|gave-up`. Run through the normal external agent sandbox. Limit concurrent native CLI processes to two (including checkers).
- Retain authored scripts, requested native/export files, script stdout/stderr and optional recipe traces in each run directory. Original invocation instrumentation wrote `.trial-invocations.jsonl` records with `cmd`, `ok`, `ms` (plus timestamp/tool); record equivalent measured invocation evidence rather than estimating calls. Original prototype traces used `.cadara-trace.jsonl`; the shipped SDK uses explicit `--trace <recipe.json>` plus terminal `results` in script stdout, so do not pretend these formats are interchangeable.
- Run `CADARA_CLI=<built package>/main.js python3 evaluations/agent-modelling/checker.py <task> <absolute-run-dir> > <run-dir>/.verdict.json` with a fresh verdict per run. `t6` is accepted directly. A `done` claim is not the checker verdict.
- Keep each agent's run ID/session log and measured wall seconds, tool count, input+cache-read+cache-write tokens, output tokens, cost and final claim beside the run (historically collected into `run-meta.json` from `workflow-children.jsonl`, agent `status.json` and `sessionFile`). Append explicit `{run,task,arm:"sdk-shipped",model,pass,parametric,claimed,wall_s,tool_calls,tokens_in,tokens_out,cost,model_invocations,failed_invocations}` rows to `results.json`; unavailable metrics remain absent/null, not invented zeros. Historical collectors split IDs on the first two hyphens: **do not reuse that parser for the hyphenated `sdk-shipped` arm**. Use the explicit tuple/model suffix instead. Preserve old prototype rows and report new results separately in the README and bead.
