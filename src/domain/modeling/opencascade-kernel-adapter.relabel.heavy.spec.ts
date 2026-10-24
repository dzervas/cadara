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
