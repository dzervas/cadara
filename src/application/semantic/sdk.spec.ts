import { expect, test } from "vitest";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";
import { SemanticDocument, SemanticOperationError, type SemanticHandle } from "./sdk";
import { createSemanticSessionFactory } from "./session";
import { semanticCommandCorrelation } from "@/contracts/semantic/correlation";
import type { SemanticOutcome, SemanticState, SemanticResult } from "@/contracts/semantic/schema";
import { SelectionError } from "./selection-error";
import { validateRecipeOperation } from "@/contracts/semantic/recipe-command.runtime-schema";
test("SDK handles chain private drafts and retain stale basis conflicts", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk");
  const doc = new SemanticDocument(workflow.session);
  try {
    const created = await doc.ops.document.create({ label: "SDK plate" });
    const sketch = await created.ops.sketch.begin({ plane: "xy" });
    const authored = await sketch.ops.sketch.author({
      primitive: { kind: "rectangle", start: [0, 0], end: [40, 20] },
      construction: false,
    });
    expect(authored.discovery?.sketch?.entities).toHaveLength(4);
    const published = await authored.ops.sketch.publish({ requireProfiles: true });
    expect(published.discovery?.state.draft).toBeNull();
    try {
      await created.ops.document.rename({ label: "stale" });
      throw new Error("Expected stale handle to conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticOperationError);
      expect((error as SemanticOperationError).result.outcome.kind).toBe("conflicted");
    }
    await doc.ops.document.rename({ label: "current" });
    expect(doc.current?.discovery?.document?.label).toBe("current");
  } finally {
    await doc.close();
  }
});


const initial: SemanticState = {
  documentId: "doc_sdk", revisionId: "rev_sdk", repositoryHeads: ["sdk_head"],
  editingContext: { kind: "document" }, draft: null,
};
async function outcomeDocument(outcome: SemanticOutcome, appliedState?: SemanticState) {
  const opened = await createSemanticSessionFactory(async () => ({
    initialize: async () => ({ kind: "ready", discovery: { state: initial, references: [], history: null } }),
    create: async () => { throw new Error("unused"); },
    inspect: async () => ({ discovery: { state: initial, references: [], history: null }, diagnostics: [] }),
    variable: async (command): Promise<SemanticResult> => {
      const invalid = outcome.kind === "accepted-invalid";
      const state = appliedState ?? initial;
      return {
        version: 1, correlation: semanticCommandCorrelation(command), outcome,
        completion: {
          live: { kind: invalid || appliedState ? "applied" : "unchanged", state },
          handoff: { kind: "current", state },
          geometry: { kind: invalid ? "invalid-editable" : "current", state, sketchBasis: null, solve: null, derivation: null, rebuildRevisionId: state.revisionId },
          persistence: invalid ? { kind: "committed", commandId: command.commandId, transactionId: "tx", state } : { kind: "not-required" },
          file: { kind: "not-required" },
        }, diagnostics: [{ code: "sdk-test", severity: "info", message: "Full outcome evidence", target: null, detail: null }], discovery: appliedState ? null : { state, references: [], history: null },
      };
    },
    drain: async () => {}, release: async () => {},
  })).open();
  if (opened.kind !== "ready") throw new Error("Expected ready");
  return new SemanticDocument(opened.session, opened.initialization.state);
}

