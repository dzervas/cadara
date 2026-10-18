import { execFile, type ExecFileOptions } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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

/** Keep process failures observable; each family owns its recipe and assertions. */
export async function invokeCliRecipe(
  directory: string,
  operations: readonly Record<string, unknown>[],
  options: Pick<ExecFileOptions, "cwd" | "timeout" | "env" | "maxBuffer">,
  /** Extra `document recipe` options placed before the recipe path. */
  args: readonly string[] = [],
) {
  const path = resolve(directory, "recipe.json");
  await writeFile(path, JSON.stringify({ version: 1, operations }));
  try {
    return {
      code: 0,
      ...(await promisify(execFile)(
        "bun",
        [cliEntry(), "document", "recipe", ...args, path],
        { ...options, encoding: "utf8" },
      )),
    };
  } catch (error) {
    return error as { code: number; stdout: string; stderr: string };
  }
}
