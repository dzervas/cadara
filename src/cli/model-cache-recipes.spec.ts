// cadara-3sq.6. Logic lane, CLI tier (docs/testing.md): the released CLI's
// per-user model checkpoint cache, across separate real processes sharing one
// temporary XDG cache. A warm process adopts the checkpoint a cold process
// published (the trace `hit` is emitted only when the adapter adopts a
// checkpoint instead of replaying the history; the replay-free adoption itself
// is counted in opencascade-kernel-adapter.model-checkpoint.heavy.spec.ts) and
// then behaves exactly like a cold or cache-bypassed process; anything that
// changes the evaluation inputs or the build misses; corrupt entries, failed
// builds and foreign bases never yield cached or foreign state.
import { expect, it } from "vitest";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import type { ModelCheckpointEvent } from "@/domain/modeling/model-checkpoint-store";
import { createCliModelCheckpointStore } from "@/cli/commands/model-cache";
import type { CliIO } from "@/cli/types";
import {
  cliEntry,
  copyCliRuntimeWithoutAssets,
  invokeCliDocumentRecipe,
  invokeCliRecipe,
} from "../../test/helpers/cli-recipe-process";

const root = resolve(import.meta.dirname, "../..");
const bracketSource = resolve(root, "landing/examples/bracket/model.cadara");
const BODY = "body_feature_extrude-1";
/** A straight edge of the opened public bracket that the earlier edit keeps. */
const NEW_CHAMFER_EDGE = "edge_body_feature_extrude-1_ge3da1b31f4e5ea2c";

type Envelope = {
  results: SemanticResult[];
  cleanup: { kind: string };
  unexecuted: string[];
};
interface Run {
  code: number;
  stdout: string;
  envelope: Envelope;
  events: ModelCheckpointEvent[];
  /** stderr lines that are not model cache events. */
  otherStderr: string[];
}

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "cadara-model-cache-cli-"));
  const bracket = join(directory, "bracket.cadara");
  await copyFile(bracketSource, bracket);
  return { directory, bracket, cache: join(directory, "xdg-cache") };
}

async function run(
  directory: string,
  operations: readonly Record<string, unknown>[],
  env: Record<string, string>,
  entry = cliEntry(),
): Promise<Run> {
  const process_ = await invokeCliRecipe(
    directory,
    operations.map((operation) => ({ version: 1, ...operation })),
    {
      cwd: root,
      entry,
      timeout: 180000,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: "production",
        TEST: "false",
        // The heavy tier turns the cache off for every other CLI spec.
        CADARA_MODEL_CACHE: "on",
        CADARA_MODEL_CACHE_TRACE: "1",
        ...env,
      },
    },
  );
  const events: ModelCheckpointEvent[] = [];
  const otherStderr: string[] = [];
  for (const line of process_.stderr.split("\n").filter(Boolean)) {
    const parsed = line.startsWith("{")
      ? (JSON.parse(line) as { modelCache?: ModelCheckpointEvent })
      : null;
    if (parsed?.modelCache) events.push(parsed.modelCache);
    else otherStderr.push(line);
  }
  return {
    code: process_.code,
    stdout: process_.stdout,
    envelope: JSON.parse(process_.stdout) as Envelope,
    events,
    otherStderr,
  };
}

/** Actor-specific identities: the session document, transactions and repository heads. */
function canonical(stdout: string) {
  return stdout
    .replace(/doc_[0-9a-f-]{36}/g, "doc_session")
    .replace(/transaction_[0-9a-f-]{36}/g, "transaction_session")
    .replace(/memory:[0-9a-f-]{36}/g, "memory:session");
}

/** The fields of the public bracket these rows edit. */
interface BracketDocument {
  features: {
    featureId: string;
    definition: {
      parameters: {
        extent: { end: { distance: { value: number } } };
        options: { distance: { value: number } };
      };
    };
  }[];
}
const feature = (document: BracketDocument, featureId: string) =>
  document.features.find((entry) => entry.featureId === featureId)!;

const kinds = (events: readonly ModelCheckpointEvent[]) =>
  events.map((event) => event.kind);
const outcomes = (result: Run) =>
  result.envelope.results.map((entry) => entry.outcome.kind);
const entries = async (cache: string) =>
  (
    await readdir(join(cache, "cadara", "model-checkpoints", "entries")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      },
    )
  ).sort();
const openOnly = (path: string) => [
  {
    commandId: "open",
    operation: "document.open",
    basis: null,
    path,
    as: "opened",
  },
];
/** Exact body bounds and topology signatures of one result. */
const geometry = (result: Run, index = 0) =>
  JSON.stringify(result.envelope.results[index]!.discovery!.model!.bodies);

