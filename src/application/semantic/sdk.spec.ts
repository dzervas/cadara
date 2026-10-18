import { expect, test } from "vitest";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";
import { SemanticDocument, SemanticOperationError, type SemanticHandle } from "./sdk";
import { createSemanticSessionFactory } from "./session";
import { semanticCommandCorrelation } from "@/contracts/semantic/correlation";
import type { SemanticOutcome, SemanticState, SemanticResult } from "@/contracts/semantic/schema";
import { SelectionError } from "./selection-error";
import { SemanticTraceError } from "./sdk-trace";
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
        }, diagnostics: [], discovery: appliedState ? null : { state, references: [], history: null },
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
      else expect(attempted.error).toBeInstanceOf(SemanticOperationError);
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

test("SDK trace replays typed targets and a failed step; probes edit only a disposable document", async () => {
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
    const source = JSON.stringify(doc.current!.result);
    const sourceCommands = JSON.stringify(doc.commands());
    const probe = await doc.probe([{ operation: "variable.update", fields: { variableId: doc.inspect(["variables"]).variables[0]!.variableId, name: "depth", valueText: "5" } }]);
    expect(probe.results[0]!.outcome.kind).toBe("completed");
    expect(probe.facts.bounds).toEqual([{ min: [0, 0, 0], max: [4, 2, 5] }]);
    expect(probe.cleanup.kind).toBe("closed");
    expect(JSON.stringify(doc.current!.result)).toBe(source);
    expect(JSON.stringify(doc.commands())).toBe(sourceCommands);
    const features = doc.inspect(["features"]).features.map((f) => [f.kind, f.label]);
    await doc.tryOp("sketch.open", { sketchId: "sketch_missing" });
    const trace = doc.trace();
    expect(trace.version).toBe(1);
    expect(trace.operations.at(-1)!.operation).toBe("sketch.open");
    const results = await replay.replay(trace);
    expect(results.at(-1)!.outcome.kind).toBe("rejected");
    // The final refusal has no discovery; the preceding successful model is equivalent.
    const discovery = results.at(-2)!.discovery!;
    expect(discovery.document?.label).toBe("Trace plate");
    expect(discovery.model?.bodies.map((b) => b.bounds)).toEqual([{ min: [0, 0, 0], max: [4, 2, 2] }]);
    expect(discovery.model?.features.map((f) => [f.kind, f.label])).toEqual(features);
  } finally { await doc.close(); await replay.close(); }
});


test("trace export refuses a same-owner ambiguous typed reference without dropping its executed step", async () => {
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
    expect(() => doc.trace()).toThrow(SemanticTraceError);
    try { doc.trace(); } catch (error) {
      expect(error).toMatchObject({ operation: "sketch.construction.set", commandId: doc.current!.result.correlation.commandId, reference: points[0]!.target });
    }
  } finally { await doc.close(); }
});

test("trace export names an executed session-scoped tangent handle instead of emitting random IDs", async () => {
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
    expect(doc.commands().at(-1)?.operation).toBe("sketch.geometry.update");
    expect(() => doc.trace()).toThrow(SemanticTraceError);
    try { doc.trace(); } catch (error) {
      expect(error).toMatchObject({ operation: "sketch.geometry.update", reference: target });
    }
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
  } finally { await doc.close(); }
});

test("dimension probes reconstruct a private draft and remap its typed dimension identity", async () => {
  const makeDocument = async (): Promise<SemanticDocument> => {
    const workflow = await createSemanticSessionWorkflow("sdk-dimension-probe");
    return new SemanticDocument(workflow.session, undefined, makeDocument);
  };
  const doc = await makeDocument();
  try {
    await doc.ops.document.create({ label: "Draft probe" });
    await doc.ops.sketch.begin({ plane: "xy" });
    await doc.ops.sketch.author({ primitive: { kind: "rectangle", start: [0, 0], end: [4, 2] }, construction: false });
    const points = doc.current!.discovery!.sketch!.points;
    await doc.ops.sketch.dimension.add({ axis: "horizontal", points: [points[0]!.pointId, points[1]!.pointId], mode: "driving", value: 4 });
    const source = JSON.stringify(doc.current!.result);
    const probe = await doc.probe([{ operation: "sketch.dimension.update", fields: { dimensionId: doc.current!.discovery!.sketch!.requirements[0]!.dimensionId, value: 6 } }]);
    expect(probe.results[0]!.outcome.kind).toBe("completed");
    const xs = probe.results[0]!.discovery!.sketch!.points.map((p) => p.position[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6);
    expect(JSON.stringify(doc.current!.result)).toBe(source);
  } finally { await doc.close(); }
});

test("disposable replay omits file writes without rebinding historical save aliases", async () => {
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
    expect(replay.at(-1)!.outcome.kind).toBe("conflicted");
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


test("trace export refuses an undiscovered typed reference rather than exporting an invalid nested selector", async () => {
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
    expect(doc.commands().at(-1)?.operation).toBe("export.step");
    try { doc.trace(); throw new Error("Expected trace export refusal"); } catch (error) {
      expect(error).toBeInstanceOf(SemanticTraceError);
      expect(error).toMatchObject({ operation: "export.step", reference: target });
    }
  } finally { await doc.close(); }
});
