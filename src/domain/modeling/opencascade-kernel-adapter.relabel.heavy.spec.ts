// cadara-kv69. Logic lane, heavy tier (docs/testing.md): the production OCC
// adapter's feature relabel, sketch relabel and document rename on the shipped
// kernel build, and Undo/Redo of a feature relabel through the modeling
// service. A relabel is label-only: no feature runs again (a feature relabel
// re-ran every feature from the relabelled one, a document rename restored the
// whole document), the result equals what a save -> reopen produces, and a
// later rebuild resumes every feature from its checkpoint instead of rerunning
// the relabelled one and everything after it.
//
// As in opencascade-kernel-adapter.body-rename.heavy.spec.ts, comparisons
// normalize revision ids and topology tokens and compare the evaluated model
// with its live references.
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

// Counts feature executions without retaining their (large) arguments.
const featureRuns = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/domain/modeling/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/features")>();
  return {
    ...actual,
    executeOccFeature: (
      ...args: Parameters<typeof actual.executeOccFeature>
    ) => {
      featureRuns.count += 1;
      return actual.executeOccFeature(...args);
    },
  };
});

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

let occ: Promise<OpenCascadeInstance> | null = null;
/** A production OCC adapter (`public/cadara-occ`) for `document`. */
function createAdapter(document: AuthoredModelDocument) {
  occ ??= (async () => {
    const module =
      (await import("../../../public/cadara-occ.js")) as unknown as {
        default: new (
          module: Record<string, unknown>,
        ) => Promise<OpenCascadeInstance>;
      };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  const instance = occ;
  return new OpenCascadeKernelAdapter({
    documentId: document.documentId,
    getOpenCascadeInstance: () => instance,
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        revisionId,
        documentId: document.documentId,
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
      }),
  });
}

async function open(document: AuthoredModelDocument) {
  const adapter = createAdapter(document);
  await adapter.restoreAuthoredModelDocument(document);
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: document.documentId,
  } as const;
  const snapshot = async () =>
    (await adapter.getDocumentSnapshot(request)).snapshot;
  const base = async () => ({
    ...request,
    baseRevisionId: (await snapshot()).document.revisionId,
  });
  return {
    adapter,
    snapshot,
    exported: () => adapter.exportAuthoredModelDocument(document.documentId),
    async renameFeature(featureId: `feature_${string}`, featureLabel: string) {
      const response = await adapter.renameFeature({
        ...(await base()),
        featureId,
        featureLabel,
      });
      expect(response.revisionState.kind, "relabel accepted").toBe("accepted");
      expect(response.changedTargets).toEqual([{ kind: "feature", featureId }]);
    },
    async renameSketch(sketchId: `sketch_${string}`, sketchLabel: string) {
      const response = await adapter.renameSketch({
        ...(await base()),
        sketchId,
        sketchLabel,
      });
      expect(response.revisionState.kind, "relabel accepted").toBe("accepted");
      expect(response.changedTargets).toEqual([{ kind: "sketch", sketchId }]);
    },
    async renameDocument(name: string) {
      const response = await adapter.renameDocument({
        ...(await base()),
        name,
      });
      expect(response.revisionState.kind, "rename accepted").toBe("accepted");
    },
    /** Sets the current cursor again: an in-session rebuild. */
    async rebuild() {
      const current = await snapshot();
      const response = await adapter.setFeatureCursor({
        ...request,
        baseRevisionId: current.document.revisionId,
        cursor: current.document.cursor,
      });
      expect(response.revisionState.kind, "cursor set").toBe("accepted");
    },
  };
}

const sorted = (values: readonly unknown[]) =>
  values.map((value) => JSON.stringify(value)).sort();

/** The evaluated model without render meshes, revision stamps or topology
 * tokens: bodies, objects, features, entities, live references. */
