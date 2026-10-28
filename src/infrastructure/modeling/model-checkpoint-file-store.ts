import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
  ModelCheckpoint,
  ModelCheckpointEvent,
  ModelCheckpointStore,
} from "@/infrastructure/persistence/model-checkpoint-store";
import { OCC_ASSET_VERSION } from "@/infrastructure/occ/assets";
import {
  validateModelCheckpointEntryManifest,
  validateModelCheckpointShapeRecords,
  type ModelCheckpointEntryManifest,
} from "@/infrastructure/modeling/model-checkpoint-file-store.runtime-schema";

/**
 * cadara-3sq.6: the per-user filesystem model checkpoint cache.
 *
 * Layout under `<root>` (normally ~/.cache/cadara/model-checkpoints):
 * `entries/<key>.checkpoint` holds one complete entry (a JSON manifest line,
 * then the body members) and `tmp/` holds in-progress writes. An entry becomes
 * visible only through an atomic rename of a fully written, synced file, so a
 * reader sees a complete entry or none. Every directory is private (0700, owned
 * by the current user, not a symlink) and entry files are opened without
 * following symlinks; anything else is refused. Entry files are untrusted
 * input: the manifest is validated exactly, the body must match its SHA-256
 * and its key/compatibility, and the shape records are validated before the
 * adapter decodes and re-validates the state. A checksum detects corruption;
 * it does not authenticate the data.
 */

const ENTRY_FORMAT: ModelCheckpointEntryManifest["format"] =
  "cadara-model-checkpoint-entry/v1";
const ENTRY_SUFFIX = ".checkpoint";
const ENTRY_NAME = /^[0-9a-f]{64}\.checkpoint$/;
const TEMPORARY_NAME = /^[0-9a-f]{64}\.[0-9a-f-]{36}\.partial$/;
const KEY = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 4096;
/** Largest single entry read or written (the public enclosure is ~13 MB). */
export const MODEL_CHECKPOINT_MAX_ENTRY_BYTES = 256 * 1024 * 1024;
/** Retention bound: least recently used entries are evicted above it. */
export const MODEL_CHECKPOINT_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
/** Temporary files older than this belong to interrupted writers. */
const STALE_TEMPORARY_MS = 60 * 60 * 1000;

/** A filesystem failure: its errno code is the diagnostic, never a crash. */
function systemErrorCode(error: unknown) {
  return error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
    ? (error as NodeJS.ErrnoException).code!
    : null;
}

/** A refused cache location or failed cache IO: a cache diagnostic, never a modelling failure. */
export function isModelCheckpointCacheFailure(error: unknown) {
  return (
    error instanceof ModelCheckpointCacheError ||
    systemErrorCode(error) !== null
  );
}

/** A refused or unusable cache location; reported as degradation, never thrown to the open. */
class ModelCheckpointCacheError extends Error {
  readonly reason: "unsafe-cache" | "unfingerprinted-runtime" | "write-failed";
  constructor(reason: ModelCheckpointCacheError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * The cache root from the environment: `$XDG_CACHE_HOME/cadara/model-checkpoints`
 * when XDG_CACHE_HOME is absolute (the XDG rule), else
 * `$HOME/.cache/cadara/model-checkpoints`; null without either.
 */
export function resolveModelCheckpointCacheRoot(
  env: (name: string) => string | undefined,
) {
  const xdg = env("XDG_CACHE_HOME");
  const home = env("HOME");
  const base =
    xdg && isAbsolute(xdg)
      ? xdg
      : home && isAbsolute(home)
        ? join(home, ".cache")
        : null;
  return base ? join(base, "cadara", "model-checkpoints") : null;
}

/** Creates (0700) or checks one cache-owned directory; refuses anything unsafe. */
async function ensurePrivateDirectory(path: string) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (systemErrorCode(error) !== "EEXIST") throw error;
  }
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new ModelCheckpointCacheError(
      "unsafe-cache",
      `${path} is not a real directory.`,
    );
  }
  if (stats.uid !== process.getuid!() || (stats.mode & 0o022) !== 0) {
    throw new ModelCheckpointCacheError(
      "unsafe-cache",
      `${path} is not private to the current user (owner or group/other write access).`,
    );
  }
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The compatibility digest of the running CLI: the entry format, the
 * production kernel's actual JS/WASM bytes (and the checked-in
 * OCC_ASSET_VERSION they were built as), every JS file of the running bundle
 * (the evaluator, solver and naming code) and the runtime/platform. Any
 * change misses.
 */
