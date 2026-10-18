import { afterEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  SemanticResult,
  SemanticState,
} from "@/contracts/semantic/schema";
import { validateCompactRecipeOutput } from "@/cli/commands/compact-output.runtime-schema";
import {
  compactRecipeOutput,
  type CompactRecipeOutput,
} from "@/cli/commands/compact-output";
import {
  copyCliRuntimeWithoutAssets,
  cliEntry,
  invokeCliRecipe,
} from "../../test/helpers/cli-recipe-process";

const plate = JSON.parse(
  await readFile(resolve(import.meta.dirname, "examples/plate.json"), "utf8"),
) as { operations: Record<string, unknown>[] };
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "cadara-compact-"));
  directories.push(directory);
  return directory;
}
type Detailed = {
  version: 1;
  results: SemanticResult[];
  unexecuted: string[];
  cleanup: { kind: string };
};
const receiptKinds = (result: { completion: SemanticResult["completion"] }) =>
  Object.fromEntries(
    Object.entries(result.completion).map(([key, value]) => [key, value.kind]),
  );

it("compact output keeps every terminal fact of the shipped plate workflow in a much smaller validated envelope", async () => {
  const directory = await workspace();
  const options = {
    cwd: directory,
    timeout: 90000,
    maxBuffer: 64 * 1024 * 1024,
  };
  const byDefault = await invokeCliRecipe(directory, plate.operations, options);
  const detailedRun = await invokeCliRecipe(
    directory,
    plate.operations,
    options,
    ["--output", "detailed"],
  );
  const compactRun = await invokeCliRecipe(
    directory,
    plate.operations,
    options,
    ["--output", "compact"],
  );
  for (const run of [byDefault, detailedRun, compactRun]) {
    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
  }
  const defaults = JSON.parse(byDefault.stdout) as Detailed;
  const detailed = JSON.parse(detailedRun.stdout) as Detailed;
  const compact = JSON.parse(compactRun.stdout) as CompactRecipeOutput;

  // Default detailed output is unchanged: no output marker, full discovery on
  // every result, including exact topology and private sketch discovery.
  for (const envelope of [defaults, detailed]) {
    expect(Object.keys(envelope).sort()).toEqual([
      "cleanup",
      "results",
      "unexecuted",
      "version",
    ]);
    expect(envelope.results[2]!.discovery!.sketch!.points).toHaveLength(4);
    expect(
      envelope.results.at(-1)!.discovery!.model!.bodies[0]!.topology!.length,
    ).toBeGreaterThan(20);
  }

  expectValidCompact(compact);
  expect(compact.output).toEqual({ mode: "compact", version: 1 });
  if (compact.initialization)
    throw new Error("Expected an executed compact envelope");
  expect(compact.unexecuted).toEqual([]);
  expect(compact.cleanup).toEqual(detailed.cleanup);
  expect(compact.results).toHaveLength(12);
  for (const [index, result] of compact.results.entries()) {
    const reference = detailed.results[index]!;
    expect(result.correlation.commandId).toBe(`plate-${index + 1}`);
    expect(result.correlation.family).toBe(reference.correlation.family);
    expect(result.correlation.intent).toBe(reference.correlation.intent);
    expect(result.outcome).toEqual(reference.outcome);
    expect(receiptKinds(result)).toEqual(receiptKinds(reference));
    expect(result.diagnostics).toEqual(reference.diagnostics);
    // Same revision/draft sequence in both processes: identical execution.
    expect(result.discovery!.state.revisionId).toBe(
      reference.discovery!.state.revisionId,
    );
    expect(result.discovery!.state.draft?.generation).toBe(
      reference.discovery!.state.draft?.generation,
    );
    expect(result.discovery!.state).toEqual(
      result.completion.handoff.kind === "current"
        ? result.completion.handoff.state
        : null,
    );
    if (index < 11)
      expect(result.discovery).toEqual({
        detail: "omitted",
        state: result.discovery!.state,
      });
  }
  const save = compact.results[10]!.completion.file;
  expect(save).toMatchObject({ kind: "written", path: "plate.cadara" });
  expect(save.kind === "written" && save.bytesWritten).toBe(
    detailed.results[10]!.completion.file.kind === "written" &&
      detailed.results[10]!.completion.file.bytesWritten,
  );

  // Only the last discovery is included; it keeps every labelled typed
  // reference and exact bounds, while topology is explicitly omitted.
  const last = compact.results[11]!.discovery!;
  const lastDetailed = detailed.results[11]!.discovery!;
  if (last.detail !== "included")
    throw new Error("Expected the last discovery to be included");
  const labelled = (
    references: readonly { label: string; target: { kind: string } }[],
  ) =>
    references.map(
      (reference) => `${reference.target.kind}:${reference.label}`,
    );
  expect(labelled(last.references)).toEqual(labelled(lastDetailed.references));
  expect(
    last.references.filter((reference) => reference.target.kind === "edge"),
  ).toHaveLength(12);
  expect(last.model!.bodies).toHaveLength(1);
  const body = last.model!.bodies[0]!;
  expect(body.bounds).toEqual(lastDetailed.model!.bodies[0]!.bounds);
  for (const [axis, size] of [20, 10, 7].entries())
    expect(body.bounds!.max[axis]! - body.bounds!.min[axis]!).toBeCloseTo(
      size,
      5,
    );
  expect(body.topology).toEqual({
    detail: "omitted",
    entries: lastDetailed.model!.bodies[0]!.topology!.length,
  });

  expect(compactRun.stdout.length * 4).toBeLessThan(detailedRun.stdout.length);
}, 180000);

