import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { invokeCliRecipe } from "../../test/helpers/cli-recipe-process";

// Released-CLI production-kernel regression for cadara-3sq.1. Setting the
// timeline cursor of the public nine-feature bracket to the feature it already
// is at re-runs every feature and rebuilds keyed topology lineage, whose
// repository materialization orders keyed records differently from the live
// export; the saves failed unless certification compares keyed records by key.
// (Until cadara-49h a body rename rebuilt lineage the same way and was this
// reproduction; a rename now re-runs no feature and stays below as a control.)
// Re-qualified for cadara-797: on its base and with it, these rows pass with
// that keyed comparison removed, so they no longer reproduce cadara-3sq.1;
// authored-document-equality.spec.ts and document-repository.spec.ts carry
// the keyed-order regression. The rows still guard save/reopen identity.
const root = resolve(import.meta.dirname, "../..");
const bracketSource = resolve(root, "landing/examples/bracket/model.cadara");
const BRACKET_SHA256 =
  "0db9966c73601e0376a94455ca8131e77e6aaece6b3b99aae2315de73115d792";
/** Revision-sensitive fallback edge/vertex ids are renumbered by every rebuild. */
const FALLBACK_TOPOLOGY_ID = /_t\d{4}_\d+$/;

type Recipe = { results: SemanticResult[]; cleanup: unknown };

async function bracketFixture(directory: string) {
  const bytes = await readFile(bracketSource);
  expect(
    createHash("sha256").update(bytes).digest("hex"),
    "The public bracket changed; re-check these save/reopen identity rows against it before updating the digest.",
  ).toBe(BRACKET_SHA256);
  const path = resolve(directory, "bracket.cadara");
  await writeFile(path, bytes);
  const body = JSON.parse(bytes.toString("utf8")).bodyLabels[0] as {
    bodyId: string;
    label: string;
  };
  return { path, body };
}

async function recipe(
  directory: string,
  operations: readonly Record<string, unknown>[],
): Promise<Recipe> {
  const run = await invokeCliRecipe(
    directory,
    operations.map((operation) => ({ version: 1, ...operation })),
    {
      cwd: root,
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "production", TEST: "false" },
    },
  );
  expect(run.code, run.stderr).toBe(0);
  const parsed: Recipe = JSON.parse(run.stdout);
  expect(parsed.cleanup).toMatchObject({
    kind: "closed",
    resourcesReleased: true,
  });
  return parsed;
}

const outcomes = (result: Recipe) =>
  result.results.map((entry) => entry.outcome.kind);
const topologyId = (target: object) => {
  const ids = target as { faceId?: string; edgeId?: string; vertexId?: string };
  return ids.faceId ?? ids.edgeId ?? ids.vertexId ?? "";
};

