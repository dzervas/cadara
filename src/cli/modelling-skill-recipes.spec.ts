import { afterAll, beforeAll, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { cliEntry, invokeCliRecipe } from "../../test/helpers/cli-recipe-process";
import { expectBounds, labelled } from "../../test/helpers/semantic-result-assertions";

// Qualifies the executable example and the success/failure signals taught by
// the repository agent skill `.agents/skills/cadara-cli-modelling/SKILL.md`
// against the built browserless package (cadara-3sq.5).
type Operation = Record<string, unknown>;
type Envelope = { results: SemanticResult[]; unexecuted: string[]; cleanup: { kind: string; resourcesReleased: boolean } };

const options = { timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_ENV: "production", TEST: "false" } };
let directory: string;
let example: Operation[];
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "cadara-modelling-skill-"));
  example = JSON.parse(await readFile(shippedExample(), "utf8")).operations;
});
afterAll(() => rm(directory, { recursive: true, force: true }));

/** The skill's example as shipped beside the built browserless `main.js`. */
function shippedExample() {
  return resolve(cliEntry(), "..", "examples", "multi-sketch-part.json");
}
function checkEnvelope(envelope: Envelope, operations: readonly Operation[]) {
  expect(envelope.cleanup).toMatchObject({ kind: "closed", resourcesReleased: true });
  expect(envelope.unexecuted).toEqual(operations.slice(envelope.results.length).map((o) => o.commandId));
  for (const [index, result] of envelope.results.entries()) {
    expect(result.correlation.commandId).toBe(operations[index]!.commandId);
    expect(validateSemanticResult(result.correlation, result).success).toBe(true);
  }
}
async function runFailing(operations: readonly Operation[]) {
  const output = await invokeCliRecipe(directory, operations, { ...options, cwd: directory });
  expect(output.code, output.stderr).toBe(1);
  const envelope: Envelope = JSON.parse(output.stdout);
  checkEnvelope(envelope, operations);
  return { stderr: output.stderr, envelope };
}
const byId = (envelope: Envelope) => Object.fromEntries(envelope.results.map((r) => [r.correlation.commandId, r]));
const bodies = (result: SemanticResult) => result.discovery!.model!.bodies;
const faces = (result: SemanticResult) => bodies(result)[0]!.topology!.filter((t) => t.entityClass === "face");
/** Planar faces at constant x, as [x, zLow, zHigh]: the wall's inner face moves with its thickness. */
const constantXFaces = (result: SemanticResult) =>
  faces(result)
    .filter((f) => f.boundingBox!.low[0] === f.boundingBox!.high[0])
    .map((f) => [f.boundingBox!.low[0], f.boundingBox!.low[2], f.boundingBox!.high[2]])
    .sort((a, b) => a[0]! - b[0]!);
const geometry = (result: SemanticResult) =>
  bodies(result).map(({ topology, ...body }) => ({
    ...body,
    faces: topology!.filter((t) => t.entityClass === "face").map(({ reference: _, ...rest }) => JSON.stringify(rest)).sort(),
  }));
function stlBounds(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + count * 50);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++)
    for (let v = 0; v < 3; v++)
      for (let axis = 0; axis < 3; axis++) {
        const value = bytes.readFloatLE(84 + t * 50 + 12 + v * 12 + axis * 4);
        min[axis] = Math.min(min[axis]!, value);
        max[axis] = Math.max(max[axis]!, value);
      }
  return { count, bounds: { min, max } };
}
const withOperation = (commandId: string, patch: (operation: Operation) => Operation) =>
  example.map((o) => (o.commandId === commandId ? patch(o) : o));
const through = (commandId: string, operations = example) =>
  operations.slice(0, operations.findIndex((o) => o.commandId === commandId) + 1);