function expectValidCompact(envelope: unknown) {
  const validated = validateCompactRecipeOutput(envelope);
  expect(
    validated.success,
    JSON.stringify(validated.success ? [] : validated.issues.slice(0, 5)),
  ).toBe(true);
}
function compactEnvelope(stdout: string) {
  const envelope = JSON.parse(stdout) as CompactRecipeOutput;
  expectValidCompact(envelope);
  expect(envelope.output).toEqual({ mode: "compact", version: 1 });
  if (envelope.initialization)
    throw new Error("Expected an executed compact envelope");
  return envelope as Extract<
    CompactRecipeOutput,
    { unexecuted: readonly string[] }
  >;
}

it("compact output keeps partial, ambiguous and failed-save recipes machine-detectable", async () => {
  const directory = await workspace();
  const options = { cwd: directory, timeout: 90000 };
  const compact = ["--output", "compact"];

  const partial = await invokeCliRecipe(
    directory,
    [
      {
        version: 1,
        commandId: "create",
        operation: "document.create",
        label: "Fresh",
        basis: null,
        as: "opened",
      },
      {
        version: 1,
        commandId: "undo",
        operation: "history.undo",
        basis: { alias: "opened" },
        draft: null,
      },
      {
        version: 1,
        commandId: "never",
        operation: "document.rename",
        basis: { alias: "opened" },
        label: "Must not run",
      },
    ],
    options,
    compact,
  );
  expect(partial.code).toBe(1);
  expect(partial.stderr).toBe(
    "Recipe failed; prior completed operations are retained.\n",
  );
  const stopped = compactEnvelope(partial.stdout);
  expect(stopped.results.map((result) => result.outcome)).toEqual([
    { kind: "completed", change: "changed" },
    { kind: "unavailable", capability: "history.undo" },
  ]);
  expect(stopped.results[1]!.completion.live.kind).toBe("unchanged");
  expect(stopped.unexecuted).toEqual(["never"]);
  expect(stopped.cleanup).toMatchObject({
    kind: "closed",
    resourcesReleased: true,
  });

  // Two sketches each own an "Outer region": the unscoped label stays ambiguous.
  const [create, begin, rectangle, publish] = plate.operations;
  const ambiguous = await invokeCliRecipe(
    directory,
    [
      create!,
      begin!,
      rectangle!,
      publish!,
      {
        version: 1,
        commandId: "begin-2",
        operation: "sketch.begin",
        plane: "xy",
        basis: { alias: "published" },
        as: "draft-2",
      },
      {
        version: 1,
        commandId: "rectangle-2",
        operation: "sketch.author",
        basis: { alias: "draft-2" },
        draft: { alias: "draft-2" },
        primitive: { kind: "rectangle", start: [40, 0], end: [60, 10] },
        construction: false,
        intent: "fulfill",
        as: "rectangle-2",
      },
      {
        version: 1,
        commandId: "publish-2",
        operation: "sketch.publish",
        basis: { alias: "rectangle-2" },
        draft: { alias: "rectangle-2" },
        requireProfiles: true,
        as: "published-2",
      },
      {
        version: 1,
        commandId: "extrude",
        operation: "extrude.create",
        basis: { alias: "published-2" },
        profile: { alias: "published-2", label: "Outer region" },
        depth: 7,
        intent: "fulfill",
      },
    ],
    options,
    compact,
  );
  expect(ambiguous.code).toBe(1);
  expect(ambiguous.stderr).toContain("ambiguous");
  const refused = compactEnvelope(ambiguous.stdout);
  expect(refused.results.map((result) => result.outcome.kind)).toEqual(
    Array(7).fill("completed"),
  );
  expect(refused.unexecuted).toEqual(["extrude"]);
  expect(refused.error).toMatchObject({
    code: "selection-ambiguous",
    phase: "resolution",
    commandIndex: 7,
    commandId: "extrude",
    operation: "extrude.create",
    path: "profile",
    candidates: [
      { label: "Outer region", target: { kind: "region" }, owner: { kind: "sketch" } },
      { label: "Outer region", target: { kind: "region" }, owner: { kind: "sketch" } },
    ],
  });
  expect(refused.error!.message + "\n").toBe(ambiguous.stderr);
  const candidates = refused.results[6]!.discovery!;
  if (candidates.detail !== "included")
    throw new Error("Expected the last discovery to be included");
  expect(
    candidates.references.filter(
      (reference) =>
        reference.label === "Outer region" &&
        reference.target.kind === "region",
    ),
  ).toHaveLength(2);
  expect(candidates.model!.bodies).toEqual([]);

  const failedSave = await invokeCliRecipe(
    directory,
    [
      ...plate.operations.slice(0, 5),
      {
        version: 1,
        commandId: "save",
        operation: "document.save",
        basis: { alias: "solid" },
        path: "missing/plate.cadara",
      },
      {
        version: 1,
        commandId: "never",
        operation: "document.inspect",
        basis: { alias: "solid" },
      },
    ],
    options,
    compact,
  );
  expect(failedSave.code).toBe(1);
  const unsaved = compactEnvelope(failedSave.stdout);
  const save = unsaved.results[5]!;
  expect(save.outcome).toEqual({ kind: "failed", failures: ["file"] });
  expect(save.completion.file).toMatchObject({
    kind: "failed",
    path: "missing/plate.cadara",
    bytesWritten: 0,
  });
  expect(save.completion.live.kind).toBe("unchanged");
  expect(unsaved.unexecuted).toEqual(["never"]);
  // The failed save still returns current discovery; it is the included one.
  expect(save.discovery?.detail).toBe("included");
}, 180000);