function liveModel(snapshot: WorkspaceSnapshot) {
  const text = JSON.stringify({
    ...snapshot,
    document: { ...snapshot.document, render: null },
  })
    .replace(/rev_\d+/g, "rev")
    .replace(/_t\d+_(\d+)/g, "_t_$1")
    .replace(/"t\d+"/g, '"t"');
  const value = JSON.parse(text) as WorkspaceSnapshot;
  return {
    name: value.document.name,
    bodies: value.document.bodies,
    objects: value.presentation.objects,
    featureTree: value.presentation.featureTree,
    features: value.document.features,
    sketches: value.document.sketches,
    entities: sorted(value.document.entities),
    references: sorted(
      value.document.references.filter(
        (reference) => reference.invalidation === null,
      ),
    ),
    diagnostics: value.document.diagnostics,
  };
}

async function readWheel() {
  return JSON.parse(
    await readFile(
      new URL("../../../landing/examples/wheel/model.cadara", import.meta.url),
      "utf8",
    ),
  ) as AuthoredModelDocument;
}

test("relabelling a feature and a sketch and renaming the document on the landing wheel run no feature and equal a reopen and a resumed rebuild", async () => {
  const source = await readWheel();
  const wheel = await open(source);
  const before = await wheel.snapshot();
  expect(
    before.document.diagnostics.filter((diagnostic) => diagnostic.featureId),
    "premise: no rebuild diagnostic names a feature or sketch",
  ).toEqual([]);
  const feature = before.document.features[1]!;
  const sketch = before.document.sketches[0]!;
  const exportedBefore = await wheel.exported();

  featureRuns.count = 0;
  await wheel.renameFeature(feature.featureId, "Relabelled feature");
  await wheel.renameSketch(sketch.sketchId, "Relabelled sketch");
  await wheel.renameDocument("Relabelled wheel");
  expect(featureRuns.count, "a relabel re-runs no feature").toBe(0);

  const after = await wheel.snapshot();
  expect(after.document.name).toBe("Relabelled wheel");
  expect(
    after.document.features.find(
      (entry) => entry.featureId === feature.featureId,
    )!.label,
  ).toBe("Relabelled feature");
  expect(
    after.presentation.featureTree.find(
      (node) =>
        node.target.kind === "sketch" &&
        node.target.sketchId === sketch.sketchId,
    )!.label,
  ).toBe("Relabelled sketch");
  expect(
    after.document.references.find(
      (reference) =>
        reference.target.kind === "sketch" &&
        reference.target.sketchId === sketch.sketchId,
    )!.label,
  ).toBe("Relabelled sketch");
  expect(
    after.document.bodies,
    "bodies named after the feature keep their names",
  ).toEqual(before.document.bodies);

  const exportedAfter = await wheel.exported();
  const relabelled = structuredClone(exportedBefore);
  relabelled.name = "Relabelled wheel";
  relabelled.features.find(
    (entry) => entry.featureId === feature.featureId,
  )!.label = "Relabelled feature";
  relabelled.sketches.find(
    (entry) => entry.sketchId === sketch.sketchId,
  )!.label = "Relabelled sketch";
  expect(
    JSON.stringify({ ...exportedAfter, revisionId: null }),
    "the relabels change no other authored field; keyed lineage is byte-identical",
  ).toBe(JSON.stringify({ ...relabelled, revisionId: null }));

  const reopened = await open(exportedAfter);
  expect(
    liveModel(await reopened.snapshot()),
    "save -> reopen of the relabelled document reproduces the live model",
  ).toEqual(liveModel(after));
  reopened.adapter.dispose();

  featureRuns.count = 0;
  await wheel.rebuild();
  expect(
    featureRuns.count,
    "a rebuild resumes every feature from its checkpoint",
  ).toBe(0);
  expect(
    liveModel(await wheel.snapshot()),
    "and evaluates the same model",
  ).toEqual(liveModel(after));
  wheel.adapter.dispose();
}, 900_000);