test("the shipped multi-sketch example authors, edits, saves, reopens and exports the expected L bracket", async () => {
  const output = await promisify(execFile)("bun", [cliEntry(), "document", "recipe", shippedExample()], { ...options, cwd: directory, encoding: "utf8" });
  const envelope: Envelope = JSON.parse(output.stdout);
  checkEnvelope(envelope, example);
  expect(envelope.unexecuted).toEqual([]);
  expect(envelope.results.map((r) => r.outcome.kind)).toEqual(example.map(() => "completed"));
  const r = byId(envelope);

  // Two ordinary single-region sketches both expose "Outer region"; the owner picks each.
  const region = (result: SemanticResult) => {
    const sketch = result.discovery!.sketch!;
    expect(sketch.profiles).toHaveLength(1);
    return { kind: "region", sketchId: sketch.sketchId, regionId: sketch.profiles[0]!.regionId };
  };
  const base = region(r["base-publish"]!);
  const wall = region(r["wall-publish"]!);
  expect(wall.sketchId).not.toBe(base.sketchId);
  expect(labelled(r["wall-publish"]!, "Outer region", "region")).toEqual([base, wall]);

  // The xy plate, then the yz wall joined into the same body: an L-shaped prism.
  expect(bodies(r["base-extrude"]!)).toHaveLength(1);
  const bodyId = bodies(r["base-extrude"]!)[0]!.bodyId;
  expectBounds(bodies(r["base-extrude"]!)[0]!.bounds, [0, 0, 0], [40, 20, 4]);
  expect(bodies(r["wall-extrude"]!).map((b) => b.bodyId)).toEqual([bodyId]);
  expectBounds(bodies(r["wall-extrude"]!)[0]!.bounds, [0, 0, 0], [40, 20, 30]);
  expect(faces(r["wall-extrude"]!).map((f) => f.geometryType)).toEqual(Array(8).fill("plane"));
  expect(r["wall-extrude"]!.discovery!.model!.features.map((f) => [f.label, f.producedTargets])).toEqual([
    ["Extrude 1", [{ kind: "body", bodyId }]],
    ["Extrude 2", [{ kind: "body", bodyId }]],
  ]);
  expect(constantXFaces(r["wall-extrude"]!)).toEqual([[0, 0, 30], [4, 4, 30], [40, 0, 4]]);

  // The depth edit moves the wall's inner face; bounds alone cannot show it, the face does.
  expect(constantXFaces(r["thicken-wall"]!)).toEqual([[0, 0, 30], [6, 4, 30], [40, 0, 4]]);
  expect(faces(r["thicken-wall"]!)).toHaveLength(8);
  expect(labelled(r["name-body"]!, "L bracket", "body")).toEqual([{ kind: "body", bodyId }]);

  const saved = resolve(directory, "l-bracket.cadara");
  const accepted = r["name-body"]!.completion.live.state;
  expect(r.save!.completion.persistence).toMatchObject({ kind: "committed", state: accepted });
  expect(r.save!.completion.file).toMatchObject({ kind: "written", path: "l-bracket.cadara", bytesWritten: (await stat(saved)).size });

  // Reopening the written file (fresh editing context) reproduces the exact geometry.
  const reopened = r.reopen!;
  expect(reopened.discovery!.state.revisionId).not.toBe(accepted!.revisionId);
  expect(reopened.discovery!.history).toMatchObject({ canUndo: false, canRedo: false });
  expect(geometry(reopened)).toEqual(geometry(r["name-body"]!));
  expect(labelled(reopened, "L bracket", "body")).toEqual([{ kind: "body", bodyId }]);

  for (const [commandId, path] of [["export-step", "l-bracket.step"], ["export-stl", "l-bracket.stl"]] as const)
    expect(r[commandId]!.completion.file).toMatchObject({ kind: "written", path, bytesWritten: (await stat(resolve(directory, path))).size });
  expect(await readFile(resolve(directory, "l-bracket.step"), "utf8")).toMatch(/^ISO-10303-21;[\s\S]*MANIFOLD_SOLID_BREP/);
  const stl = stlBounds(await readFile(resolve(directory, "l-bracket.stl")));
  expect(stl.count).toBe(20);
  expectBounds(stl.bounds, [0, 0, 0], [40, 20, 30]);

  // An independent process opens the saved file and sees the same model.
  const next = [
    { version: 1, commandId: "open", operation: "document.open", basis: null, path: "l-bracket.cadara", as: "opened" },
    { version: 1, commandId: "inspect", operation: "document.inspect", basis: { alias: "opened" } },
  ];
  const second = await invokeCliRecipe(directory, next, { ...options, cwd: directory });
  expect(second.code, second.stderr).toBe(0);
  const secondEnvelope: Envelope = JSON.parse(second.stdout);
  checkEnvelope(secondEnvelope, next);
  expect(secondEnvelope.results.map((x) => x.outcome.kind)).toEqual(["completed", "completed"]);
  expect(geometry(secondEnvelope.results[1]!)).toEqual(geometry(r["name-body"]!));
  expect(labelled(secondEnvelope.results[1]!, "L bracket", "body")).toEqual([{ kind: "body", bodyId }]);
}, 180000);

