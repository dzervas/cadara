import { expect, test } from "vitest";
import { MockKernelAdapter } from "./mock-kernel-adapter";
import { ImportDeferredMaterializer } from "@/domain/import/orchestrator";
import {
  addRectangle,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { deriveImportRegionBoundaryIdentity } from "@/contracts/import/region-boundary-identity";
import {
  requireRegion,
  ProfileRegionSelectionError,
} from "./occ/features/shared";
import type {
  ExtrudeProfileRef,
  FeatureDefinition,
} from "@/contracts/modeling/schema";

const basis = {
  contractVersion: "modeling-contract/v1alpha1" as const,
  documentId: "doc_workspace" as const,
  baseRevisionId: "rev_0001" as const,
};

test("imported selector survives materialization and a real shifted-ID rebuild with mock/OCC consumer parity", async () => {
  const adapter = new MockKernelAdapter();
  const document = await adapter.exportAuthoredModelDocument(basis.documentId);
  document.features = [];
  document.featureOrder = [];
  document.sketches = document.sketches.slice(0, 1);
  document.historyOrder = [
    { kind: "sketch", sketchId: document.sketches[0]!.sketchId },
  ];
  async function restore(width: number, translate: number) {
    const fixture = makeSketchFixture();
    addRectangle(fixture, "box", [translate, 0, translate + width, 10]);
    document.sketches[0]!.definition = fixture.definition();
    await adapter.restoreAuthoredModelDocument(document);
    return (await adapter.getDocumentSnapshot(basis)).snapshot;
  }
  const before = await restore(20, 0);
  const sketch = before.document.sketches[0]!;
  const region = sketch.sketch.regions[0]!;
  expect(region).toBeDefined();
  const importer = new ImportDeferredMaterializer({
    outputRecords: new Map(),
    modelingService: {
      getCurrentDocumentSnapshot: async () => before,
      buildNativeExactBrepPayload: async () => {
        throw new Error("not used");
      },
    },
  });
  importer.recordSketchOutput(0, sketch.sketchId);
  const ref = (await importer.resolveDeferredValue(
    {
      kind: "regionOf",
      actionIndex: 0,
      selector: {
        kind: "interiorPoint",
        point: [10, 5],
        expectedBoundaryIdentity: deriveImportRegionBoundaryIdentity(
          region,
          sketch.sketch.regions,
        ),
      },
    },
    { kind: "createFeature", index: 1 },
  )) as Extract<ExtrudeProfileRef, { kind: "region" }>;
  expect(ref.selector).toBeDefined();
  const after = await restore(-30, -100);
  const current = after.document.sketches[0]!;
  expect(current.sketch.regions).toHaveLength(1);
  expect(current.sketch.regions[0]!.regionId).not.toBe(ref.regionId);
  expect(requireRegion(current, ref.regionId, ref.selector)).toEqual(
    current.sketch.regions[0],
  );
  const definition: FeatureDefinition = {
    kind: "extrude",
    featureTypeVersion: "feature-type/extrude/v1alpha2",
    parameters: {
      resultBodyType: "solid",
      profiles: [ref],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: {
          kind: "blind",
          direction: "positive",
          distance: { source: "literal", value: 5 },
        },
      },
      operation: { source: "literal", value: "newBody" },
      booleanScope: { kind: "standalone" },
    },
  };
  const preview = () =>
    adapter.evaluatePreview({
      ...basis,
      previewId: "preview_region",
      definition,
    });
  expect((await preview()).diagnostics).toEqual([]);
  const enriched = ref.selector!;
  ref.selector = {
    ...enriched,
    expectedBoundaryIdentity: "import-region-boundary/v1:mismatch",
  };
  ref.regionId = current.sketch.regions[0]!.regionId; // reused ID cannot bypass proof
  expect((await preview()).diagnostics).toMatchObject([
    {
      code: "profile-region-reselect",
      detail: {
        regionSelection: { reason: "identity-mismatch", profileIndex: 0 },
      },
    },
  ]);
  try {
    requireRegion(current, ref.regionId, ref.selector);
    throw new Error("Expected reselection");
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileRegionSelectionError);
    expect((error as ProfileRegionSelectionError).regionSelection.reason).toBe(
      "identity-mismatch",
    );
  }
  delete ref.selector;
  expect((await preview()).diagnostics).toEqual([]); // legacy exact-ID path
});
