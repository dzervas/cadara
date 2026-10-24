// cadara-3sq.6. Logic lane (docs/testing.md, infrastructure adapter
// conformance): the filesystem ModelCheckpointStore treats entry files as
// untrusted input, publishes atomically, refuses unsafe locations and reports
// every cache failure as a bounded diagnostic instead of throwing.
import fs from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModelCheckpoint,
  ModelCheckpointEvent,
} from "@/domain/modeling/model-checkpoint-store";
import {
  createFileModelCheckpointStore,
  fingerprintModelCheckpointRuntime,
  resolveModelCheckpointCacheRoot,
} from "@/infrastructure/modeling/model-checkpoint-file-store";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const BUILD = "c".repeat(64);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeStore(
  options: {
    fingerprint?: () => Promise<string | null>;
    maxBytes?: number;
    base?: string;
  } = {},
) {
  const base =
    options.base ?? (await mkdtemp(join(tmpdir(), "cadara-model-cache-")));
  if (!options.base) directories.push(base);
  const root = join(base, "cadara", "model-checkpoints");
  const events: ModelCheckpointEvent[] = [];
  const store = createFileModelCheckpointStore({
    root,
    fingerprint: options.fingerprint ?? (async () => BUILD),
    report: (event) => events.push(event),
    maxBytes: options.maxBytes,
  });
  return { base, root, store, events };
}

function checkpoint(tag: string, size = 16): ModelCheckpoint {
  return {
    graph: JSON.stringify({ o: [["tag", tag]] }),
    shapes: [
      {
        wrapper: "TopoDS_Solid",
        isNull: false,
        shapeType: 2,
        orientation: 0,
        mapIndex: 0,
      },
    ],
    brep: `${tag}:${"x".repeat(size)}`,
    exportedDocument: JSON.stringify({ name: tag, unicode: "αβγ" }),
  };
}

const entryFile = (root: string, key: string) =>
  join(root, "entries", `${key}.checkpoint`);
const kinds = (events: ModelCheckpointEvent[]) =>
  events.map((event) => event.kind);

