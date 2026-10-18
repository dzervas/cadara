import { afterAll, beforeAll, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { cliEntry, invokeCliRecipe } from "../../test/helpers/cli-recipe-process";

type Operation = Record<string, unknown>;
type Envelope = { results: SemanticResult[]; unexecuted: string[]; cleanup: { kind: string; resourcesReleased: boolean } };

const root = resolve(import.meta.dirname, "../..");
const options = { cwd: root, timeout: 90000, env: { ...process.env, NODE_ENV: "production", TEST: "false" } };
let directory: string;
let example: Operation[];
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "cadara-sketch-owner-"));
  example = JSON.parse(await readFile(shippedExample(), "utf8")).operations;
});
afterAll(() => rm(directory, { recursive: true, force: true }));

/** The documented example as shipped beside the built browserless `main.js`. */
function shippedExample() {
  return resolve(cliEntry(), "..", "examples", "scoped-profiles.json");
}
async function run(operations: readonly Operation[], exitCode: number) {
  const output = await invokeCliRecipe(directory, operations, options);
  expect(output.code, output.stderr + output.stdout).toBe(exitCode);
  if (exitCode === 2) {
    expect(output.stdout).toBe("");
    return { stderr: output.stderr, envelope: null };
  }
  const envelope: Envelope = JSON.parse(output.stdout);
  expect(envelope.cleanup).toMatchObject({ kind: "closed", resourcesReleased: true });
  expect(envelope.unexecuted).toEqual(operations.slice(envelope.results.length).map((o) => o.commandId));
  for (const [index, result] of envelope.results.entries()) {
    expect(result.correlation.commandId).toBe(operations[index]!.commandId);
    expect(validateSemanticResult(result.correlation, result).success).toBe(true);
  }
  return { stderr: output.stderr, envelope };
}
function bodies(result: SemanticResult) {
  return result.discovery!.model!.bodies;
}
function expectBounds(bounds: { min: readonly number[]; max: readonly number[] } | null, min: number[], max: number[]) {
  for (const axis of [0, 1, 2]) {
    expect(bounds!.min[axis]).toBeCloseTo(min[axis]!, 5);
    expect(bounds!.max[axis]).toBeCloseTo(max[axis]!, 5);
  }
}
function labelled(result: SemanticResult, label: string, kind: string) {
  return result.discovery!.references.filter((r) => r.label === label && r.target.kind === kind).map((r) => r.target);
}
/** Replace one example operation (by command ID) and keep the rest of the recipe. */
function withOperation(commandId: string, patch: Operation, operations = example) {
  return operations.map((o) => (o.commandId === commandId ? { ...o, ...patch } : o));
}
const prefix = () => example.slice(0, 7);

test("the shipped scoped-profile example selects each same-labelled profile by its owning sketch in one process", async () => {
  const output = await promisify(execFile)("bun", [cliEntry(), "document", "recipe", shippedExample()], { ...options, encoding: "utf8" });
  const envelope: Envelope = JSON.parse(output.stdout);
  expect(envelope.unexecuted).toEqual([]);
  expect(envelope.cleanup).toMatchObject({ kind: "closed", resourcesReleased: true });
  const results = envelope.results;
  expect(results.map((r) => r.correlation.commandId)).toEqual(example.map((o) => o.commandId));
  for (const result of results) {
    expect(result.outcome.kind).toBe("completed");
    expect(validateSemanticResult(result.correlation, result).success).toBe(true);
  }
  // No save/open stage, helper curves or generated IDs: one region per sketch.
  expect(example.some((o) => String(o.operation).startsWith("document.open") || o.operation === "document.save")).toBe(false);
  const published = (result: SemanticResult) => {
    const sketch = result.discovery!.sketch!;
    expect(sketch.profiles).toHaveLength(1);
    return { kind: "region", sketchId: sketch.sketchId, regionId: sketch.profiles[0]!.regionId };
  };
  const base = published(results[3]!);
  const post = published(results[6]!);
  expect(post.sketchId).not.toBe(base.sketchId);
  // Unqualified "Outer region" is ambiguous across the two canonical sketches.
  expect(labelled(results[6]!, "Outer region", "region")).toEqual([base, post]);
  expect(labelled(results[8]!, "Outer region", "region")).toEqual([base, post]);

  // The yz sketch is selected first although the xy region is listed first.
  expect(bodies(results[6]!)).toEqual([]);
  expect(bodies(results[7]!)).toHaveLength(1);
  const postBody = bodies(results[7]!)[0]!;
  expectBounds(postBody.bounds, [0, 30, 0], [12, 36, 8]);
  expect(bodies(results[8]!)).toHaveLength(2);
  const baseBody = bodies(results[8]!).find((b) => b.bodyId !== postBody.bodyId)!;
  expectBounds(baseBody.bounds, [-10, -10, 0], [10, 10, 5]);
  expectBounds(bodies(results[8]!).find((b) => b.bodyId === postBody.bodyId)!.bounds, [0, 30, 0], [12, 36, 8]);
  for (const body of [postBody, baseBody])
    expect(body.topology!.filter((t) => t.entityClass === "face")).toHaveLength(6);
}, 120000);