it("refuses unknown output modes as usage errors before starting the runtime", async () => {
  const directory = await workspace();
  const options = { cwd: directory, timeout: 90000 };
  for (const args of [["--output", "verbose"], ["--output"]]) {
    const refused = await invokeCliRecipe(
      directory,
      plate.operations,
      options,
      args,
    );
    expect(refused.code).toBe(2);
    expect(refused.stdout).toBe("");
    const [diagnostic, summary] = refused.stderr.trim().split("\n");
    expect(JSON.parse(diagnostic!)).toMatchObject({
      version: 1,
      error: { code: "usage", phase: "preflight" },
    });
    expect(summary).toBe(
      "Usage: cadara document recipe [--output detailed|compact] <recipe.json>",
    );
  }
}, 60000);

it("reports initialization failure as a compact envelope when native assets are missing", async () => {
  const directory = await workspace();
  // The JS runtime resolves its native assets module-relatively; omit them.
  await copyCliRuntimeWithoutAssets(directory);
  await writeFile(join(directory, "recipe.json"), JSON.stringify(plate));
  const failure = await promisify(execFile)(
    "bun",
    [
      join(directory, "main.js"),
      "document",
      "recipe",
      "--output",
      "compact",
      "recipe.json",
    ],
    { cwd: directory, timeout: 90000, encoding: "utf8" },
  ).then(
    () => {
      throw new Error("Missing native assets unexpectedly initialized");
    },
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
  expect(failure.code).toBe(1);
  expect(failure.stderr).toContain("Document initialization failed.");
  const envelope = JSON.parse(failure.stdout) as CompactRecipeOutput;
  expectValidCompact(envelope);
  expect(envelope.output).toEqual({ mode: "compact", version: 1 });
  if (!envelope.initialization)
    throw new Error("Expected an initialization envelope");
  expect(envelope.results).toEqual([]);
  expect(envelope.error).toMatchObject({
    code: "initialization",
    phase: "initialization",
    message: "Document initialization failed.",
  });
  expect(envelope.initialization.kind).toBe("failed");
  expect(envelope.initialization.diagnostics.length).toBeGreaterThan(0);
  expect(envelope.initialization.cleanup).toMatchObject({
    kind: "closed",
    resourcesReleased: true,
  });
}, 60000);

const documentState: SemanticState = {
  documentId: "doc_a",
  revisionId: "rev_1",
  repositoryHeads: ["memory:a:1"],
  editingContext: { kind: "document" },
  draft: null,
};
/** A document inspection result with an unchanged live state. */
function makeInspectResult(
  commandId: string,
  outcome: SemanticResult["outcome"],
  discovery: SemanticResult["discovery"],
): SemanticResult {
  return {
    version: 1,
    correlation: {
      commandId,
      family: "document",
      intent: "inspect",
      basis: {
        documentId: "doc_a",
        revisionId: "rev_1",
        repositoryHeads: ["memory:a:1"],
      },
    },
    outcome,
    completion: {
      live: { kind: "unchanged", state: documentState },
      handoff: { kind: "not-required" },
      geometry: { kind: "not-required" },
      persistence: { kind: "not-required" },
      file: { kind: "not-required" },
    },
    diagnostics: [],
    discovery,
  };
}

it("projects failed cleanup without hiding its failures or settled results", () => {
  const settled = makeInspectResult(
    "queued",
    { kind: "canceled", phase: "not-started" },
    null,
  );
  const diagnostics = [
    {
      code: "release-failed",
      severity: "error" as const,
      message: "Native owner release failed.",
      target: null,
      detail: null,
    },
  ];
  const output = compactRecipeOutput([], ["queued"], {
    kind: "failed",
    settled: [settled],
    resourcesReleased: false,
    failures: ["release"],
    diagnostics,
  });
  expectValidCompact(output);
  expect(output).toEqual({
    version: 1,
    output: { mode: "compact", version: 1 },
    results: [],
    unexecuted: ["queued"],
    cleanup: {
      kind: "failed",
      settled: [settled],
      resourcesReleased: false,
      failures: ["release"],
      diagnostics,
    },
  });
});

it("keeps unavailable (null) body topology distinct from an empty topology list", () => {
  const body = { kind: "solid" as const, bounds: null };
  const inspected = makeInspectResult(
    "inspect",
    { kind: "completed", change: "unchanged" },
    {
      state: documentState,
      references: [],
      history: null,
      model: {
        features: [],
        bodies: [
          { ...body, bodyId: "body_unavailable", topology: null },
          { ...body, bodyId: "body_empty", topology: [] },
        ],
      },
    },
  );
  const output = compactRecipeOutput([inspected], [], {
    kind: "closed",
    settled: [],
    resourcesReleased: true,
  });
  expectValidCompact(output);
  if (output.initialization)
    throw new Error("Expected an executed compact envelope");
  const discovery = output.results[0]!.discovery;
  if (discovery?.detail !== "included")
    throw new Error("Expected the only discovery to be included");
  expect(discovery.model!.bodies).toEqual([
    { ...body, bodyId: "body_unavailable", topology: null },
    {
      ...body,
      bodyId: "body_empty",
      topology: { detail: "omitted", entries: 0 },
    },
  ]);
});

it("the shipped compact consumer example summarizes success and failure from JSON alone", async () => {
  const directory = await workspace();
  const examples = join(cliEntry(), "..", "examples");
  const consume = (recipe: string) =>
    promisify(execFile)("bun", [join(examples, "compact-summary.ts"), recipe], {
      cwd: directory,
      timeout: 90000,
      encoding: "utf8",
    }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
  const success = await consume(join(examples, "plate.json"));
  expect(success.code, success.stderr).toBe(0);
  const summary = JSON.parse(success.stdout);
  expect(summary).toMatchObject({
    ok: true,
    exitCode: 0,
    unexecuted: [],
    cleanup: "closed",
  });
  expect(summary.operations).toHaveLength(12);
  expect(
    summary.operations.every(
      (operation: { outcome: string }) => operation.outcome === "completed",
    ),
  ).toBe(true);
  expect(summary.saved).toEqual([
    {
      commandId: "plate-11",
      path: "plate.cadara",
      bytesWritten: (await readFile(join(directory, "plate.cadara")))
        .byteLength,
    },
  ]);
  expect(summary.document.references.edge).toBe(12);
  const [body] = summary.document.bodies;
  for (const [axis, size] of [20, 10, 7].entries())
    expect(body.bounds.max[axis] - body.bounds.min[axis]).toBeCloseTo(size, 5);
  expect(body.topology).toMatchObject({ detail: "omitted" });

  await writeFile(
    join(directory, "partial.json"),
    JSON.stringify({
      version: 1,
      operations: [
        {
          version: 1,
          commandId: "create",
          operation: "document.create",
          label: "Fresh",
          basis: null,
          as: "opened",
        },
        {
          version: 1,
          commandId: "undo",
          operation: "history.undo",
          basis: { alias: "opened" },
          draft: null,
        },
        {
          version: 1,
          commandId: "never",
          operation: "document.rename",
          basis: { alias: "opened" },
          label: "Must not run",
        },
      ],
    }),
  );
  const failure = await consume("partial.json");
  expect(failure.code).toBe(1);
  expect(JSON.parse(failure.stdout)).toMatchObject({
    ok: false,
    exitCode: 1,
    operations: [
      { commandId: "create", outcome: "completed" },
      { commandId: "undo", outcome: "unavailable" },
    ],
    unexecuted: ["never"],
    cleanup: "closed",
  });
}, 120000);