it("a warm process adopts the cold process's checkpoint and edits, saves, reopens and exports exactly like a bypassed one", async () => {
  const { directory, bracket, cache } = await workspace();
  try {
    const saved = join(directory, "saved.cadara");
    const stl = join(directory, "bracket.stl");
    const flow = [
      {
        commandId: "open",
        operation: "document.open",
        basis: null,
        path: bracket,
        as: "opened",
      },
      {
        commandId: "inspect",
        operation: "document.inspect",
        basis: { alias: "opened" },
      },
      // Directly on the fresh open: a new tail feature consuming a native edge.
      {
        commandId: "chamfer",
        operation: "chamfer.create",
        basis: { alias: "opened" },
        parameters: {
          participants: [
            {
              role: "edge",
              targets: [
                { kind: "edge", bodyId: BODY, edgeId: NEW_CHAMFER_EDGE },
              ],
            },
          ],
          options: { widthForm: "equalOffsets", distance: 0.5 },
        },
        intent: "fulfill",
        as: "chamfered",
      },
      {
        commandId: "rename",
        operation: "body.rename",
        basis: { alias: "chamfered" },
        bodyId: BODY,
        label: "Cached bracket",
        intent: "fulfill",
        as: "renamed",
      },
      // A substantive edit to the first feature: every downstream feature,
      // including both chamfers' edge references, rebuilds against it.
      {
        commandId: "edit",
        operation: "extrude.update",
        basis: { alias: "renamed" },
        featureId: { alias: "renamed", label: "Extrude 1" },
        depth: 6,
        intent: "fulfill",
        as: "edited",
      },
      {
        commandId: "save",
        operation: "document.save",
        basis: { alias: "edited" },
        path: saved,
      },
      {
        commandId: "reopen",
        operation: "document.open",
        basis: null,
        path: saved,
        as: "reopened",
      },
      {
        commandId: "export",
        operation: "export.stl",
        basis: { alias: "reopened" },
        target: { alias: "reopened", label: "Cached bracket" },
        options: {
          meshAccuracy: { chordTolerance: 0.05, angleToleranceRadians: 0.1 },
          encoding: "binary",
        },
        path: stl,
      },
    ];
    const runs: Record<string, Run> = {};
    const files: Record<string, { saved: string; stl: Buffer }> = {};
    for (const [name, env] of [
      ["cold", { XDG_CACHE_HOME: cache }],
      ["warm", { XDG_CACHE_HOME: cache }],
      ["bypassed", { XDG_CACHE_HOME: cache, CADARA_MODEL_CACHE: "off" }],
    ] as const) {
      const result = await run(directory, flow, env);
      expect(result.code, `${name}: ${result.otherStderr.join("\n")}`).toBe(0);
      expect(outcomes(result), name).toEqual(
        Array(flow.length).fill("completed"),
      );
      expect(result.envelope.unexecuted).toEqual([]);
      expect(result.envelope.cleanup.kind).toBe("closed");
      runs[name] = result;
      files[name] = {
        saved: await readFile(saved, "utf8"),
        stl: await readFile(stl),
      };
    }
    const { cold, warm, bypassed } = runs as Record<
      "cold" | "warm" | "bypassed",
      Run
    >;
    // Cold misses and publishes both opens (the saved file is new content);
    // a later process hits both; the bypassed one never consults the cache.
    expect(kinds(cold.events)).toEqual([
      "miss",
      "published",
      "miss",
      "published",
    ]);
    expect(kinds(warm.events)).toEqual(["hit", "hit"]);
    expect(warm.events.map((event) => "key" in event && event.key)).toEqual(
      cold.events
        .filter((event) => event.kind === "published")
        .map((event) => "key" in event && event.key),
    );
    expect(bypassed.events).toEqual([
      { kind: "bypass", reason: "disabled-by-environment" },
    ]);
    expect(await entries(cache)).toHaveLength(2);

    // Canonical identities, exact topology signatures, bounds, diagnostics
    // and history are identical; only the per-process actor identities differ.
    expect(canonical(warm.stdout)).toBe(canonical(cold.stdout));
    expect(canonical(bypassed.stdout)).toBe(canonical(cold.stdout));
    expect(files.warm!.stl.equals(files.cold!.stl), "exported STL bytes").toBe(
      true,
    );
    expect(
      files.bypassed!.stl.equals(files.cold!.stl),
      "exported STL bytes",
    ).toBe(true);
    expect(canonical(files.warm!.saved)).toBe(canonical(files.cold!.saved));
    expect(canonical(files.bypassed!.saved)).toBe(canonical(files.cold!.saved));

    const documentIds = new Set<string>();
    for (const result of [cold, warm, bypassed]) {
      const states = result.envelope.results.map(
        (entry) => entry.completion.live.state!,
      );
      // Every receipt belongs to this process's own session and accepted state.
      expect(new Set(states.map((state) => state.documentId)).size).toBe(1);
      documentIds.add(states[0]!.documentId);
      const [, , , , edited, save] = result.envelope.results;
      expect(save!.completion.persistence).toMatchObject({
        kind: "committed",
        commandId: "save",
        state: edited!.completion.live.state,
      });
      expect(save!.completion.file).toMatchObject({
        kind: "written",
        path: saved,
      });
      const features = edited!.discovery!.model!.features.map(
        (feature) => feature.featureId,
      );
      expect(new Set(features).size, "no feature id collides").toBe(
        features.length,
      );
      expect(features).toContain("feature_chamfer-2");
      expect(result.envelope.results[6]!.discovery!.references).toContainEqual(
        expect.objectContaining({
          label: "Cached bracket",
          target: { kind: "body", bodyId: BODY },
        }),
      );
    }
    expect(documentIds.size, "each process owns a fresh document session").toBe(
      3,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 600000);

it("misses or refuses whenever content, build or cache integrity changes, and never rescues a missing document", async () => {
  const { directory, bracket, cache } = await workspace();
  try {
    const env = { XDG_CACHE_HOME: cache };
    const mtime = new Date("2026-01-01T00:00:00Z");
    await utimes(bracket, mtime, mtime);
    const cold = await run(directory, openOnly(bracket), env);
    expect(kinds(cold.events)).toEqual(["miss", "published"]);
    const [entryName] = await entries(cache);

    // Same path, size, mtime, document and revision ids; one feature depth
    // differs (5 -> 6). Another key, rebuilt geometry, its own entry.
    const original = await readFile(bracket, "utf8");
    const before = await stat(bracket);
    const document = JSON.parse(original) as BracketDocument;
    expect(
      JSON.stringify(document, null, 2),
      "premise: the fixture is canonical JSON",
    ).toBe(original);
    const distance = feature(document, "feature_extrude-1").definition
      .parameters.extent.end.distance;
    expect(distance.value).toBe(5);
    distance.value = 6;
    const editedText = JSON.stringify(document, null, 2);
    expect(editedText.length).toBe(original.length);
    await writeFile(bracket, editedText);
    await utimes(bracket, mtime, mtime);
    expect((await stat(bracket)).mtimeMs).toBe(before.mtimeMs);
    const edited = await run(directory, openOnly(bracket), env);
    expect(kinds(edited.events)).toEqual(["miss", "published"]);
    expect(
      geometry(edited),
      "the edited document's geometry is rebuilt",
    ).not.toBe(geometry(cold));
    const editedBypass = await run(directory, openOnly(bracket), {
      ...env,
      CADARA_MODEL_CACHE: "off",
    });
    expect(canonical(edited.stdout)).toBe(canonical(editedBypass.stdout));
    await writeFile(bracket, original);
    expect(await entries(cache)).toHaveLength(2);

    // Another build of the same release (one changed JS byte) misses.
    const otherBuild = join(directory, "other-build");
    await mkdir(otherBuild);
    await copyCliRuntimeWithoutAssets(otherBuild);
    await cp(join(dirname(cliEntry()), "occ"), join(otherBuild, "occ"), {
      recursive: true,
    });
    await writeFile(
      join(otherBuild, "main.js"),
      (await readFile(join(otherBuild, "main.js"), "utf8")) +
        "\n// another build\n",
    );
    const rebuilt = await run(
      directory,
      openOnly(bracket),
      env,
      join(otherBuild, "main.js"),
    );
    expect(kinds(rebuilt.events)).toEqual(["miss", "published"]);
    expect(canonical(rebuilt.stdout)).toBe(canonical(cold.stdout));
    expect(await entries(cache)).toHaveLength(3);

    // A truncated entry: an always-printed degradation, the cold result, and
    // a complete entry republished in its place.
    const entryPath = join(
      cache,
      "cadara",
      "model-checkpoints",
      "entries",
      entryName!,
    );
    await truncate(entryPath, (await stat(entryPath)).size - 100);
    const corrupt = await run(directory, openOnly(bracket), {
      XDG_CACHE_HOME: cache,
      CADARA_MODEL_CACHE_TRACE: "0",
    });
    expect(corrupt.code).toBe(0);
    expect(corrupt.events).toEqual([
      expect.objectContaining({
        kind: "degraded",
        reason: expect.stringMatching(/^corrupt-entry: /),
      }),
    ]);
    expect(canonical(corrupt.stdout)).toBe(canonical(cold.stdout));
    expect(
      kinds((await run(directory, openOnly(bracket), env)).events),
    ).toEqual(["hit"]);

    // A cached basis from another process is refused like any foreign basis.
    const foreign = cold.envelope.results[0]!.completion.live.state!;
    const stale = await run(
      directory,
      [
        ...openOnly(bracket),
        {
          commandId: "stale-save",
          operation: "document.save",
          basis: {
            documentId: foreign.documentId,
            revisionId: foreign.revisionId,
            repositoryHeads: foreign.repositoryHeads,
          },
          path: join(directory, "stale.cadara"),
        },
      ],
      env,
    );
    expect(kinds(stale.events)).toEqual(["hit"]);
    expect(stale.code).toBe(1);
    expect(outcomes(stale)).toEqual(["completed", "conflicted"]);
    expect(stale.envelope.results[1]!.completion.file).toEqual({
      kind: "not-required",
    });
    await expect(stat(join(directory, "stale.cadara"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    // A missing authoritative document is a file failure, not a cached open.
    await rm(bracket);
    const missing = await run(directory, openOnly(bracket), env);
    expect(missing.code).toBe(1);
    expect(missing.envelope.results[0]!.outcome.kind).toBe("failed");
    expect(missing.events).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 600000);

it("bypasses the cache, quietly, on a platform without user ownership checks", () => {
  const stderr: string[] = [];
  const io = {
    stdout: () => undefined,
    stderr: (text: string) => stderr.push(text),
  } as unknown as CliIO;
  const env = (values: Record<string, string>) => (name: string) =>
    values[name];
  const getuid = Object.getOwnPropertyDescriptor(process, "getuid")!;
  // Windows: process.getuid does not exist.
  Object.defineProperty(process, "getuid", {
    value: undefined,
    configurable: true,
  });
  try {
    const fingerprint = () => Promise.resolve("build");
    expect(
      createCliModelCheckpointStore(
        env({ XDG_CACHE_HOME: "/tmp/x" }),
        io,
        fingerprint,
      ),
    ).toBeUndefined();
    expect(stderr, "a platform condition is not a degradation").toEqual([]);
    createCliModelCheckpointStore(
      env({ XDG_CACHE_HOME: "/tmp/x", CADARA_MODEL_CACHE_TRACE: "1" }),
      io,
      fingerprint,
    );
    expect(stderr.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        version: 1,
        modelCache: { kind: "bypass", reason: "no-user-ownership-checks" },
      },
    ]);
  } finally {
    Object.defineProperty(process, "getuid", getuid);
  }
  expect(typeof process.getuid).toBe("function");
});

it("never publishes a failed build, clears on request and refuses invalid settings", async () => {
  const { directory, bracket, cache } = await workspace();
  try {
    const env = { XDG_CACHE_HOME: cache };
    // A chamfer far larger than its edges cannot be built.
    const broken = JSON.parse(
      await readFile(bracket, "utf8"),
    ) as BracketDocument;
    feature(
      broken,
      "feature_chamfer-1",
    ).definition.parameters.options.distance.value = 40;
    const brokenPath = join(directory, "broken.cadara");
    await writeFile(brokenPath, JSON.stringify(broken));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await run(directory, openOnly(brokenPath), env);
      expect(failed.code).toBe(1);
      expect(failed.envelope.results[0]!.outcome).toMatchObject({
        kind: "failed",
        failures: ["geometry"],
      });
      expect(
        kinds(failed.events),
        "a failed build is never a reusable checkpoint",
      ).toEqual(["miss", "bypass"]);
      expect(failed.events[1]).toEqual({
        kind: "bypass",
        reason: "incomplete-evaluation",
      });
    }
    expect(await entries(cache)).toEqual([]);

    await run(directory, openOnly(bracket), env);
    expect(await entries(cache)).toHaveLength(1);
    const cleared = await promisify(execFile)(
      "bun",
      [cliEntry(), "cache", "clear"],
      { env: { ...process.env, ...env } },
    );
    expect(JSON.parse(cleared.stdout)).toEqual({
      version: 1,
      root: join(cache, "cadara", "model-checkpoints"),
      removed: 1,
    });
    expect(await entries(cache)).toEqual([]);
    expect(
      kinds((await run(directory, openOnly(bracket), env)).events),
    ).toEqual(["miss", "published"]);

    const invalid = await invokeCliDocumentRecipe(
      [join(directory, "recipe.json")],
      {
        cwd: root,
        env: { ...process.env, ...env, CADARA_MODEL_CACHE: "maybe" },
      },
    );
    expect(invalid.code).toBe(2);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("CADARA_MODEL_CACHE must be on or off");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 600000);
