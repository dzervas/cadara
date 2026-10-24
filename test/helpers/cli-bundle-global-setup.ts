import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

const root = resolve(import.meta.dirname, "../..");
let bundleDirectory: string | undefined;
let cacheDirectory: string | undefined;

/**
 * The heavy project's CLI specs spawn the self-contained bundle built here
 * once per run. Spawning `bun src/cli/main.ts` instead costs ~30 s and ~6 GB
 * per process (Bun transforms Typia at startup with the uncached production
 * options); the bundle starts in about a second. `workflow-recipes.spec.ts`
 * still covers the source entry and the extracted release explicitly.
 */
export async function setup(project: TestProject) {
  bundleDirectory = await mkdtemp(join(tmpdir(), "cadara-cli-bundle-"));
  await promisify(execFile)("bun", ["scripts/build-cli.mjs", bundleDirectory], {
    cwd: root,
  });
  project.provide("cliEntry", join(bundleDirectory, "main.js"));
  // CLI processes inherit the environment. The model checkpoint cache
  // (cadara-3sq.6) is off, so every CLI spec evaluates its documents cold
  // whatever the scheduling; model-cache-recipes.spec.ts turns it on with its
  // own cache. Anything that still writes uses this run's directory, never
  // the user's ~/.cache/cadara.
  process.env.CADARA_MODEL_CACHE = "off";
  cacheDirectory = await mkdtemp(join(tmpdir(), "cadara-cli-cache-"));
  process.env.XDG_CACHE_HOME = cacheDirectory;
}

export async function teardown() {
  for (const directory of [bundleDirectory, cacheDirectory])
    if (directory) await rm(directory, { recursive: true, force: true });
}