for (const outcome of [
  { kind: "completed", change: "unchanged" },
  { kind: "accepted-invalid" },
  { kind: "canceled", phase: "not-started" },
  { kind: "rejected", reasonCode: "test-refusal" },
  { kind: "conflicted", actualBasis: { documentId: initial.documentId, revisionId: initial.revisionId, repositoryHeads: initial.repositoryHeads } },
  { kind: "unavailable", capability: "test-capability" },
  { kind: "failed", failures: ["execution"] },
] as const) {
  test(`SDK maps ${outcome.kind} to return/throw and non-throwing values`, async () => {
    const doc = await outcomeDocument(outcome);
    const fields = { variableId: "variable_test" as const, name: "width", valueText: "12", intent: "author-invalid" as const };
    try {
      const returns = ["completed", "accepted-invalid", "canceled"].includes(outcome.kind);
      if (returns) expect((await doc.op("variable.update", fields)).result.outcome).toEqual(outcome);
      else await expect(doc.op("variable.update", fields)).rejects.toMatchObject({ result: { outcome } });
      const attempted = await doc.tryOp("variable.update", fields);
      expect(attempted.ok).toBe(returns);
      if (attempted.ok) expect(attempted.handle.result.outcome).toEqual(outcome);
      else {
        expect(attempted.error).toBeInstanceOf(SemanticOperationError);
        expect((attempted.error as SemanticOperationError).result).toEqual(doc.results().at(-1));
        expect((attempted.error as SemanticOperationError).result.diagnostics).toEqual([{ code: "sdk-test", severity: "info", message: "Full outcome evidence", target: null, detail: null }]);
      }
      expect(doc.commands()).toHaveLength(outcome.kind === "completed" || outcome.kind === "accepted-invalid" ? 2 : 0);
    } finally { await doc.close(); }
  });
}

test("SDK propagates programming exceptions even from tryOp", async () => {
  const crash = new Error("programming defect");
  const doc = new SemanticDocument({
    execute: async () => { throw crash; },
    close: async () => ({ kind: "closed", settled: [], resourcesReleased: true }),
  }, initial);
  try {
    await expect(doc.tryOp("variable.update", { variableId: "variable_test", name: "width", valueText: "12" })).rejects.toBe(crash);
  } finally { await doc.close(); }
});


test("SDK live selection keeps candidates, scopes queries, and converts the discovered sketch frame", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-query");
  const doc = new SemanticDocument(workflow.session);
  try {
    await doc.op("document.create", { label: "Scoped" });
    expect(doc.canRun("sketch.begin")).toBe(true);
    expect(doc.canRun("not.an.operation" as never)).toBe(false);
    let firstSketch: SemanticHandle | undefined;
    for (let i = 0; i < 2; i++) {
      await doc.ops.sketch.begin({ plane: "xz" });
      await doc.ops.sketch.author({ primitive: { kind: "rectangle", start: [0, 0], end: [4, 2] }, construction: false });
      expect(doc.localToWorld([3, 2])).toEqual([3, 0, 2]);
      expect(doc.worldToLocal([3, 17, 2])).toEqual([3, 2]);
      const published = await doc.ops.sketch.publish({ requireProfiles: true });
      if (i === 0) firstSketch = published;
      const owner = { kind: "sketch" as const, sketchId: published.discovery!.sketch!.sketchId! };
      expect(doc.references({ owner, kind: "region" })).toHaveLength(1);
    }
    const attempt = await doc.tryOp("extrude.create", { profile: { label: "Outer region" }, depth: 2, intent: "fulfill" });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) throw new Error("Expected ambiguous selection");
    expect(attempt.error).toBeInstanceOf(SelectionError);
    expect((attempt.error as SelectionError).selection.candidates).toHaveLength(2);
    await doc.op("extrude.create", { profile: firstSketch!.ref("Outer region"), depth: 2 });
    expect(doc.topology("face")).toHaveLength(6);
    expect(doc.topology("face")[0]).toMatchObject({ reference: { target: { kind: "face" } } });
    expect(Object.keys(doc.inspect(["bounds", "topologyCounts"]))).toEqual(["bounds", "topologyCounts"]);
    expect(doc.inspect(["bounds"]).bounds).toEqual([{ min: [0, -2, 0], max: [4, 0, 2] }]);
  } finally { await doc.close(); }
});

test("SDK capability polling refuses export formats absent from discovery", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-export-capabilities");
  const doc = new SemanticDocument({
    execute: async (command, options) => {
      const result = await workflow.session.execute(command, options);
      return { ...result, discovery: result.discovery ? {
        ...result.discovery,
        exportProviders: result.discovery.exportProviders?.filter((provider) => provider.format === "step"),
      } : null };
    },
    close: () => workflow.close(),
  });
  try {
    await doc.ops.document.create({ label: "STEP only" });
    expect(doc.canRun("export.step")).toBe(true);
    expect(doc.canRun("export.stl")).toBe(false);
    expect(doc.canRun("export.svg")).toBe(false);
    expect(doc.canRun("sketch.begin")).toBe(true);
    await doc.close();
    expect(doc.canRun("export.step")).toBe(false);
  } finally { await doc.close(); }
});

