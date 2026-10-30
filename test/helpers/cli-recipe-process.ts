import {
  execFile,
  type ExecFileOptions,
  type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import { writeFile, readdir, copyFile } from "node:fs/promises";
import { addAbortListener } from "node:events";
import { resolve, dirname } from "node:path";
import { promisify } from "node:util";
import { inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    /** Absolute `main.js` of the CLI bundle built by the heavy project's global setup. */
    cliEntry: string;
  }
}

/** The CLI entry the recipe specs spawn; see `cli-bundle-global-setup.ts`. */
export function cliEntry() {
  return inject("cliEntry");
}

/** Complete executable JS runtime, deliberately omitting OCC assets for preflight/startup tests. */
export async function copyCliRuntimeWithoutAssets(directory: string) {
  const source = dirname(cliEntry());
  for (const name of await readdir(source)) {
    if (name.endsWith(".js")) await copyFile(resolve(source, name), resolve(directory, name));
  }
}

/** Pass Vitest's TestContext.signal to stop CPU-bound children at the test deadline. */
export async function execCliTestProcess(
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
) {
  const execution = promisify(execFile)(file, args, {
    ...options,
    // Bound the per-process timeout even if a child ignores graceful shutdown.
    // Node's execFile AbortSignal path uses SIGTERM independently of this option.
    killSignal: "SIGKILL",
  });
  const closed = new Promise<void>((resolve) => {
    execution.child.once("close", () => resolve());
  });
  // execFile does not forward killSignal to its AbortSignal handler. Ensure
  // cancellation also stops a child that cannot service graceful shutdown.
  const abortListener = options.signal && addAbortListener(options.signal, () => {
    execution.child.kill("SIGKILL");
  });
  try {
    return await execution;
  } finally {
    // execFile rejects on abort before the OS has actually reaped the child.
    await closed;
    abortListener?.[Symbol.dispose]();
  }
}

type CliProcessOptions = Pick<
  ExecFileOptions,
  "cwd" | "timeout" | "env" | "maxBuffer" | "signal"
> & {
  /** Another copy of the CLI entry; defaults to the built bundle. */
  entry?: string;
};

/** Run `cadara document recipe <args>` (e.g. `--schema`), keeping process failures observable. */
export async function invokeCliDocumentRecipe(
  args: readonly string[],
  { entry = cliEntry(), ...options }: CliProcessOptions,
) {
  try {
    return {
      code: 0,
      ...(await execCliTestProcess(
        "bun",
        [entry, "document", "recipe", ...args],
        { ...options, encoding: "utf8" },
      )),
    };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    if (typeof failure.code !== "number") throw error;
    return failure;
  }
}

/** Keep process failures observable; each family owns its recipe and assertions. */
export async function invokeCliRecipe(
  directory: string,
  operations: readonly Record<string, unknown>[],
  options: CliProcessOptions,
  /** Extra `document recipe` options placed before the recipe path. */
  args: readonly string[] = [],
) {
  const path = resolve(directory, "recipe.json");
  await writeFile(path, JSON.stringify({ version: 1, operations }));
  return invokeCliDocumentRecipe([...args, path], options);
}