describe("filesystem model checkpoint store", () => {
  it("round-trips a published entry exactly, privately, and reports an absent key as a miss", async () => {
    const { root, store, events } = await makeStore();
    expect(await store.read(KEY_A)).toBeNull();
    expect(events).toEqual([{ kind: "miss", key: KEY_A, reason: "absent" }]);

    const published = checkpoint("one");
    await store.publish(KEY_A, published);
    expect(await store.read(KEY_A)).toEqual(published);
    expect(kinds(events)).toEqual(["miss", "published"]);
    expect((await stat(entryFile(root, KEY_A))).mode & 0o777).toBe(0o600);
    for (const directory of [
      join(root, ".."),
      root,
      join(root, "entries"),
      join(root, "tmp"),
    ]) {
      expect((await stat(directory)).mode & 0o777, directory).toBe(0o700);
    }
  });

  it.each([
    ["truncated", (bytes: Buffer) => bytes.subarray(0, bytes.length - 7)],
    ["extended", (bytes: Buffer) => Buffer.concat([bytes, Buffer.from("x")])],
    [
      "bit-flipped (still valid UTF-8 and JSON)",
      (bytes: Buffer) => {
        const copy = Buffer.from(bytes);
        // One "x" of the shape-set member becomes "y": only the checksum can tell.
        copy[copy.lastIndexOf("x")]! ^= 1;
        return copy;
      },
    ],
    ["manifest-less", () => Buffer.from("x".repeat(5000))],
    ["empty", () => Buffer.alloc(0)],
    [
      "non-JSON manifest",
      (bytes: Buffer) => Buffer.concat([Buffer.from("{nope\n"), bytes]),
    ],
  ])(
    "never returns a %s entry: it reports a corrupt-entry degradation",
    async (_name, corrupt) => {
      const { root, store, events } = await makeStore();
      await store.publish(KEY_A, checkpoint("one"));
      await writeFile(
        entryFile(root, KEY_A),
        corrupt(await readFile(entryFile(root, KEY_A))),
      );
      expect(await store.read(KEY_A)).toBeNull();
      expect(events.at(-1)).toMatchObject({
        kind: "degraded",
        key: KEY_A,
        reason: expect.stringMatching(/^corrupt-entry: /),
      });
    },
  );

  /** Rewrites the manifest line (keeping a valid body checksum unless the edit touches it). */
  async function rewriteManifest(
    root: string,
    key: string,
    edit: (manifest: Record<string, unknown>) => void,
  ) {
    const bytes = await readFile(entryFile(root, key));
    const newline = bytes.indexOf(10);
    const manifest = JSON.parse(
      bytes.subarray(0, newline).toString("utf8"),
    ) as Record<string, unknown>;
    edit(manifest);
    await writeFile(
      entryFile(root, key),
      Buffer.concat([
        Buffer.from(JSON.stringify(manifest) + "\n"),
        bytes.subarray(newline + 1),
      ]),
    );
  }

  it.each([
    [
      "names another key",
      (manifest: Record<string, unknown>) => {
        manifest.key = KEY_B;
      },
      /another key/,
    ],
    [
      "names another build",
      (manifest: Record<string, unknown>) => {
        manifest.compatibility = "d".repeat(64);
      },
      /another build/,
    ],
    [
      "has an unknown field",
      (manifest: Record<string, unknown>) => {
        manifest.extra = 1;
      },
      /invalid manifest/,
    ],
    [
      "has another format",
      (manifest: Record<string, unknown>) => {
        manifest.format = "cadara-model-checkpoint-entry/v0";
      },
      /invalid manifest/,
    ],
    [
      "has a negative member length",
      (manifest: Record<string, unknown>) => {
        (manifest.members as Record<string, number>).graph = -1;
      },
      /invalid manifest/,
    ],
  ])("refuses an entry whose manifest %s", async (_name, edit, reason) => {
    const { root, store, events } = await makeStore();
    await store.publish(KEY_A, checkpoint("one"));
    await rewriteManifest(root, KEY_A, edit);
    expect(await store.read(KEY_A)).toBeNull();
    expect(events.at(-1)).toMatchObject({
      kind: "degraded",
      key: KEY_A,
      reason: expect.stringMatching(reason),
    });
  });

  it("refuses a checksummed entry whose shape records are not the validated record shape", async () => {
    const { root, store, events } = await makeStore();
    const bad = {
      ...checkpoint("one"),
      shapes: [
        {
          wrapper: "TopoDS_Solid",
          isNull: false,
          shapeType: 2,
          orientation: 0,
          mapIndex: 0,
          extra: true,
        },
      ],
    } as unknown as ModelCheckpoint;
    await store.publish(KEY_A, bad);
    expect(await store.read(KEY_A)).toBeNull();
    expect(events.at(-1)).toMatchObject({
      kind: "degraded",
      reason: "corrupt-entry: invalid shape records.",
    });
    // Moving an entry to another key's file name is detected too.
    await store.publish(KEY_B, checkpoint("two"));
    await writeFile(
      entryFile(root, KEY_A),
      await readFile(entryFile(root, KEY_B)),
    );
    expect(await store.read(KEY_A)).toBeNull();
    expect(events.at(-1)).toMatchObject({
      kind: "degraded",
      reason: "corrupt-entry: the manifest names another key.",
    });
  });

  it("never exposes an interrupted write, and removes only stale temporary files", async () => {
    const { root, store, events } = await makeStore();
    await store.publish(KEY_B, checkpoint("seed"));
    const stale = join(
      root,
      "tmp",
      `${KEY_A}.00000000-0000-0000-0000-000000000000.partial`,
    );
    const fresh = join(
      root,
      "tmp",
      `${KEY_A}.11111111-1111-1111-1111-111111111111.partial`,
    );
    const half = (await readFile(entryFile(root, KEY_B))).subarray(0, 40);
    await writeFile(stale, half);
    await writeFile(fresh, half);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    expect(
      await store.read(KEY_A),
      "a partial write is not an entry",
    ).toBeNull();
    expect(events.at(-1)).toMatchObject({ kind: "miss", key: KEY_A });

    await store.publish(KEY_A, checkpoint("complete"));
    expect(await store.read(KEY_A)).toEqual(checkpoint("complete"));
    expect((await readdir(join(root, "tmp"))).sort()).toEqual([
      `${KEY_A}.11111111-1111-1111-1111-111111111111.partial`,
    ]);
  });

  it("lets concurrent same-key writers and readers observe only a complete entry or a miss", async () => {
    const { store } = await makeStore();
    const versions = ["one", "two", "three", "four"].map((tag) =>
      checkpoint(tag, 200_000),
    );
    const reads: (ModelCheckpoint | null)[] = [];
    await Promise.all([
      ...versions.map((version) => store.publish(KEY_A, version)),
      ...Array.from({ length: 8 }, async () => {
        reads.push(await store.read(KEY_A));
      }),
    ]);
    reads.push(await store.read(KEY_A));
    for (const read of reads) {
      if (read !== null) expect(versions).toContainEqual(read);
    }
    expect(reads.at(-1)).not.toBeNull();
  });

  it("refuses a symlinked cache directory or entry, and never writes through it", async () => {
    const { base, root, store, events } = await makeStore();
    await store.publish(KEY_A, checkpoint("one"));
    const elsewhere = await mkdtemp(
      join(tmpdir(), "cadara-model-cache-elsewhere-"),
    );
    directories.push(elsewhere);
    await rm(join(root, "entries"), { recursive: true });
    await symlink(elsewhere, join(root, "entries"));
    expect(await store.read(KEY_A)).toBeNull();
    await store.publish(KEY_B, checkpoint("two"));
    expect(events.slice(-2)).toMatchObject([
      {
        kind: "degraded",
        reason: expect.stringMatching(/^unsafe-cache: .*not a real directory/),
      },
      { kind: "degraded", reason: expect.stringMatching(/^unsafe-cache: /) },
    ]);
    expect(await readdir(elsewhere)).toEqual([]);

    const fresh = await makeStore({ base });
    await rm(join(root, "entries"));
    await mkdir(join(root, "entries"), { mode: 0o700 });
    await writeFile(join(elsewhere, "target"), "x");
    await symlink(join(elsewhere, "target"), entryFile(root, KEY_A));
    expect(await fresh.store.read(KEY_A)).toBeNull();
    expect(fresh.events.at(-1)).toMatchObject({
      kind: "degraded",
      reason: expect.stringMatching(/symlink/),
    });
  });

  it("refuses a cache directory that other users can write", async () => {
    const { root, store, events } = await makeStore();
    await store.publish(KEY_A, checkpoint("one"));
    await chmod(root, 0o777);
    expect(await store.read(KEY_A)).toBeNull();
    expect(events.at(-1)).toMatchObject({
      kind: "degraded",
      reason: expect.stringMatching(/not private/),
    });
  });

  it("reports an unwritable cache as degraded instead of failing the caller", async () => {
    const { root, store, events } = await makeStore();
    await store.publish(KEY_A, checkpoint("one"));
    await chmod(join(root, "tmp"), 0o500);
    await store.publish(KEY_B, checkpoint("two"));
    expect(events.at(-1)).toMatchObject({
      kind: "degraded",
      key: KEY_B,
      reason: expect.stringMatching(/^EACCES: /),
    });
    // Reading published entries still works.
    expect(await store.read(KEY_A)).toEqual(checkpoint("one"));
    await chmod(join(root, "tmp"), 0o700);
  });

  it("evicts least recently used entries above its bound, keeping the one just published", async () => {
    const { root, store, events } = await makeStore({ maxBytes: 3000 });
    await store.publish(KEY_A, checkpoint("old", 1000));
    const old = new Date(Date.now() - 60_000);
    await utimes(entryFile(root, KEY_A), old, old);
    await store.publish(KEY_B, checkpoint("new", 1000));
    expect(events.at(-1)).toEqual({
      kind: "published",
      key: KEY_B,
      bytes: expect.any(Number),
    });
    const third = "e".repeat(64);
    await store.publish(third, checkpoint("third", 1000));
    expect(events.at(-1)).toEqual({ kind: "evicted", keys: [KEY_A] });
    expect((await readdir(join(root, "entries"))).sort()).toEqual([
      `${KEY_B}.checkpoint`,
      `${third}.checkpoint`,
    ]);
  });

  it("reports a write that makes no progress as degraded instead of failing the caller", async () => {
    const { base, store, events } = await makeStore();
    // Every FileHandle shares one prototype; a probe handle exposes it.
    const probe = await open(join(base, "probe"), "w");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    await probe.close();
    const write = vi
      .spyOn(prototype, "write")
      // `never`: write's string overload is the one TypeScript infers here.
      .mockResolvedValue({
        bytesWritten: 0,
        buffer: new Uint8Array(),
      } as never);
    try {
      await store.publish(KEY_A, checkpoint("one"));
    } finally {
      write.mockRestore();
    }
    expect(events.at(-1)).toEqual({
      kind: "degraded",
      key: KEY_A,
      reason: "write-failed: the cache write made no progress.",
    });
    expect(await store.read(KEY_A)).toBeNull();
  });

  it("clears an entry that another process removes concurrently", async () => {
    const { root, store } = await makeStore();
    await store.publish(KEY_A, checkpoint("one"));
    await store.publish(KEY_B, checkpoint("two"));
    // The concurrent remover: KEY_B vanishes between the listing and its stat.
    const promises = fs.promises as unknown as Record<string, unknown>;
    const lstat = promises.lstat as typeof fs.promises.lstat;
    promises.lstat = async (path: string) => {
      if (path === entryFile(root, KEY_B)) await rm(path);
      return lstat(path);
    };
    syncBuiltinESMExports();
    try {
      expect(await store.clear()).toBe(1);
    } finally {
      promises.lstat = lstat;
      syncBuiltinESMExports();
    }
    expect(await readdir(join(root, "entries"))).toEqual([]);
  });

  it("clears entries and temporary files only", async () => {
    const { root, store } = await makeStore();
    await store.publish(KEY_A, checkpoint("one"));
    await writeFile(
      join(
        root,
        "tmp",
        `${KEY_B}.00000000-0000-0000-0000-000000000000.partial`,
      ),
      "x",
    );
    await writeFile(join(root, "entries", "notes.txt"), "kept");
    expect(await store.clear()).toBe(2);
    expect(await readdir(join(root, "entries"))).toEqual(["notes.txt"]);
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });

  it("bypasses every entry when the runtime cannot be fingerprinted", async () => {
    let fails = true;
    const { store, events } = await makeStore({
      fingerprint: async () => {
        if (fails) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return BUILD;
      },
    });
    expect(await store.compatibility()).toBeNull();
    expect(await store.read(KEY_A)).toBeNull();
    await store.publish(KEY_A, checkpoint("one"));
    fails = false;
    expect(events).toEqual([
      { kind: "degraded", key: null, reason: "ENOENT: gone" },
    ]);
  });

  it("propagates a failure that is not a cache failure", async () => {
    const { store } = await makeStore({
      fingerprint: async () => {
        throw new TypeError("defect");
      },
    });
    await expect(store.compatibility()).rejects.toThrow("defect");
  });
});

