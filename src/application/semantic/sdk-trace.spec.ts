import { expect, test } from "vitest";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";
import { SemanticDocument } from "./sdk";
import { SemanticTraceError } from "./sdk-trace";
import { RecipeReferenceError } from "./target-creation-references";
import { validateRecipe } from "@/contracts/semantic/recipe.runtime-schema";
import { validateRecipeOperation } from "@/contracts/semantic/recipe-command.runtime-schema";
import { ContractValidationError } from "@/contracts/shared/validation";
import type { RecipeTrace, RecipeCommand } from "@/contracts/semantic/recipe";
import type { RecipeReference } from "@/contracts/semantic/recipe-references";
import type { SemanticDiscovery } from "@/contracts/semantic/schema";
import { resolveSemanticCommand } from "./target-resolution";
import { semanticCreationOutputs } from "@/contracts/semantic/creation-outputs";

const reference: RecipeReference = { kind: "recipeRef", version: 1, createdBy: "point", owner: { alias: "sketch" }, output: { kind: "sketchPoint", role: "authoredPoint", index: 0 } };
const recipe: RecipeTrace = { version: 2, operations: [
  { version: 1, commandId: "create", operation: "document.create", basis: null, label: "Portable", as: "doc" },
  { version: 1, commandId: "begin", operation: "sketch.begin", basis: { alias: "doc" }, plane: "xy", as: "sketch" },
  { version: 1, commandId: "point", operation: "sketch.author", basis: { alias: "sketch" }, draft: { alias: "sketch" }, primitive: { kind: "point", position: [0, 0] }, construction: false, intent: "fulfill", as: "point" },
  { version: 1, commandId: "edit", operation: "sketch.construction.set", basis: { alias: "point" }, draft: { alias: "point" }, target: reference, construction: true, intent: "fulfill" },
] };
test("generated recipe operation boundary accepts creation references without relaxing closed commands", () => {
  expect(validateRecipeOperation(recipe.operations[3]).success).toBe(true);
  expect(validateRecipeOperation({ ...recipe.operations[3], extra: true }).success).toBe(false);
});
type MalformedRecipe = { version: number; extra?: boolean; operations: { target: { kind: string; version: number; createdBy: string; owner: { alias: string }; output: { kind: string; role: string; index: number }; extra?: boolean }; primitive: unknown }[] };

test.each([
  ["envelope version", (r: MalformedRecipe) => { r.version = 9; }],
  ["unknown reference tag", (r: MalformedRecipe) => { r.operations[3]!.target.kind = "otherRef"; }],
  ["reference version", (r: MalformedRecipe) => { r.operations[3]!.target.version = 2; }],
  ["extra envelope key", (r: MalformedRecipe) => { r.extra = true; }],
  ["extra reference key", (r: MalformedRecipe) => { r.operations[3]!.target.extra = true; }],
  ["negative slot", (r: MalformedRecipe) => { r.operations[3]!.target.output.index = -1; }],
  ["fractional slot", (r: MalformedRecipe) => { r.operations[3]!.target.output.index = 0.5; }],
  ["unknown producer", (r: MalformedRecipe) => { r.operations[3]!.target.createdBy = "missing"; }],
  ["forward producer", (r: MalformedRecipe) => { r.operations[2]!.primitive = { kind: "tangentArc", start: [0, 0], end: [2, 2], direction: [1, 0], source: r.operations[3]!.target }; }],
  ["wrong producer role", (r: MalformedRecipe) => { r.operations[3]!.target.createdBy = "doc"; }],
  ["unknown owner", (r: MalformedRecipe) => { r.operations[3]!.target.owner.alias = "missing"; }],
  ["kind/role mismatch", (r: MalformedRecipe) => { r.operations[3]!.target.output.kind = "sketchEntity"; }],
  ["v1 creation reference", (r: MalformedRecipe) => { r.version = 1; }],
] as const)("recipe transport refuses %s before any execution", async (_name, mutate) => {
  const malformed = structuredClone(recipe);
  mutate(malformed as unknown as MalformedRecipe);
  expect((await validateRecipe(malformed)).success).toBe(false);
  let executed = false;
  const doc = new SemanticDocument({ execute: async () => { executed = true; throw new Error("Must not execute"); }, close: async () => ({ kind: "closed", resourcesReleased: true, settled: [] }) });
  await expect(doc.replay(malformed)).rejects.toBeInstanceOf(ContractValidationError);
  expect(executed).toBe(false);
  expect(doc.commands()).toEqual([]);
});