test("SDK trace omits caught failures and replays the final model; probes edit only a disposable document", async () => {
  const makeDocument = async (): Promise<SemanticDocument> => {
    const workflow = await createSemanticSessionWorkflow("sdk-probe");
    return new SemanticDocument(workflow.session, undefined, makeDocument);
  };
  const doc = await makeDocument();
  const replay = await makeDocument();
  try {
    await doc.ops.document.create({ label: "Trace plate" });
    await doc.ops.variable.add({ name: "depth", valueText: "2" });
    await doc.ops.sketch.begin({ plane: "xy" });
    await doc.ops.sketch.author({ primitive: { kind: "rectangle", start: [0, 0], end: [4, 2] }, construction: false });
    await doc.ops.sketch.publish({ requireProfiles: true });
    const region = doc.references({ kind: "region" })[0]!.target as Extract<import("@/contracts/shared/references").DurableRef, { kind: "region" }>;
    await doc.ops.extrude.create({ profile: region, depth: "depth" });
    try {
      await doc.ops.sketch.open({ sketchId: "sketch_missing" });
      throw new Error("Expected missing sketch rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticOperationError);
      const result = (error as SemanticOperationError).result;
      expect(result).toEqual(doc.results().at(-1));
      expect(result.outcome.kind).toBe("rejected");
      expect(result.diagnostics).toEqual(doc.results().at(-1)!.diagnostics);
    }
    await doc.ops.document.rename({ label: "Repaired plate" });
    const source = JSON.stringify(doc.current!.result);
    const sourceCommands = JSON.stringify(doc.commands());
    const probe = await doc.probe([{ operation: "variable.update", fields: { variableId: doc.inspect(["variables"]).variables[0]!.variableId, name: "depth", valueText: "5" } }]);
    expect(probe.results[0]!.outcome.kind).toBe("completed");
    expect(probe.facts.bounds).toEqual([{ min: [0, 0, 0], max: [4, 2, 5] }]);
    expect(probe.cleanup.kind).toBe("closed");
    expect(JSON.stringify(doc.current!.result)).toBe(source);
    expect(JSON.stringify(doc.commands())).toBe(sourceCommands);
    const features = doc.inspect(["features"]).features.map((f) => [f.kind, f.label]);
    const trace = doc.trace();
    expect(trace.operations.every(operation => validateRecipeOperation(operation).success)).toBe(true);
    expect(trace.version).toBe(2);
    expect(trace.operations.some((operation) => operation.operation === "sketch.open")).toBe(false);
    expect(trace.operations.at(-1)!.operation).toBe("document.rename");
    const results = await replay.replay(trace);
    expect(results.every((result) => result.outcome.kind === "completed")).toBe(true);
    const discovery = results.at(-1)!.discovery!;
    expect(discovery.document?.label).toBe("Repaired plate");
    expect(discovery.model?.bodies.map((b) => b.bounds)).toEqual([{ min: [0, 0, 0], max: [4, 2, 2] }]);
    expect(discovery.model?.features.map((f) => [f.kind, f.label])).toEqual(features);
  } finally { await doc.close(); await replay.close(); }
});


test("trace round-trips both same-owner duplicate points with distinct edits", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-trace-ambiguity");
  const doc = new SemanticDocument(workflow.session);
  try {
    await doc.ops.document.create({ label: "Ambiguous trace" });
    await doc.ops.sketch.begin({ plane: "xy" });
    for (const position of [[0, 0], [1, 1]] as const) {
      await doc.ops.sketch.author({ primitive: { kind: "point", position }, construction: false });
    }
    const points = doc.references({ kind: "sketchPoint" });
    for (const point of points) await doc.ops.sketch.label.set({ target: point.target as Extract<typeof point.target, { kind: "sketchPoint" }>, label: "duplicate" });
    await doc.ops.sketch.construction.set({ target: points[0]!.target as Extract<import("@/contracts/shared/references").DurableRef, { kind: "sketchPoint" }>, construction: true });
    expect(doc.current!.result.outcome.kind).toBe("completed");
    expect(doc.commands().at(-1)?.operation).toBe("sketch.construction.set");
    await doc.ops.sketch.geometry.update({ edit: { kind: "point", target: points[1]!.target as Extract<typeof points[number]["target"], { kind: "sketchPoint" }>, position: [7, 9] } });
    const trace = JSON.parse(JSON.stringify(doc.trace()));
    expect(trace.version).toBe(2);
    const copyWorkflow = await createSemanticSessionWorkflow("sdk-duplicate-copy");
    const copy = new SemanticDocument(copyWorkflow.session);
    try {
      expect((await copy.replay(trace)).every(r => r.outcome.kind === "completed")).toBe(true);
      const actual = copy.current!.discovery!.sketch!.points;
      expect(actual.map(p => [p.position, p.construction])).toEqual([[[0, 0], true], [[7, 9], false]]);
      expect(copy.references({ kind: "sketchPoint" }).map(r => r.label)).toEqual(["duplicate", "duplicate"]);
      expect(actual[0]!.pointId).not.toBe(doc.current!.discovery!.sketch!.points[0]!.pointId);
    } finally { await copy.close(); }
  } finally { await doc.close(); }
});