it.each([
  { travel: "re-setting its timeline cursor", rollback: false },
  { travel: "rolling its timeline cursor back and returning", rollback: true },
])("saves, re-saves and reopens the public bracket after $travel", async ({ rollback }) => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-bracket-cursor-"));
  try {
    const { path, body } = await bracketFixture(directory);
    const saved = resolve(directory, "saved.cadara");
    const savedAgain = resolve(directory, "saved-again.cadara");
    const first = await recipe(directory, [
      {
        commandId: "open",
        operation: "document.open",
        basis: null,
        path,
        as: "opened",
      },
      ...(rollback
        ? [{
            commandId: "roll-back",
            operation: "timeline.cursor.set",
            basis: { alias: "opened" },
            cursor: { kind: "feature", featureId: "feature_extrude-6" },
            intent: "fulfill",
            as: "rolled-back",
          }]
        : []),
      {
        commandId: "rebuild",
        operation: "timeline.cursor.set",
        basis: { alias: rollback ? "rolled-back" : "opened" },
        cursor: { kind: "feature", featureId: "feature_chamfer-1" },
        intent: "fulfill",
        as: "rebuilt",
      },
      {
        commandId: "save",
        operation: "document.save",
        basis: { alias: "rebuilt" },
        path: saved,
      },
      {
        commandId: "save-again",
        operation: "document.save",
        basis: { alias: "rebuilt" },
        path: savedAgain,
      },
    ]);
    expect(
      outcomes(first),
      JSON.stringify(first.results.map((r) => r.diagnostics)),
    ).toEqual(Array(rollback ? 5 : 4).fill("completed"));
    const rebuiltIndex = rollback ? 2 : 1;
    const rebuilt = first.results[rebuiltIndex]!;
    expect(rebuilt.completion.persistence.kind).toBe("committed");
    const accepted = rebuilt.completion.live.state;
    for (const [index, file] of [
      [rebuiltIndex + 1, saved],
      [rebuiltIndex + 2, savedAgain],
    ] as const) {
      const save = first.results[index]!;
      // Each save observes its own synchronization of the exact accepted basis:
      // same revision and heads, so no authored change was invented.
      expect(save.completion.persistence).toMatchObject({
        kind: "committed",
        commandId: save.correlation.commandId,
        state: accepted,
      });
      expect(save.completion.file).toMatchObject({
        kind: "written",
        path: file,
      });
      expect(save.discovery?.history).toEqual(rebuilt.discovery?.history);
    }
    expect(await readFile(savedAgain)).toEqual(await readFile(saved));

    const top = rebuilt.discovery!.model!.bodies[0]!.topology!.find(
      (entry) =>
        entry.entityClass === "face" &&
        entry.geometryType === "plane" &&
        entry.boundingBox?.low[2] === 50 &&
        entry.boundingBox.high[2] === 50,
    )!.reference;
    const second = await recipe(directory, [
      {
        commandId: "reopen",
        operation: "document.open",
        basis: null,
        path: saved,
        as: "reopened",
      },
      {
        commandId: "sketch-on-face",
        operation: "sketch.begin",
        basis: { alias: "reopened" },
        support: top,
      },
    ]);
    expect(outcomes(second)).toEqual(["completed", "completed"]);
    const before = rebuilt.discovery!;
    const after = second.results[0]!.discovery!;
    expect(
      after.references.filter((reference) => reference.target.kind === "body"),
    ).toEqual([
      { label: body.label, target: { kind: "body", bodyId: body.bodyId }, owner: { kind: "feature", featureId: "feature_chamfer-1" } },
    ]);
    expect(after.model!.features).toEqual(before.model!.features);
    const geometry = (discovery: typeof before) =>
      discovery.model!.bodies.map((entry) => ({
        ...entry,
        topology: entry
          .topology!.map(({ reference, ...rest }) =>
            JSON.stringify({ kind: reference.kind, ...rest }),
          )
          .sort(),
      }));
    expect(geometry(after), "exact geometry survives save and reopen").toEqual(
      geometry(before),
    );
    const stable = (discovery: typeof before) =>
      discovery.references
        .filter(
          (reference) =>
            !FALLBACK_TOPOLOGY_ID.test(topologyId(reference.target)),
        )
        .map((reference) => JSON.stringify(reference))
        .sort();
    expect(
      stable(before).filter((r) => r.includes('"kind":"face"')),
    ).toHaveLength(26);
    // Reopen is canonical and the returned session must agree with it. A
    // restore that reproduces the stored lineage keeps the file's ids
    // (cadara-797), so all 226 references keep their stable ids; before that,
    // every restore re-minted 52 of the file's hashed edge/vertex ids (174).
    expect(stable(before)).toHaveLength(226);
    expect(stable(after)).toHaveLength(226);
    expect(
      stable(after),
      "stable target identities survive save and reopen",
    ).toEqual(stable(before));
    // A reopened face reference is directly usable by a downstream command.
    expect(second.results[1]!.discovery!.sketch!.support?.support).toEqual(top);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 240000);

// Control: a body rename (label-only since cadara-49h) and a document rename
// on the bracket save through the same certification.
it("keeps the public bracket open/save and real document-rename controls passing", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "cadara-bracket-controls-"),
  );
  try {
    const { path, body } = await bracketFixture(directory);
    const opened = resolve(directory, "opened.cadara");
    const renamed = resolve(directory, "renamed.cadara");
    const result = await recipe(directory, [
      {
        commandId: "open",
        operation: "document.open",
        basis: null,
        path,
        as: "opened",
      },
      {
        commandId: "save-open",
        operation: "document.save",
        basis: { alias: "opened" },
        path: opened,
      },
      {
        commandId: "rename-body",
        operation: "body.rename",
        basis: { alias: "opened" },
        bodyId: body.bodyId,
        label: "Bracket body",
        intent: "fulfill",
        as: "body",
      },
      {
        commandId: "rename-document",
        operation: "document.rename",
        basis: { alias: "body" },
        label: "Bracket qualification rename",
        as: "document",
      },
      {
        commandId: "save-renamed",
        operation: "document.save",
        basis: { alias: "document" },
        path: renamed,
      },
    ]);
    expect(outcomes(result)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(result.results[1]!.completion.file).toMatchObject({
      kind: "written",
      path: opened,
    });
    expect(result.results[4]!.completion.file).toMatchObject({
      kind: "written",
      path: renamed,
    });
    const document = JSON.parse(await readFile(renamed, "utf8"));
    expect(document.name).toBe("Bracket qualification rename");
    expect(document.bodyLabels).toEqual([
      { bodyId: body.bodyId, label: "Bracket body" },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 240000);
