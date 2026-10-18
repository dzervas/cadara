import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openCadara, SemanticOperationError, SelectionError, SemanticInitializationError, SemanticTraceError } from "@/sdk";
import type { SemanticDocument } from "@/sdk";
import type { CommandModule } from "@/cli/types";

/** Deliberate user-code adapter edge, not a sandbox or a computed production dependency. */
export async function loadSdkScript(scriptPath: string): Promise<(document: SemanticDocument) => unknown> {
  const scriptUrl = pathToFileURL(resolve(scriptPath)).href;
  const module = await import(/* @vite-ignore */ scriptUrl);
  if (typeof module.default !== "function") throw new TypeError("SDK script must default-export a function accepting a SemanticDocument.");
  return module.default;
}

function scriptError(error: unknown): { name: string; message: string; [key: string]: unknown } {
  const base = { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
  if (error instanceof SemanticOperationError) return { ...base, result: error.result };
  if (error instanceof SelectionError) return { ...base, ...error.selection };
  if (error instanceof SemanticInitializationError) return { ...base, initialization: error.initialization };
  if (error instanceof SemanticTraceError) return { ...base, commandId: error.commandId, operation: error.operation, reference: error.reference };
  if (error instanceof AggregateError) return { ...base, errors: error.errors.map(scriptError) };
  return base;
}

export const scriptCommand: CommandModule = {
  name: "script",
  description: "Run a TypeScript SDK script in one isolated document (not sandboxed)",
  async run(argv, _env, io) {
    if (argv.length === 1 && argv[0] === "--help") {
      io.stdout("Usage: cadara script <script.ts> [--trace <recipe.json>]\nDefault-export async (doc) => value. See SDK.md. Runs trusted Bun code, NOT sandboxed.\n");
      return { ok: true };
    }
    if (!argv[0] || argv[0].startsWith("-") || !(argv.length === 1 || (argv.length === 3 && argv[1] === "--trace" && argv[2])))
      return { ok: false, kind: "usage", message: "Usage: cadara script <script.ts> [--trace <recipe.json>]" };
    const script = await loadSdkScript(argv[0]);
    let doc: SemanticDocument;
    try { doc = await openCadara(); }
    catch (error) {
      if (!(error instanceof SemanticInitializationError)) throw error;
      io.stdout(JSON.stringify({ version: 1, results: [], initialization: error.initialization, cleanup: error.initialization.cleanup, error: { name: error.name, message: error.message } }) + "\n");
      return { ok: false, kind: "failure", message: error.message };
    }
    let value: unknown;
    let failure: { error: unknown } | undefined;
    try { value = await script(doc); }
    catch (error) { failure = { error }; }
    // Trace write failures remain observable, beside any script failure.
    if (argv[2]) {
      try { await writeFile(argv[2], JSON.stringify(doc.trace()) + "\n"); }
      catch (error) { failure = { error: failure ? new AggregateError([failure.error, error], "Script and trace export failed") : error }; }
    }
    const cleanup = await doc.close();
    const cause = failure?.error;
    const expected = cause instanceof SemanticOperationError || cause instanceof SelectionError || cause instanceof SemanticInitializationError || cause instanceof SemanticTraceError;
    const error = failure ? scriptError(cause) : undefined;
    io.stdout(JSON.stringify({ version: 1, value, results: doc.results().map(({ correlation, outcome, completion, diagnostics }) => ({ correlation, outcome, completion, diagnostics })), cleanup, ...(error ? { error } : {}) }) + "\n");
    if (failure && !expected) throw cause;
    if (failure || cleanup.kind !== "closed") return { ok: false, kind: "failure", message: error?.message ?? "SDK cleanup failed" };
    return { ok: true };
  },
};