test("trace round-trips a tangent through its spline fit-point occurrence", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-tangent");
  const doc = new SemanticDocument(workflow.session);
  try {
    await doc.ops.document.create({ label: "Spline" });
    await doc.ops.sketch.begin({ plane: "xy" });
    await doc.ops.sketch.author({ primitive: { kind: "spline", fitPoints: [[0, 0], [3, 2], [6, 0]] }, construction: false });
    const sketch = doc.current!.discovery!.sketch!;
    const entity = sketch.entities.find((e) => e.kind === "spline")!;
    const tangent = entity.tangents![0]!;
    const target = { kind: "sketchTangentHandle", sketchId: sketch.sketchId!, entityId: entity.entityId, pointId: tangent.pointId, occurrenceId: tangent.occurrenceId } as const;
    await doc.ops.sketch.geometry.update({ edit: { kind: "tangent", target, vector: [2, 0] } });
    expect(doc.current!.discovery!.sketch!.entities.find(e => e.kind === "spline")!.tangents!.map(t => t.vector)).toEqual([[2, 0], null, null]);
    const last = doc.current!.discovery!.sketch!.entities.find(e => e.kind === "spline")!.tangents![2]!;
    await doc.ops.sketch.geometry.update({ edit: { kind: "tangent", target: { ...target, pointId: last.pointId, occurrenceId: last.occurrenceId }, vector: [0, -3] } });
    expect(doc.current!.discovery!.sketch!.entities.find(e => e.kind === "spline")!.tangents!.map(t => t.vector)).toEqual([[2, 0], null, [0, -3]]);
    const published = await doc.ops.sketch.publish({ requireProfiles: false });
    await doc.ops.sketch.open({ sketchId: published.discovery!.sketch!.sketchId! });
    const reopened = doc.current!.discovery!.sketch!;
    const liveEntity = reopened.entities.find(e => e.kind === "spline")!;
    const middle = liveEntity.tangents![1]!;
    await doc.ops.sketch.geometry.update({ edit: { kind: "tangent", target: { kind: "sketchTangentHandle", sketchId: reopened.sketchId!, entityId: liveEntity.entityId, pointId: middle.pointId, occurrenceId: middle.occurrenceId }, vector: [4, 1] } });
    expect(doc.commands().at(-1)?.operation).toBe("sketch.geometry.update");
    const trace = JSON.parse(JSON.stringify(doc.trace()));
    expect(trace.operations.at(-1).edit.target).toMatchObject({ kind: "recipeRef", version: 1 });
    expect(JSON.stringify(trace)).not.toContain(tangent.occurrenceId);
    const copyWorkflow = await createSemanticSessionWorkflow("sdk-tangent-copy");
    const copy = new SemanticDocument(copyWorkflow.session);
    try {
      expect((await copy.replay(trace)).every(r => r.outcome.kind === "completed")).toBe(true);
      const actual = copy.current!.discovery!.sketch!.entities.find(e => e.kind === "spline")!;
      expect(actual.tangents!.map(t => t.vector)).toEqual([[2, 0], [4, 1], [0, -3]]);
      expect(actual.tangents![0]!.occurrenceId).not.toBe(tangent.occurrenceId);
    } finally { await copy.close(); }
  } finally { await doc.close(); }
});