test("undo and redo of a feature relabel on the landing wheel run no feature and restore no document", async () => {
  const source = await readWheel();
  const adapter = createAdapter(source);
  const repository = createMemoryDocumentRepository([source]);
  const service = createModelingService(adapter, {
    currentDocumentId: source.documentId,
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    const feature = initial.document.features[1]!;
    const label = async () =>
      (await service.getCurrentDocumentSnapshot()).document.features.find(
        (entry) => entry.featureId === feature.featureId,
      )!.label;
    const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");
    featureRuns.count = 0;

    const renamed = await service.renameFeature({
      baseRevisionId: initial.document.revisionId,
      featureId: feature.featureId,
      featureLabel: "Relabelled feature",
    });
    expect(renamed.isOk()).toBe(true);
    await service.waitForPersistence();
    expect(await label()).toBe("Relabelled feature");
    expect((await repository.undoDurableHistory(source.documentId))?.ok).toBe(
      true,
    );
    expect(await label()).toBe(feature.label);
    expect((await repository.redoDurableHistory(source.documentId))?.ok).toBe(
      true,
    );
    expect(await label()).toBe("Relabelled feature");

    expect(featureRuns.count, "no feature runs again").toBe(0);
    expect(restore).not.toHaveBeenCalled();
    expect(
      (await service.getCurrentDocumentSnapshot()).document.bodies,
    ).toEqual(initial.document.bodies);
  } finally {
    service.dispose();
  }
}, 900_000);

// cadara-8dai: a relabel falls back to a rebuild only when a diagnostic can
// name the relabelled feature or sketch, so one unrelated diagnostic no longer
// costs every relabel a rebuild. Either way the diagnostics read as a cold
// rebuild (a reopen of the exported document) words them.

/** The landing wheel with one change, as `change` makes it. */
async function readWheelWith(
  change: (document: AuthoredModelDocument) => void,
) {
  const document = await readWheel();
  change(document);
  return document;
}

const feature = (document: AuthoredModelDocument, featureId: string) =>
  document.features.find((entry) => entry.featureId === featureId)!;

/** Extrude 26 joins a body no feature makes: one diagnostic, of a feature
 * that does not name Extrude 2 or sketch_cab48b16 (Extrude 1's sketch), but
 * builds from sketch_abf31fd2 (Extrude 26's sketch). */
const withUnrelatedDiagnostic = (document: AuthoredModelDocument) => {
  const definition = feature(document, "feature_extrude-26").definition;
  if (
    definition.kind !== "extrude" ||
    definition.parameters.resultBodyType !== "solid"
  ) {
    throw new Error("Extrude 26 is no longer a solid extrude");
  }
  definition.parameters.booleanScope = {
    kind: "targetBody",
    bodyId: "body_feature_missing-8dai",
  };
};

/** The diagnostics without revision stamps or topology tokens. */
const diagnosticsOf = (snapshot: WorkspaceSnapshot) =>
  liveModel(snapshot).diagnostics;

test("relabels on a wheel with an unrelated feature diagnostic run no feature, and a relabel of a sketch the failed feature builds from rebuilds; both read as a cold rebuild", async () => {
  const wheel = await open(await readWheelWith(withUnrelatedDiagnostic));
  const before = await wheel.snapshot();
  expect(
    before.document.diagnostics.map((diagnostic) => diagnostic.featureId),
    "premise: the wheel holds one diagnostic, of Extrude 26",
  ).toEqual(["feature_extrude-26"]);
  expect(
    before.document.diagnostics[0]!.message,
    "premise: it names its own feature",
  ).toContain("Extrude 26");

  featureRuns.count = 0;
  await wheel.renameFeature("feature_extrude-2", "Relabelled feature");
  await wheel.renameSketch(
    "sketch_cab48b16-6c10-4afb-9a5d-92b0eccca249",
    "Relabelled sketch",
  );
  expect(featureRuns.count, "an unrelated diagnostic forces no rebuild").toBe(
    0,
  );
  const relabelled = await wheel.snapshot();
  const cold = await open(await wheel.exported());
  expect(
    liveModel(await cold.snapshot()),
    "the in-place relabels equal a cold rebuild, diagnostics included",
  ).toEqual(liveModel(relabelled));
  cold.adapter.dispose();

  featureRuns.count = 0;
  const sketchRelabel = await wheel.adapter.renameSketch({
    contractVersion: CONTRACT_VERSION,
    documentId: relabelled.document.documentId,
    baseRevisionId: relabelled.document.revisionId,
    sketchId: "sketch_abf31fd2-2293-4e50-8684-ee483704a665",
    sketchLabel: "Relabelled profile sketch",
  });
  expect(sketchRelabel.revisionState.kind).toBe("accepted");
  expect(
    featureRuns.count,
    "a diagnostic of a feature building from the sketch can name it: rebuild",
  ).toBeGreaterThan(0);
  const rebuilt = await wheel.snapshot();
  const coldAgain = await open(await wheel.exported());
  expect(diagnosticsOf(await coldAgain.snapshot())).toEqual(
    diagnosticsOf(rebuilt),
  );
  coldAgain.adapter.dispose();

  featureRuns.count = 0;
  const ownRelabel = await wheel.adapter.renameFeature({
    contractVersion: CONTRACT_VERSION,
    documentId: rebuilt.document.documentId,
    baseRevisionId: rebuilt.document.revisionId,
    featureId: "feature_extrude-26",
    featureLabel: "Relabelled failing feature",
  });
  expect(ownRelabel.revisionState.kind).toBe("accepted");
  expect(
    featureRuns.count,
    "a feature's own diagnostic names it: rebuild",
  ).toBeGreaterThan(0);
  const ownRebuilt = await wheel.snapshot();
  expect(
    ownRebuilt.document.diagnostics.map((diagnostic) => [
      diagnostic.message,
      diagnostic.repairGuidance,
    ]),
  ).toEqual([
    [
      "Relabelled failing feature boolean target is incorrect.",
      "Edit Relabelled failing feature and choose a valid boolean target.",
    ],
  ]);
  const coldOwn = await open(await wheel.exported());
  expect(
    liveModel(await coldOwn.snapshot()),
    "the relabel equals a cold rebuild, diagnostics included",
  ).toEqual(liveModel(ownRebuilt));
  coldOwn.adapter.dispose();
  wheel.adapter.dispose();
}, 900_000);

/** Extrude 26's sketch gains a constraint on an entity it does not hold: the
 * sketch is invalid, and Extrude 26's diagnostic names it by label. */
const withInvalidProfileSketch = (document: AuthoredModelDocument) => {
  const sketch = document.sketches.find(
    (entry) => entry.sketchId === "sketch_abf31fd2-2293-4e50-8684-ee483704a665",
  )!;
  const constraint = structuredClone(sketch.definition.constraints[0]!);
  if (constraint.kind !== "equalLength") {
    throw new Error(
      "the sketch no longer starts with an equal-length constraint",
    );
  }
  constraint.constraintId = "constraint_missing-entity-8dai";
  constraint.entityIds = [
    constraint.entityIds[0]!,
    "sketch_entity_missing-8dai",
  ];
  sketch.definition.constraints.push(constraint);
  sketch.definition.constraintIds.push(constraint.constraintId);
};

test("relabelling a sketch a diagnostic names rebuilds, and the diagnostic names the new label as a cold rebuild does", async () => {
  const wheel = await open(await readWheelWith(withInvalidProfileSketch));
  const before = await wheel.snapshot();
  expect(
    before.document.diagnostics.map((diagnostic) => [
      diagnostic.featureId,
      diagnostic.message,
    ]),
    "premise: Extrude 26 waits for its invalid sketch, which it names",
  ).toEqual([
    [
      "feature_extrude-26",
      "Extrude 26 profile region waits for Sketch Draft, whose derived output is invalid.",
    ],
  ]);

  featureRuns.count = 0;
  const response = await wheel.adapter.renameSketch({
    contractVersion: CONTRACT_VERSION,
    documentId: before.document.documentId,
    baseRevisionId: before.document.revisionId,
    sketchId: "sketch_abf31fd2-2293-4e50-8684-ee483704a665",
    sketchLabel: "Relabelled profile sketch",
  });
  expect(response.revisionState.kind).toBe("accepted");
  expect(
    featureRuns.count,
    "the diagnostic names the sketch: rebuild",
  ).toBeGreaterThan(0);
  const relabelled = await wheel.snapshot();
  expect(
    relabelled.document.diagnostics.map((diagnostic) => diagnostic.message),
  ).toEqual([
    "Extrude 26 profile region waits for Relabelled profile sketch, whose derived output is invalid.",
  ]);
  const cold = await open(await wheel.exported());
  expect(
    liveModel(await cold.snapshot()),
    "the relabel equals a cold rebuild, diagnostics included",
  ).toEqual(liveModel(relabelled));
  cold.adapter.dispose();
  wheel.adapter.dispose();
}, 900_000);

test("relabelling a suppressed feature whose dependents are blocked rebuilds, and their diagnostics name the new label as a cold rebuild does", async () => {
  const wheel = await open(
    await readWheelWith((document) => {
      feature(document, "feature_extrude-5").suppressed = true;
    }),
  );
  const before = await wheel.snapshot();
  const blocked = before.document.diagnostics.filter(
    (diagnostic) => diagnostic.code === "feature-dependency-blocked",
  );
  expect(
    blocked.map((diagnostic) => diagnostic.repairGuidance),
    "premise: Extrude 25 and 26 join Extrude 5's body and are blocked by it; Extrude 29 is blocked by Extrude 25",
  ).toEqual([
    "Repair Extrude 5, then rebuild Extrude 25.",
    "Repair Extrude 5, then rebuild Extrude 26.",
    "Repair Extrude 25, then rebuild Extrude 29.",
  ]);
  expect(
    before.document.diagnostics.filter(
      (diagnostic) => diagnostic.featureId === "feature_extrude-5",
    ),
    "premise: the suppressed feature has no diagnostic of its own",
  ).toEqual([]);

  featureRuns.count = 0;
  await wheel.renameFeature("feature_extrude-5", "Relabelled feature");
  expect(
    featureRuns.count,
    "a dependency-blocked diagnostic names the blocking feature: rebuild",
  ).toBeGreaterThan(0);
  const relabelled = await wheel.snapshot();
  expect(
    relabelled.document.diagnostics
      .filter((diagnostic) => diagnostic.code === "feature-dependency-blocked")
      .map((diagnostic) => diagnostic.repairGuidance),
  ).toEqual([
    "Repair Relabelled feature, then rebuild Extrude 25.",
    "Repair Relabelled feature, then rebuild Extrude 26.",
    "Repair Extrude 25, then rebuild Extrude 29.",
  ]);
  const cold = await open(await wheel.exported());
  expect(
    liveModel(await cold.snapshot()),
    "the relabel equals a cold rebuild, diagnostics included",
  ).toEqual(liveModel(relabelled));
  cold.adapter.dispose();
  wheel.adapter.dispose();
}, 900_000);

test("undo and redo of a feature relabel on a wheel with an unrelated feature diagnostic run no feature and restore no document", async () => {
  const source = await readWheelWith(withUnrelatedDiagnostic);
  const adapter = createAdapter(source);
  const repository = createMemoryDocumentRepository([source]);
  const service = createModelingService(adapter, {
    currentDocumentId: source.documentId,
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    expect(
      initial.document.diagnostics.map((diagnostic) => diagnostic.featureId),
      "premise: the wheel holds one diagnostic, of Extrude 26",
    ).toEqual(["feature_extrude-26"]);
    const label = async () =>
      (await service.getCurrentDocumentSnapshot()).document.features.find(
        (entry) => entry.featureId === "feature_extrude-2",
      )!.label;
    const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");
    featureRuns.count = 0;

    const renamed = await service.renameFeature({
      baseRevisionId: initial.document.revisionId,
      featureId: "feature_extrude-2",
      featureLabel: "Relabelled feature",
    });
    expect(renamed.isOk()).toBe(true);
    await service.waitForPersistence();
    expect(await label()).toBe("Relabelled feature");
    expect((await repository.undoDurableHistory(source.documentId))?.ok).toBe(
      true,
    );
    expect(await label()).toBe("Extrude 2");
    expect((await repository.redoDurableHistory(source.documentId))?.ok).toBe(
      true,
    );
    expect(await label()).toBe("Relabelled feature");

    expect(featureRuns.count, "no feature runs again").toBe(0);
    expect(restore).not.toHaveBeenCalled();
    expect(
      liveModel(await service.getCurrentDocumentSnapshot()).diagnostics,
    ).toEqual(liveModel(initial).diagnostics);
  } finally {
    service.dispose();
  }
}, 900_000);
