import { execFile, type ExecFileOptions } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

/** Keep process failures observable; each family owns its recipe and assertions. */
export async function invokeCliRecipe(
  directory: string,
  operations: readonly Record<string, unknown>[],
  options: Pick<ExecFileOptions, "cwd" | "timeout" | "env" | "maxBuffer">,
) {
  const path = resolve(directory, "recipe.json");
  await writeFile(path, JSON.stringify({ version: 1, operations }));
  try {
    return {
      code: 0,
      ...(await promisify(execFile)(
        "bun",
        ["src/cli/main.ts", "document", "recipe", path],
        { ...options, encoding: "utf8" },
      )),
    };
  } catch (error) {
    return error as { code: number; stdout: string; stderr: string };
  }
}
