import type { CliEnv, CliIO, CommandModule } from "@/cli/types";
import type {
  ModelCheckpointEvent,
  ModelCheckpointStore,
} from "@/domain/modeling/model-checkpoint-store";
import {
  createFileModelCheckpointStore,
  isModelCheckpointCacheFailure,
  MODEL_CHECKPOINT_CACHE_MAX_BYTES,
  resolveModelCheckpointCacheRoot,
} from "@/composition/model-checkpoint-cache";

/**
 * cadara-3sq.6: CLI controls of the per-user model checkpoint cache, which
 * lets a fresh `cadara document recipe` process adopt the evaluated native
 * state of an unchanged `document.open` instead of replaying its history.
 */
export const modelCacheHelp = [
  "Model cache: `document.open` of a native file restores a cached evaluated checkpoint when one",
  "  exists for exactly the same content, or rebuilds the history and stores one. Location:",
  "  $XDG_CACHE_HOME/cadara/model-checkpoints (else ~/.cache/cadara/model-checkpoints), private",
  "  to your user. It retains model-derived data (exact geometry, labels, history) locally until",
  `  evicted (least recently used above ${MODEL_CHECKPOINT_CACHE_MAX_BYTES / 1024 / 1024} MiB) or cleared. Entries are keyed by the`,
  "  complete document content, its geometry assets, the evaluation settings and a fingerprint",
  "  of this CLI build, its OpenCascade JS/WASM and the runtime; anything else misses. A source",
  "  checkout (`bun src/cli/main.ts`) never uses it. The cache is never required: a missing,",
  "  corrupt, incompatible, unwritable or full cache rebuilds from the document, and degradation",
  "  prints one stderr JSON line with version and modelCache fields. Results are identical either way.",
  "  CADARA_MODEL_CACHE=off      bypass the cache (default: on).",
  "  CADARA_MODEL_CACHE_TRACE=1  also print hit/miss/published/bypass/evicted events on stderr.",
  "  cadara cache clear          delete every cached entry.",
].join("\n");

function printEvent(io: CliIO, event: ModelCheckpointEvent) {
  io.stderr(JSON.stringify({ version: 1, modelCache: event }) + "\n");
}

function cacheEnvironment(env: CliEnv) {
  const mode = env("CADARA_MODEL_CACHE");
  const trace = env("CADARA_MODEL_CACHE_TRACE");
  if (
    (mode !== undefined && mode !== "on" && mode !== "off") ||
    (trace !== undefined && trace !== "0" && trace !== "1")
  ) {
    return {
      invalid:
        "CADARA_MODEL_CACHE must be on or off, and CADARA_MODEL_CACHE_TRACE 0 or 1.",
    } as const;
  }
  return { enabled: mode !== "off", trace: trace === "1" } as const;
}

/** A usage error for invalid cache settings, before any work starts. */
export function invalidModelCacheEnvironment(env: CliEnv) {
  const settings = cacheEnvironment(env);
  return "invalid" in settings ? settings.invalid : null;
}

/** The store for one recipe process, or undefined when the cache is off or unavailable. */
export function createCliModelCheckpointStore(
  env: CliEnv,
  io: CliIO,
  fingerprint: () => Promise<string | null>,
): ModelCheckpointStore | undefined {
  const settings = cacheEnvironment(env);
  if ("invalid" in settings) throw new Error(settings.invalid);
  const report = (event: ModelCheckpointEvent) => {
    if (settings.trace || event.kind === "degraded") printEvent(io, event);
  };
  if (!settings.enabled) {
    report({ kind: "bypass", reason: "disabled-by-environment" });
    return undefined;
  }
  const root = resolveModelCheckpointCacheRoot(env);
  if (!root) {
    report({ kind: "bypass", reason: "no-cache-directory" });
    return undefined;
  }
  // The store refuses a cache it cannot prove private (Windows has no uid):
  // a permanent platform condition, not a per-open degradation.
  if (typeof process.getuid !== "function") {
    report({ kind: "bypass", reason: "no-user-ownership-checks" });
    return undefined;
  }
  return createFileModelCheckpointStore({ root, fingerprint, report });
}

export const cacheClearCommand: CommandModule = {
  name: "cache clear",
  description:
    "Delete every cached model checkpoint (see `document recipe --help`)",
  async run(argv, env, io) {
    const root = resolveModelCheckpointCacheRoot(env);
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) {
      io.stdout(
        `Usage: cadara cache clear\nDeletes every entry under ${root ?? "(no cache directory: set HOME or XDG_CACHE_HOME)"}.\n\n${modelCacheHelp}\n`,
      );
      return { ok: true };
    }
    if (argv.length)
      return { ok: false, kind: "usage", message: "Usage: cadara cache clear" };
    if (!root)
      return {
        ok: false,
        kind: "failure",
        message: "No cache directory: set HOME or an absolute XDG_CACHE_HOME.",
      };
    const store = createFileModelCheckpointStore({
      root,
      fingerprint: () => Promise.resolve(null),
      report: (event) => printEvent(io, event),
    });
    let removed: number;
    try {
      removed = await store.clear();
    } catch (error) {
      if (!isModelCheckpointCacheFailure(error)) throw error;
      return {
        ok: false,
        kind: "failure",
        message: `Cache clear failed: ${(error as Error).message}`,
      };
    }
    io.stdout(JSON.stringify({ version: 1, root, removed }) + "\n");
    return { ok: true };
  },
};