test("an unqualified profile is a failed recipe even though every executed result completed", async () => {
  const operations = withOperation("wall-extrude", (o) => {
    const parameters = o.parameters as { profiles: Operation[] };
    // `undefined` drops the owner qualifier from the serialized recipe.
    return { ...o, parameters: { ...parameters, profiles: [{ ...parameters.profiles[0], sketch: undefined }] } };
  });
  const { stderr, envelope } = await runFailing(operations);
  expect(stderr).toContain("missing or ambiguous");
  expect(envelope.results.map((r) => r.outcome.kind)).toEqual(Array(8).fill("completed"));
  expect(envelope.unexecuted[0]).toBe("wall-extrude");
  expectBounds(bodies(envelope.results.at(-1)!)[0]!.bounds, [0, 0, 0], [40, 20, 4]);
});

test("an invalid solve fails under fulfill and is only accepted-invalid, never usable, under author-invalid", async () => {
  const conflict = (intent: string) => [
    ...through("base-rectangle"),
    {
      version: 1,
      commandId: "conflict",
      operation: "sketch.requirement.add",
      basis: { alias: "baseRectangle" },
      draft: { alias: "baseRectangle" },
      // The rectangle's bottom edge is already horizontal.
      targets: [{ alias: "baseRectangle", label: "Rectangle 1 bottom", sketch: "baseRectangle" }],
      tool: "constraintVertical",
      mode: "driving",
      value: null,
      intent,
      as: "conflicted",
    },
    { ...example[3]!, basis: { alias: "conflicted" }, draft: { alias: "conflicted" } },
    example[4]!,
  ];
  const fulfill = (await runFailing(conflict("fulfill"))).envelope.results[3]!;
  expect(fulfill.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
  // The live draft did change: failed geometry is not "nothing happened".
  expect(fulfill.completion.live.kind).toBe("applied");
  expect(fulfill.completion.geometry.kind).toBe("invalid-editable");

  const invalid = (await runFailing(conflict("author-invalid"))).envelope;
  expect(invalid.results[3]!.outcome.kind).toBe("accepted-invalid");
  expect(invalid.results[4]!.outcome).toEqual({ kind: "rejected", reasonCode: "profiles-unusable" });
  expect(invalid.results[4]!.completion.live.kind).toBe("unchanged");
  expect(invalid.unexecuted).toEqual(["base-extrude"]);

  // Without a later consumer the recipe exits 0: only the outcome reveals it.
  const quiet = conflict("author-invalid").slice(0, 4);
  const output = await invokeCliRecipe(directory, quiet, { ...options, cwd: directory });
  expect(output.code, output.stderr).toBe(0);
  const quietEnvelope: Envelope = JSON.parse(output.stdout);
  checkEnvelope(quietEnvelope, quiet);
  expect(quietEnvelope.unexecuted).toEqual([]);
  expect(quietEnvelope.results.map((r) => r.outcome.kind)).toEqual(["completed", "completed", "completed", "accepted-invalid"]);
  expect(quietEnvelope.results[3]!.discovery!.sketch!.profiles).toEqual([]);
});

test("a failed save keeps the repository commit but writes no file", async () => {
  const path = "missing-directory/l-bracket.cadara";
  const operations = [
    ...withOperation("save", (o) => ({ ...o, path })).slice(0, example.findIndex((o) => o.commandId === "save") + 1),
    { version: 1, commandId: "after", operation: "document.inspect", basis: { alias: "named" } },
  ];
  const { envelope } = await runFailing(operations);
  const save = envelope.results.at(-1)!;
  expect(save.correlation.commandId).toBe("save");
  expect(save.outcome).toEqual({ kind: "failed", failures: ["file"] });
  expect(save.completion.persistence.kind).toBe("committed");
  expect(save.completion.file).toMatchObject({ kind: "failed", path, bytesWritten: 0 });
  expect(envelope.unexecuted).toEqual(["after"]);
  await expect(stat(resolve(directory, path))).rejects.toMatchObject({ code: "ENOENT" });
});