test("a private draft alias qualifies in-draft selections, and multiple matches inside one owner stay ambiguous", async () => {
  const operations = [
    ...example.slice(0, 6),
    {
      version: 1,
      commandId: "relabel",
      operation: "sketch.label.set",
      basis: { alias: "postRectangle" },
      draft: { alias: "postRectangle" },
      // Both sketches own a "Rectangle 1 left" line; only the draft's is selected.
      target: { alias: "postRectangle", label: "Rectangle 1 left", sketch: "postRectangle" },
      label: "Outer region",
      intent: "fulfill",
      as: "relabelled",
    },
    { ...example[6]!, basis: { alias: "relabelled" }, draft: { alias: "relabelled" } },
    {
      version: 1,
      commandId: "delete",
      operation: "target.delete",
      basis: { alias: "post" },
      target: { alias: "post", label: "Outer region", sketch: "post" },
      intent: "fulfill",
    },
    { version: 1, commandId: "rename", operation: "document.rename", basis: { alias: "post" }, label: "Must not run" },
  ];
  const { stderr, envelope } = await run(operations, 1);
  const results = envelope!.results;
  expect(results).toHaveLength(8);
  expect(stderr).toContain("Sketch target alias is missing or ambiguous.");
  const draftSketch = (results[5]!.discovery!.state.editingContext as { sketchId: string }).sketchId;
  const baseSketch = results[3]!.discovery!.sketch!.sketchId;
  expect(labelled(results[6]!, "Outer region", "sketchEntity")).toEqual([expect.objectContaining({ sketchId: draftSketch })]);
  expect(labelled(results[6]!, "Rectangle 1 left", "sketchEntity")).toEqual([expect.objectContaining({ sketchId: baseSketch })]);
  // The published owner holds both an "Outer region" region and line: refused, nothing deleted.
  const postSketch = results[7]!.discovery!.sketch!.sketchId;
  const owned = results[7]!.discovery!.references.filter((r) => r.label === "Outer region" && "sketchId" in r.target && r.target.sketchId === postSketch);
  expect(owned.map((r) => r.target.kind).sort()).toEqual(["region", "sketchEntity"]);
});

test("missing owners are usage errors before runtime startup", async () => {
  for (const sketch of ["unknown", "baseSolid", { kind: "sketch", sketchId: "sketch_guess" }, ""])
    await run(withOperation("post-extrude", { profile: { alias: "post", label: "Outer region", sketch } }), 2);
  await run(withOperation("post-extrude", { profile: { alias: "post", label: "Outer region", sketch: "post", extra: true } }), 2);
});