describe("model checkpoint runtime fingerprint", () => {
  it("changes with any bundled JS file, either kernel asset or nothing else", async () => {
    const base = await mkdtemp(
      join(tmpdir(), "cadara-model-cache-fingerprint-"),
    );
    directories.push(base);
    const assets = join(base, "occ");
    await mkdir(assets);
    await writeFile(join(assets, "cadara-occ.js"), "js");
    await writeFile(join(assets, "cadara-occ.wasm"), "wasm");
    await writeFile(join(base, "main.js"), "main");
    await writeFile(join(base, "chunk-1.js"), "chunk");
    await writeFile(join(base, "README.md"), "docs");
    const fingerprint = () =>
      fingerprintModelCheckpointRuntime({
        assetDirectory: assets,
        codeDirectory: base,
      });
    const first = await fingerprint();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(join(base, "README.md"), "other docs");
    expect(await fingerprint()).toBe(first);
    const seen = new Set([first]);
    for (const [path, bytes] of [
      [join(base, "chunk-1.js"), "chunk!"],
      [join(base, "chunk-2.js"), "new chunk"],
      [join(assets, "cadara-occ.wasm"), "wasm!"],
      [join(assets, "cadara-occ.js"), "js!"],
    ] as const) {
      await writeFile(path, bytes);
      const next = await fingerprint();
      expect(seen.has(next), path).toBe(false);
      seen.add(next);
    }
  });
});

describe("model checkpoint cache root", () => {
  it("uses an absolute XDG_CACHE_HOME, else ~/.cache, else none", () => {
    const env = (values: Record<string, string>) => (name: string) =>
      values[name];
    expect(
      resolveModelCheckpointCacheRoot(
        env({ XDG_CACHE_HOME: "/x/cache", HOME: "/home/u" }),
      ),
    ).toBe("/x/cache/cadara/model-checkpoints");
    expect(
      resolveModelCheckpointCacheRoot(
        env({ XDG_CACHE_HOME: "relative", HOME: "/home/u" }),
      ),
    ).toBe("/home/u/.cache/cadara/model-checkpoints");
    expect(resolveModelCheckpointCacheRoot(env({}))).toBeNull();
  });
});