test("v1 remains readable and unchanged label ambiguity is not resolved by list order", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-v1");
  const doc = new SemanticDocument(workflow.session);
  try {
    const legacy = JSON.parse(JSON.stringify(recipe));
    legacy.version = 1;
    legacy.operations[3].target = { alias: "point", label: "Point 1" };
    expect((await validateRecipe(legacy)).success).toBe(true);
    expect((await doc.replay(legacy)).every(r => r.outcome.kind === "completed")).toBe(true);
    expect(doc.current!.discovery!.sketch!.points[0]!.construction).toBe(true);
    expect(doc.trace().version).toBe(2);
  } finally { await doc.close(); }
});

async function shuffledDocument(reverse = true) {
  const workflow = await createSemanticSessionWorkflow("sdk-shuffled");
  const shuffle = (d: SemanticDiscovery): SemanticDiscovery => ({ ...d, references: [...d.references].reverse(), ...(d.sketch ? { sketch: { ...d.sketch, points: [...d.sketch.points].reverse(), entities: [...d.sketch.entities].reverse() } } : {}) });
  return new SemanticDocument({ execute: async (c, o) => {
    const r = await workflow.session.execute(c, o);
    return { ...r, discovery: r.discovery && reverse ? shuffle(r.discovery) : r.discovery };
  }, close: () => workflow.close() });
}

test("creation bindings survive relabels, cross-owner equal labels, unrelated creations and shuffled discovery", async () => {
  const doc = await shuffledDocument();
  const copy = await shuffledDocument(false);
  try {
    await doc.ops.document.create({ label: "Owners" });
    await doc.ops.sketch.begin({ plane: "xy" });
    const first = await doc.ops.sketch.author({ primitive: { kind: "circle", center: [0, 0], radius: 2 }, construction: false });
    const a = first.discovery!.sketch!.entities[0]!;
    const ta = { kind: "sketchEntity", sketchId: first.discovery!.sketch!.sketchId!, entityId: a.entityId } as const;
    await doc.ops.sketch.author({ primitive: { kind: "circle", center: [10, 0], radius: 3 }, construction: false });
    const b = doc.current!.discovery!.sketch!.entities.find(e => e.entityId !== a.entityId)!;
    const tb = { ...ta, entityId: b.entityId };
    for (const target of [ta, tb]) await doc.ops.sketch.label.set({ target, label: "duplicate" });
    await doc.ops.sketch.geometry.update({ edit: { kind: "radius", target: ta, radius: 4 } });
    await doc.ops.sketch.geometry.update({ edit: { kind: "radius", target: tb, radius: 7 } });
    await doc.ops.sketch.construction.set({ target: ta, construction: true });
    await doc.ops.sketch.label.set({ target: ta, label: "renamed" });
    await doc.ops.sketch.requirement.add({ tool: "constraintFix", targets: [tb], mode: "driving", value: null });
    const published = await doc.ops.sketch.publish({ requireProfiles: false });
    await doc.ops.sketch.begin({ plane: "xz" });
    await doc.ops.sketch.author({ primitive: { kind: "circle", center: [20, 0], radius: 9 }, construction: false });
    await doc.ops.sketch.label.set({ target: doc.references({ kind: "sketchEntity" }).find(r => r.target.sketchId === doc.current!.discovery!.sketch!.sketchId)!.target, label: "duplicate" });
    await doc.ops.sketch.publish({ requireProfiles: false });
    await doc.ops.sketch.open({ sketchId: published.discovery!.sketch!.sketchId! });
    await doc.ops.sketch.author({ primitive: { kind: "point", position: [-30, -40] }, construction: true });
    const trace = JSON.parse(JSON.stringify(doc.trace()));
    const before = JSON.stringify(doc.current!.result);
    expect((await copy.replay(trace)).every(r => r.outcome.kind === "completed")).toBe(true);
    const facts = (d: SemanticDocument) => {
      const s = d.current!.discovery!.sketch!;
      return { entities: s.entities.map(e => ({ kind: e.kind, radius: e.radius, construction: e.construction })).sort((a, b) => (a.radius ?? 0) - (b.radius ?? 0)), points: s.points.map(p => [p.position, p.construction]).sort(), requirements: s.requirements.map(r => r.label), labels: d.references({ kind: "sketchEntity", owner: { kind: "sketch", sketchId: s.sketchId! } }).map(r => r.label).sort() };
    };
    expect(facts(copy)).toEqual(facts(doc));
    expect(facts(copy).entities).toEqual([{ kind: "point", radius: undefined, construction: true }, { kind: "circle", radius: 4, construction: true }, { kind: "circle", radius: 7, construction: false }]);
    expect(facts(copy).labels).toEqual(["Point entity 4", "duplicate", "renamed"]);
    expect(facts(copy).requirements).not.toHaveLength(0);
    expect(copy.current!.discovery!.sketch!.sketchId).not.toBe(doc.current!.discovery!.sketch!.sketchId);
    expect(JSON.stringify(doc.current!.result)).toBe(before);
  } finally { await doc.close(); await copy.close(); }
});