export async function fingerprintModelCheckpointRuntime(input: {
  assetDirectory: string;
  codeDirectory: string;
}) {
  const kernel: [string, string][] = [];
  for (const name of ["cadara-occ.js", "cadara-occ.wasm"]) {
    kernel.push([
      name,
      sha256(await readFile(join(input.assetDirectory, name))),
    ]);
  }
  const code: [string, string][] = [];
  for (const name of (await readdir(input.codeDirectory)).sort()) {
    if (name.endsWith(".js")) {
      code.push([
        name,
        sha256(await readFile(join(input.codeDirectory, name))),
      ]);
    }
  }
  if (!code.length) {
    throw new ModelCheckpointCacheError(
      "unfingerprinted-runtime",
      `${input.codeDirectory} holds no JavaScript.`,
    );
  }
  return sha256(
    new TextEncoder().encode(
      JSON.stringify({
        entryFormat: ENTRY_FORMAT,
        occAssetVersion: OCC_ASSET_VERSION,
        kernel,
        code,
        runtime: {
          versions: process.versions,
          platform: process.platform,
          arch: process.arch,
        },
      }),
    ),
  );
}

export interface FileModelCheckpointStore extends ModelCheckpointStore {
  /** Removes every entry and temporary file; returns how many were removed. */
  clear(): Promise<number>;
}