test("accepted-invalid cannot return under implicit fulfill intent", async () => {
  const doc = await outcomeDocument({ kind: "accepted-invalid" });
  try {
    const attempt = await doc.tryOp("variable.update", { variableId: "variable_test", name: "width", valueText: "12" });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) throw new Error("Implicit fulfill cannot accept invalid geometry");
    expect(attempt.error).toBeInstanceOf(SemanticOperationError);
    expect((attempt.error as SemanticOperationError).result.outcome.kind).toBe("failed");
  } finally { await doc.close(); }
});

test("a failed applied command advances authority without reusing uncertified discovery", async () => {
  const state: SemanticState = { ...initial, revisionId: "rev_afterfailure", repositoryHeads: ["head_afterfailure"] };
  const doc = await outcomeDocument({ kind: "failed", failures: ["execution"] }, state);
  try {
    for (let i = 0; i < 2; i++) {
      const attempt = await doc.tryOp("variable.update", { variableId: "variable_test", name: "width", valueText: "12" });
      expect(attempt.ok).toBe(false);
      if (attempt.ok) throw new Error("Expected execution failure");
      expect((attempt.error as SemanticOperationError).result.outcome.kind).toBe("failed");
      expect((attempt.error as SemanticOperationError).result.completion.live.state).toEqual(state);
    }
    expect(doc.current!.discovery).toBeNull();
    expect(doc.references()).toEqual([]);
    expect(doc.commands()).toHaveLength(2);
    const copy = await outcomeDocument({ kind: "failed", failures: ["execution"] }, state);
    try {
      const replay = await copy.replay({ version: 1, operations: doc.commands() });
      expect(replay).toHaveLength(1);
      expect(replay[0]!.outcome.kind).toBe("failed");
      expect(replay[0]!.completion.live).toEqual({ kind: "applied", state });
      expect(copy.commands()).toHaveLength(1);
    } finally { await copy.close(); }
  } finally { await doc.close(); }
});