test("pre-existing ambiguous asset targets refuse export precisely without changing history or model", async () => {
  let saved = "";
  const make = async () => {
    const workflow = await createSemanticSessionWorkflow("sdk-external", { nativeFileIO: {
      read: async () => saved,
      write: async (_path, text) => { saved = text; return { kind: "written", bytesWritten: text.length, diagnostics: [] }; },
    } });
    return new SemanticDocument(workflow.session);
  };
  const source = await make();
  const opened = await make();
  try {
    await source.ops.document.create({ label: "External" });
    await source.ops.sketch.begin({ plane: "xy" });
    for (const position of [[0, 0], [2, 3]] as const) {
      await source.ops.sketch.author({ primitive: { kind: "point", position }, construction: false });
      const target = source.references({ kind: "sketchPoint" }).at(-1)!.target;
      await source.ops.sketch.label.set({ target, label: "duplicate" });
    }
    await source.ops.sketch.publish({ requireProfiles: false });
    await source.ops.document.save({ path: "asset.cadara" });
    await opened.ops.document.open({ path: "asset.cadara" });
    await opened.ops.sketch.open({ sketchId: opened.references({ kind: "sketch" })[0]!.target.sketchId });
    const target = opened.references({ kind: "sketchPoint" })[0]!.target;
    await opened.ops.sketch.construction.set({ target, construction: true });
    const state = JSON.stringify(opened.current!.result);
    const commands = opened.commands();
    expect(() => opened.trace()).toThrow(SemanticTraceError);
    try { opened.trace(); } catch (error) {
      expect(error).toMatchObject({ operation: "sketch.construction.set", reference: target, path: "target" });
      expect((error as SemanticTraceError).reason).toContain("Missing creation provenance");
    }
    expect(opened.commands()).toEqual(commands);
    expect(JSON.stringify(opened.current!.result)).toBe(state);
  } finally { await source.close(); await opened.close(); }
});

test("creation reference errors preserve the executed prefix and identify wrong owner, slot, kind and deleted output", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-bad-bindings");
  const doc = new SemanticDocument(workflow.session);
  try {
    await doc.replay({ version: 2, operations: recipe.operations.slice(0, 3) });
    const state = JSON.stringify(doc.current!.result);
    const history = doc.commands();
    for (const target of [
      { ...reference, owner: { alias: "doc" } },
      { ...reference, output: { ...reference.output, index: 8 } },
      { ...reference, createdBy: "missing" },
    ]) {
      await expect(doc.execute({ ...recipe.operations[3]!, target } as RecipeCommand)).rejects.toBeInstanceOf(RecipeReferenceError);
      expect(doc.commands()).toEqual(history);
      expect(JSON.stringify(doc.current!.result)).toBe(state);
    }
    const wrongKind: RecipeCommand = { version: 1, commandId: "wrongKind", operation: "sketch.geometry.update", basis: { alias: "point" }, draft: { alias: "point" }, edit: { kind: "radius", target: reference, radius: 4 }, intent: "fulfill" };
    await expect(doc.execute(wrongKind)).rejects.toBeInstanceOf(RecipeReferenceError);
    await doc.ops.sketch.geometry.delete({ targets: [doc.references({ kind: "sketchPoint" })[0]!.target] });
    const deletedState = JSON.stringify(doc.current!.result);
    await expect(doc.execute(recipe.operations[3]!)).rejects.toMatchObject({ name: "RecipeReferenceError", path: "target", reason: expect.stringContaining("missing or deleted") });
    expect(JSON.stringify(doc.current!.result)).toBe(deletedState);
  } finally { await doc.close(); }
});