export function createFileModelCheckpointStore(options: {
  root: string;
  /** Hex SHA-256 of the runtime (see fingerprintModelCheckpointRuntime), or null when it has none. */
  fingerprint: () => Promise<string | null>;
  report: (event: ModelCheckpointEvent) => void;
  maxBytes?: number;
}): FileModelCheckpointStore {
  const { root, report } = options;
  const maxBytes = options.maxBytes ?? MODEL_CHECKPOINT_CACHE_MAX_BYTES;
  const entries = join(root, "entries");
  const temporary = join(root, "tmp");
  let compatibility: Promise<string | null> | null = null;

  async function ensureDirectories() {
    if (typeof process.getuid !== "function") {
      throw new ModelCheckpointCacheError(
        "unsafe-cache",
        "the platform has no user ownership checks.",
      );
    }
    await mkdir(join(root, "..", ".."), { recursive: true, mode: 0o700 });
    for (const path of [join(root, ".."), root, entries, temporary]) {
      await ensurePrivateDirectory(path);
    }
  }

  /** Reports a known cache failure; anything else is a defect and propagates. */
  function degraded(key: string | null, error: unknown) {
    const code = systemErrorCode(error);
    if (!(error instanceof ModelCheckpointCacheError) && code === null)
      throw error;
    report({
      kind: "degraded",
      key,
      reason:
        error instanceof ModelCheckpointCacheError
          ? `${error.reason}: ${error.message}`
          : `${code}: ${(error as Error).message}`,
    });
  }

  function entryPath(key: string) {
    if (!KEY.test(key)) throw new Error(`Invalid model checkpoint key ${key}.`);
    return join(entries, key + ENTRY_SUFFIX);
  }

  /** The entry's bytes, touched for retention; null when absent, a string when unusable. */
  async function readEntryBytes(key: string) {
    let handle: FileHandle;
    try {
      handle = await open(
        entryPath(key),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (systemErrorCode(error) === "ENOENT") return null;
      if (systemErrorCode(error) === "ELOOP") {
        throw new ModelCheckpointCacheError(
          "unsafe-cache",
          `entry ${key} is a symlink.`,
        );
      }
      throw error;
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.uid !== process.getuid!()) {
        throw new ModelCheckpointCacheError(
          "unsafe-cache",
          `entry ${key} is not a regular file owned by the current user.`,
        );
      }
      if (stats.size > MODEL_CHECKPOINT_MAX_ENTRY_BYTES) {
        return `entry exceeds ${MODEL_CHECKPOINT_MAX_ENTRY_BYTES} bytes.`;
      }
      const bytes = new Uint8Array(await handle.readFile());
      // Least-recently-used retention orders entries by modification time.
      try {
        const now = new Date();
        await handle.utimes(now, now);
      } catch (error) {
        degraded(key, error);
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  /** Parses untrusted entry bytes; a string is the reason they are unusable. */
  function parseEntry(
    key: string,
    expectedCompatibility: string,
    bytes: Uint8Array,
  ): ModelCheckpoint | string {
    const newline = bytes.subarray(0, MAX_MANIFEST_BYTES).indexOf(10);
    if (newline < 0) return "no manifest line.";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let manifestInput: unknown;
    try {
      manifestInput = JSON.parse(decoder.decode(bytes.subarray(0, newline)));
    } catch (error) {
      return `unreadable manifest (${(error as Error).message}).`;
    }
    const validated = validateModelCheckpointEntryManifest(manifestInput);
    if (!validated.success) {
      return `invalid manifest at ${validated.issues.map((issue) => issue.path || "manifest").join(", ")}.`;
    }
    const manifest = validated.data;
    if (manifest.key !== key) return "the manifest names another key.";
    if (manifest.compatibility !== expectedCompatibility) {
      return "the manifest names another build/runtime.";
    }
    const body = bytes.subarray(newline + 1);
    const { graph, shapes, brep, exportedDocument } = manifest.members;
    if (body.length !== graph + shapes + brep + exportedDocument) {
      return "the body does not have its recorded length (truncated or extended).";
    }
    if (sha256(body) !== manifest.sha256)
      return "the body checksum does not match.";
    const members: string[] = [];
    let offset = 0;
    try {
      for (const length of [graph, shapes, brep, exportedDocument]) {
        members.push(decoder.decode(body.subarray(offset, offset + length)));
        offset += length;
      }
    } catch (error) {
      return `a member is not UTF-8 (${(error as Error).message}).`;
    }
    let shapeInput: unknown;
    try {
      shapeInput = JSON.parse(members[1]!);
    } catch (error) {
      return `unreadable shape records (${(error as Error).message}).`;
    }
    const records = validateModelCheckpointShapeRecords(shapeInput);
    if (!records.success) return "invalid shape records.";
    return {
      graph: members[0]!,
      shapes: records.data,
      brep: members[2]!,
      exportedDocument: members[3]!,
    };
  }

  async function enforceRetention(keep: string) {
    const listed: { name: string; size: number; mtimeMs: number }[] = [];
    for (const name of await readdir(entries)) {
      if (!ENTRY_NAME.test(name)) continue;
      const stats = await lstat(join(entries, name)).catch((error: unknown) => {
        // Concurrently evicted by another process.
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
      });
      if (stats?.isFile())
        listed.push({ name, size: stats.size, mtimeMs: stats.mtimeMs });
    }
    let total = listed.reduce((sum, entry) => sum + entry.size, 0);
    const evicted: string[] = [];
    for (const entry of listed.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= maxBytes) break;
      if (entry.name === keep + ENTRY_SUFFIX) continue;
      await removeOwnedFile(join(entries, entry.name));
      total -= entry.size;
      evicted.push(entry.name.slice(0, -ENTRY_SUFFIX.length));
    }
    if (evicted.length) report({ kind: "evicted", keys: evicted });
    const now = Date.now();
    for (const name of await readdir(temporary)) {
      if (!TEMPORARY_NAME.test(name)) continue;
      const stats = await lstat(join(temporary, name)).catch(
        (error: unknown) => {
          if (systemErrorCode(error) === "ENOENT") return null;
          throw error;
        },
      );
      if (stats?.isFile() && now - stats.mtimeMs > STALE_TEMPORARY_MS) {
        await removeOwnedFile(join(temporary, name));
      }
    }
  }

  /** Unlinks one cache file (never a directory or symlink target); concurrent removal is fine. */
  async function removeOwnedFile(path: string) {
    try {
      await unlink(path);
    } catch (error) {
      if (systemErrorCode(error) !== "ENOENT") throw error;
    }
  }

  async function writeTemporary(path: string, chunks: readonly Uint8Array[]) {
    const handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      for (const chunk of chunks) {
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(
            chunk,
            written,
            chunk.length - written,
          );
          if (!result.bytesWritten)
            throw new ModelCheckpointCacheError(
              "write-failed",
              "the cache write made no progress.",
            );
          written += result.bytesWritten;
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  const store: FileModelCheckpointStore = {
    compatibility() {
      compatibility ??= options.fingerprint().catch((error: unknown) => {
        degraded(null, error);
        return null;
      });
      return compatibility;
    },
    report,
    async read(key) {
      const expected = await store.compatibility();
      if (expected === null) return null;
      let read: Awaited<ReturnType<typeof readEntryBytes>>;
      try {
        await ensureDirectories();
        read = await readEntryBytes(key);
      } catch (error) {
        degraded(key, error);
        return null;
      }
      if (read === null) {
        report({ kind: "miss", key, reason: "absent" });
        return null;
      }
      const parsed =
        typeof read === "string" ? read : parseEntry(key, expected, read);
      if (typeof parsed === "string") {
        report({ kind: "degraded", key, reason: `corrupt-entry: ${parsed}` });
        return null;
      }
      return parsed;
    },
    async publish(key, checkpoint) {
      const expected = await store.compatibility();
      if (expected === null) return;
      const encoder = new TextEncoder();
      const members = [
        checkpoint.graph,
        JSON.stringify(checkpoint.shapes),
        checkpoint.brep,
        checkpoint.exportedDocument,
      ].map((member) => encoder.encode(member));
      const hash = createHash("sha256");
      for (const member of members) hash.update(member);
      const manifest: ModelCheckpointEntryManifest = {
        format: ENTRY_FORMAT,
        key,
        compatibility: expected,
        members: {
          graph: members[0]!.length,
          shapes: members[1]!.length,
          brep: members[2]!.length,
          exportedDocument: members[3]!.length,
        },
        sha256: hash.digest("hex"),
      };
      const chunks = [
        encoder.encode(JSON.stringify(manifest) + "\n"),
        ...members,
      ];
      const bytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (bytes > MODEL_CHECKPOINT_MAX_ENTRY_BYTES) {
        report({ kind: "bypass", reason: "checkpoint-exceeds-entry-bound" });
        return;
      }
      const target = entryPath(key);
      const partial = join(temporary, `${key}.${randomUUID()}.partial`);
      try {
        await ensureDirectories();
        await writeTemporary(partial, chunks);
        // Atomic: readers see the previous complete entry or this one.
        await rename(partial, target);
      } catch (error) {
        try {
          await removeOwnedFile(partial);
        } catch (cleanupError) {
          degraded(key, cleanupError);
        }
        degraded(key, error);
        return;
      }
      report({ kind: "published", key, bytes });
      try {
        await enforceRetention(key);
      } catch (error) {
        degraded(null, error);
      }
    },
    async clear() {
      await ensureDirectories();
      let removed = 0;
      for (const [directory, pattern] of [
        [entries, ENTRY_NAME],
        [temporary, TEMPORARY_NAME],
      ] as const) {
        for (const name of await readdir(directory)) {
          if (!pattern.test(name)) continue;
          const stats = await lstat(join(directory, name)).catch(
            (error: unknown) => {
              // Concurrently evicted by another process: already removed.
              if (systemErrorCode(error) === "ENOENT") return null;
              throw error;
            },
          );
          if (!stats?.isFile()) continue;
          await removeOwnedFile(join(directory, name));
          removed += 1;
        }
      }
      return removed;
    },
  };
  return store;
}