test.each(["typed", "handle-ref"] as const)("dimension probes remap a %s selector after an omitted save shifts handle numbering", async (selector) => {
  let writes = 0;
  const makeDocument = async (): Promise<SemanticDocument> => {
    const workflow = await createSemanticSessionWorkflow("sdk-dimension-probe", {
      nativeFileIO: {
        read: async () => { throw new Error("Unexpected read"); },
        write: async (_path, text) => { writes++; return { kind: "written", bytesWritten: new TextEncoder().encode(text).length, diagnostics: [] }; },
      },
    });
    return new SemanticDocument(workflow.session, undefined, makeDocument);
  };
  const doc = await makeDocument();
  try {
    await doc.ops.document.create({ label: "Draft probe" });
    await doc.ops.document.save({ path: "delivered.cadara" });
    await doc.ops.sketch.begin({ plane: "xy" });
    await doc.ops.sketch.author({ primitive: { kind: "rectangle", start: [0, 0], end: [4, 2] }, construction: false });
    const points = doc.current!.discovery!.sketch!.points;
    const dimensionHandle = await doc.ops.sketch.dimension.add({ axis: "horizontal", points: [points[0]!.pointId, points[1]!.pointId], mode: "driving", value: 4 });
    const dimension = dimensionHandle.discovery!.sketch!.requirements[0]!;
    const source = JSON.stringify(doc.current!.result);
    const trace = doc.trace();
    const probe = await doc.probe([{ operation: "sketch.dimension.update", fields: { dimensionId: selector === "typed" ? dimension.dimensionId : dimensionHandle.ref(dimension.label), value: 6 } }]);
    expect(probe.results[0]!.outcome.kind).toBe("completed");
    const xs = probe.results[0]!.discovery!.sketch!.points.map((p) => p.position[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6);
    expect(JSON.stringify(doc.current!.result)).toBe(source);
    expect(doc.trace()).toEqual(trace);
    expect(writes).toBe(1);
  } finally { await doc.close(); }
});

test("disposable replay omits file writes and caught stale-handle conflicts", async () => {
  let writes = 0;
  const makeDocument = async () => {
    const workflow = await createSemanticSessionWorkflow("sdk-no-probe-writes", {
      nativeFileIO: {
        read: async () => { throw new Error("Unexpected read"); },
        write: async (_path, text) => { writes++; return { kind: "written", bytesWritten: new TextEncoder().encode(text).length, diagnostics: [] }; },
      },
    });
    return new SemanticDocument(workflow.session);
  };
  const doc = await makeDocument();
  const copy = await makeDocument();
  try {
    await doc.ops.document.create({ label: "No overwrite" });
    const saved = await doc.ops.document.save({ path: "delivered.cadara" });
    await doc.ops.variable.add({ name: "width", valueText: "4" });
    await expect(saved.ops.document.rename({ label: "stale" })).rejects.toMatchObject({ result: { outcome: { kind: "conflicted" } } });
    const replay = await copy.replay(doc.trace(), { omitFileWrites: true });
    expect(replay.every((result) => result.outcome.kind === "completed")).toBe(true);
    expect(copy.inspect(["variables"]).variables).toMatchObject([{ name: "width", valueText: "4" }]);
    expect(doc.trace().operations.some((operation) => operation.operation === "document.rename")).toBe(false);
    expect(writes).toBe(1);
  } finally { await doc.close(); await copy.close(); }
});

test("a disposable probe preserves even falsy programming exceptions and still closes its copy", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-probe-exception");
  let closed = false;
  const doc = new SemanticDocument(workflow.session, undefined, async () => new SemanticDocument({
    execute: async () => { throw undefined; },
    close: async () => { closed = true; return { kind: "closed", settled: [], resourcesReleased: true }; },
  }));
  try {
    await doc.ops.document.create({ label: "Source" });
    await expect(doc.probe([])).rejects.toBeUndefined();
    expect(closed).toBe(true);
    expect(doc.current!.discovery!.document!.label).toBe("Source");
  } finally { await doc.close(); }
});


test("trace omits a failed command with an undiscovered typed reference", async () => {
  const workflow = await createSemanticSessionWorkflow("sdk-stale-trace");
  const doc = new SemanticDocument(workflow.session);
  try {
    await doc.ops.document.create({ label: "Typed stale target" });
    await doc.ops.sketch.begin({ plane: "xy" });
    await doc.ops.sketch.author({ primitive: { kind: "rectangle", start: [0, 0], end: [4, 2] }, construction: false });
    const sketch = await doc.ops.sketch.publish({ requireProfiles: true });
    await doc.ops.extrude.create({ profile: sketch.ref("Outer region"), depth: 2 });
    const target = { kind: "face", bodyId: doc.references({ kind: "body" })[0]!.target.bodyId, faceId: "face_missing" } as const;
    const failure = await doc.tryOp("export.step", { target, path: "/tmp/kkl15-nonexistent-face.step", options: { schema: "AP242", unit: "millimeter" } });
    expect(failure.ok).toBe(false);
    if (failure.ok) throw new Error("Expected invalid export target failure");
    expect(failure.error).toBeInstanceOf(SemanticOperationError);
    expect((failure.error as SemanticOperationError).result).toEqual(doc.results().at(-1));
    expect(doc.commands().at(-1)?.operation).toBe("extrude.create");
    expect(doc.trace().operations.some((operation) => operation.operation === "export.step")).toBe(false);
  } finally { await doc.close(); }
});