test("probe edits duplicate-labelled dimensions by creation output after an omitted write", async () => {
  let writes = 0;
  const make = async (): Promise<SemanticDocument> => {
    const workflow = await createSemanticSessionWorkflow("sdk-duplicate-probe", { nativeFileIO: {
      read: async () => { throw new Error("Unexpected read"); },
      write: async (_path, text) => { writes++; return { kind: "written", bytesWritten: text.length, diagnostics: [] }; },
    } });
    return new SemanticDocument(workflow.session, undefined, make);
  };
  const doc = await make();
  try {
    await doc.ops.document.create({ label: "Duplicate probe" });
    await doc.ops.document.save({ path: "source.cadara" });
    await doc.ops.sketch.begin({ plane: "xy" });
    await doc.ops.sketch.author({ primitive: { kind: "rectangle", start: [0, 0], end: [4, 2] }, construction: false });
    const points = doc.current!.discovery!.sketch!.points;
    await doc.ops.sketch.dimension.add({ axis: "horizontal", points: [points[0]!.pointId, points[1]!.pointId], mode: "driving", value: 4 });
    const horizontal = doc.current!.discovery!.sketch!.requirements[0]!;
    await doc.ops.sketch.dimension.add({ axis: "vertical", points: [points[1]!.pointId, points[2]!.pointId], mode: "driving", value: 2 });
    const vertical = doc.current!.discovery!.sketch!.requirements.find(d => d.dimensionId !== horizontal.dimensionId)!;
    for (const dimension of [horizontal, vertical]) await doc.ops.sketch.label.set({ target: { kind: "dimension", sketchId: doc.current!.discovery!.sketch!.sketchId!, dimensionId: dimension.dimensionId }, label: "duplicate" });
    const state = JSON.stringify(doc.current!.result);
    const trace = doc.trace();
    const probe = await doc.probe([
      { operation: "sketch.dimension.update", fields: { dimensionId: horizontal.dimensionId, value: 6 } },
      { operation: "sketch.dimension.update", fields: { dimensionId: vertical.dimensionId, value: 5 } },
    ]);
    expect(probe.results.map(r => r.outcome.kind)).toEqual(["completed", "completed"]);
    const final = probe.results.at(-1)!.discovery!.sketch!.points;
    const xs = final.map(p => p.position[0]), ys = final.map(p => p.position[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(5);
    expect(doc.trace()).toEqual(trace);
    expect(JSON.stringify(doc.current!.result)).toBe(state);
    expect(writes).toBe(1);
  } finally { await doc.close(); }
});

test("repeated fit-point IDs bind to ordered occurrences, rebind fresh handles, and refuse changed or stale occurrence slots", () => {
  const state = { documentId: "doc_repeat", revisionId: "rev_repeat", repositoryHeads: [], editingContext: { kind: "document" }, draft: null } as const;
  const basis = { documentId: state.documentId, revisionId: state.revisionId, repositoryHeads: state.repositoryHeads };
  const entity = { entityId: "sketch_entity_spline" as const, kind: "spline" as const, construction: false, pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_a"], tangents: [
    { pointId: "sketch_point_a", occurrenceId: "occ_start", vector: null }, { pointId: "sketch_point_b", occurrenceId: "occ_middle", vector: null }, { pointId: "sketch_point_a", occurrenceId: "occ_end", vector: null },
  ] };
  const discovery = { state, references: [], history: null, sketch: { sketchId: "sketch_repeat", points: [], entities: [entity] } } as unknown as SemanticDiscovery;
  const producer = { version: 1, commandId: "spline", operation: "sketch.author", basis, primitive: { kind: "spline", fitPoints: [[0, 0], [3, 2], [0, 0]] }, construction: false, intent: "fulfill" } as const;
  const outputs = semanticCreationOutputs({ ...producer, draft: { commandSessionId: "command_repeat", generation: 1 } }, undefined, discovery);
  const context = { discovery, aliases: new Map([["owner", discovery]]), creations: new Map([["spline", outputs]]) };
  const command = (index: number) => ({ version: 1, commandId: "tangent", operation: "sketch.geometry.update", basis, draft: { commandSessionId: "command_repeat", generation: 1 }, edit: { kind: "tangent", target: { kind: "recipeRef", version: 1, createdBy: "spline", owner: { alias: "owner" }, output: { kind: "sketchTangentHandle", role: "splineOccurrence", index } }, vector: [2, 0] }, intent: "fulfill" } as const);
  expect(resolveSemanticCommand(command(0), context)).toMatchObject({ edit: { target: { pointId: "sketch_point_a", occurrenceId: "occ_start" } } });
  expect(resolveSemanticCommand(command(2), context)).toMatchObject({ edit: { target: { pointId: "sketch_point_a", occurrenceId: "occ_end" } } });
  entity.tangents[2]!.occurrenceId = "occ_reopened";
  expect(resolveSemanticCommand(command(2), context)).toMatchObject({ edit: { target: { occurrenceId: "occ_reopened" } } });
  expect(() => resolveSemanticCommand(command(3), context)).toThrow(RecipeReferenceError);
  entity.pointIds.pop();
  expect(() => resolveSemanticCommand(command(2), context)).toThrow(/expired occurrence/);
  expect(() => resolveSemanticCommand(command(0), { ...context, creations: new Map() })).toThrow(/unknown or unavailable creation producer/);
  expect(() => resolveSemanticCommand(command(0), { ...context, discovery: { ...discovery, sketch: { ...discovery.sketch!, entities: [] } } })).toThrow(/expired occurrence/);
});
