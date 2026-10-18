// Example consumer of `document recipe --output compact` (output version 1).
// From an extracted release: bun examples/compact-summary.ts examples/plate.json
// It parses the single JSON envelope (no text scraping) and exits 1 unless the
// CLI exited 0, every operation completed, nothing was left unexecuted and
// cleanup closed. Use the default detailed output for exact topology and
// intermediate discovery when inspecting or debugging.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
// Type-only import (erased at runtime) that keeps this example on the contract.
import type { CompactRecipeOutput } from "@/cli/commands/compact-output";

const recipe = process.argv[2];
if (!recipe) {
  process.stderr.write(
    "Usage: bun examples/compact-summary.ts <recipe.json>\n",
  );
  process.exit(2);
}
const main = fileURLToPath(new URL("../main.js", import.meta.url));
const run = await new Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>((resolve) =>
  execFile(
    "bun",
    [main, "document", "recipe", "--output", "compact", recipe],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    (error, stdout, stderr) =>
      resolve({
        exitCode: error ? Number(error.code ?? 1) : 0,
        stdout,
        stderr,
      }),
  ),
);
// Usage errors print nothing on stdout and never start the modelling runtime.
if (run.exitCode === 2) {
  process.stderr.write(run.stderr);
  process.exit(2);
}
const envelope = JSON.parse(run.stdout) as CompactRecipeOutput;
if (envelope.output?.mode !== "compact" || envelope.output.version !== 1)
  throw new Error("Unsupported cadara recipe output contract.");

const results = envelope.initialization ? [] : envelope.results;
const unexecuted = envelope.initialization ? [] : envelope.unexecuted;
const cleanup = (envelope.initialization ?? envelope).cleanup!;
const last = results.findLast(
  (result) => result.discovery?.detail === "included",
)?.discovery;
const document =
  last?.detail === "included"
    ? {
        revisionId: last.state.revisionId,
        label: last.document?.label ?? null,
        references: last.references.reduce<Record<string, number>>(
          (counts, reference) => {
            counts[reference.target.kind] =
              (counts[reference.target.kind] ?? 0) + 1;
            return counts;
          },
          {},
        ),
        bodies: last.model?.bodies ?? [],
      }
    : null;
const summary = {
  ok:
    run.exitCode === 0 &&
    !envelope.initialization &&
    results.every(
      (result) =>
        result.outcome.kind === "completed" ||
        result.outcome.kind === "accepted-invalid",
    ) &&
    unexecuted.length === 0 &&
    cleanup.kind === "closed",
  exitCode: run.exitCode,
  initialization: envelope.initialization?.kind ?? "initialized",
  operations: results.map((result) => ({
    commandId: result.correlation.commandId,
    outcome: result.outcome.kind,
    ...(result.outcome.kind === "failed"
      ? { failures: result.outcome.failures }
      : {}),
    receipts: Object.fromEntries(
      Object.entries(result.completion).map(([name, receipt]) => [
        name,
        receipt.kind,
      ]),
    ),
    diagnostics: result.diagnostics.length,
  })),
  saved: results.flatMap((result) =>
    result.completion.file.kind === "written"
      ? [
          {
            commandId: result.correlation.commandId,
            path: result.completion.file.path,
            bytesWritten: result.completion.file.bytesWritten,
          },
        ]
      : [],
  ),
  unexecuted,
  cleanup: cleanup.kind,
  document,
};
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
process.exit(summary.ok ? 0 : 1);