test("owners without sketch identity, foreign or stale-draft owners and wrong eligible kinds fail before the mutation", async () => {
  const cases: [Operation, string][] = [
    [{ alias: "post", label: "Outer region", sketch: "part" }, "Sketch owner alias has no sketch identity."],
    // The base snapshot predates the yz sketch: its owner is foreign there.
    [{ alias: "base", label: "Outer region", sketch: "post" }, "Profile target alias is missing or ambiguous."],
    // A new draft's private identity is not its published identity.
    [{ alias: "post", label: "Outer region", sketch: "postRectangle" }, "Profile target alias is missing or ambiguous."],
    // "Sketch Draft" exists inside the owner, but as a sketch, not a region.
    [{ alias: "post", label: "Sketch Draft", sketch: "post" }, "Profile target alias is missing or ambiguous."],
  ];
  for (const [profile, message] of cases) {
    const { stderr, envelope } = await run(withOperation("post-extrude", { profile }), 1);
    expect(stderr).toContain(message);
    expect(envelope!.results).toHaveLength(7);
    expect(envelope!.unexecuted).toEqual(["post-extrude", "base-extrude"]);
    expect(envelope!.results.every((r) => r.outcome.kind === "completed")).toBe(true);
    expect(bodies(envelope!.results[6]!)).toEqual([]);
    if (profile.label === "Sketch Draft")
      expect(labelled(envelope!.results[6]!, "Sketch Draft", "sketch")).toHaveLength(2);
  }
});

test("a qualified selection of a deleted sketch's profile is a stale target, refused without authoring a body", async () => {
  const operations = [
    ...prefix(),
    {
      version: 1,
      commandId: "delete-base",
      operation: "target.delete",
      basis: { alias: "post" },
      // Both sketches are labelled "Sketch Draft"; the owner picks the xy sketch.
      target: { alias: "post", label: "Sketch Draft", sketch: "base" },
      intent: "fulfill",
      as: "deleted",
    },
    { ...example[8]!, basis: { alias: "deleted" }, profile: { alias: "post", label: "Outer region", sketch: "base" } },
    { version: 1, commandId: "rename", operation: "document.rename", basis: { alias: "deleted" }, label: "Must not run" },
  ];
  const { envelope } = await run(operations, 1);
  const results = envelope!.results;
  expect(results).toHaveLength(9);
  const base = results[3]!.discovery!.sketch!.sketchId;
  const post = results[6]!.discovery!.sketch!.sketchId;
  expect(results[7]!.outcome.kind).toBe("completed");
  expect(labelled(results[7]!, "Sketch Draft", "sketch")).toEqual([{ kind: "sketch", sketchId: post }]);
  expect(labelled(results[7]!, "Outer region", "region")).toEqual([expect.objectContaining({ sketchId: post })]);
  expect(base).not.toBe(post);
  // The resolved region is the deleted xy sketch's, so the session refuses it.
  expect(results[8]!.outcome).toEqual({ kind: "rejected", reasonCode: "profiles-unusable" });
  expect(results[8]!.completion.live.kind).toBe("unchanged");
  expect(bodies(results[7]!)).toEqual([]);
});

test("qualified selectors keep basis and private-draft currentness checks", async () => {
  const staleBasis = await run(withOperation("base-extrude", { basis: { alias: "post" } }), 1);
  expect(staleBasis.envelope!.results).toHaveLength(9);
  expect(staleBasis.envelope!.results[8]!.outcome.kind).toBe("conflicted");
  expect(bodies(staleBasis.envelope!.results[7]!)).toHaveLength(1);

  const staleDraft = await run([
    ...example.slice(0, 6),
    {
      version: 1,
      commandId: "relabel",
      operation: "sketch.label.set",
      basis: { alias: "postRectangle" },
      // The draft generation advanced when the rectangle was authored.
      draft: { alias: "postDraft" },
      target: { alias: "postRectangle", label: "Rectangle 1 left", sketch: "postRectangle" },
      label: "Renamed",
      intent: "fulfill",
    },
  ], 1);
  const refused = staleDraft.envelope!.results[6]!;
  expect(refused.outcome.kind).toBe("conflicted");
  expect(refused.completion.live.kind).toBe("unchanged");
});
