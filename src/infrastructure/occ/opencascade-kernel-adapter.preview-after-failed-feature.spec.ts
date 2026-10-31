import { expect, test } from "vitest";

import type {
  AuthoredFeatureRecord,
  AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { FeatureId, SketchId } from "@/contracts/shared/ids";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { normalizeCollaborativeAuthoredModelDocument } from "@/core/modeling/collaborative-authored-document";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { loadFilesystemOpenCascadeFactory } from "@/infrastructure/occ/filesystem-kernel-runtime";
import { OpenCascadeKernelAdapter } from "@/infrastructure/occ/opencascade-kernel-adapter";

// Lane: logic (docs/testing.md, src/infrastructure/occ adapter conformance).
// Seam: the production OCC kernel adapter's evaluatePreview on a history with
// an earlier failed feature: a Hole whose location sketch was deleted. The
// commit rebuild keeps that failure on the Hole; a preview that replays past
// it must do the same instead of reporting the Hole's error as the previewed
// feature's and showing no geometry. The document is restored with the
// diagnostics its load reports, as the app restores it.

const DELETED_SKETCH = "sketch_deleted" as SketchId;
const BASE_BODY = "body_feature_extrude-1";

type ExtrudeDefinition = Extract<FeatureDefinition, { kind: "extrude" }>;

function createAdapter() {
  return new OpenCascadeKernelAdapter({
    createSolverAdapter: (revisionId) =>
      new SketchConstraintSolverAdapter({
        neutralCurveQueries:
          createCertifiedNeutralCurveQueryCapabilityForTest(),
        revisionId,
      }),
    getOpenCascadeInstance: async () =>
      (await loadFilesystemOpenCascadeFactory())(),
  });
}

function holeOnDeletedSketch(): FeatureDefinition {
  return {
    kind: "hole",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "location",
          targets: [
            {
              kind: "sketchPoint",
              sketchId: DELETED_SKETCH,
              pointId: "sketch_point_deleted_center",
            },
          ],
        },
        { role: "body", targets: [{ kind: "body", bodyId: BASE_BODY }] },
      ],
      options: {
        style: { source: "literal", value: "simple" },
        mainDiameter: { source: "literal", value: 2 },
        termination: { source: "literal", value: "throughAll" },
      },
    },
  };
}

function withExtrudeParameters(
  definition: ExtrudeDefinition,
  parameters: Partial<ExtrudeDefinition["parameters"]>,
): ExtrudeDefinition {
  return {
    ...definition,
    parameters: { ...definition.parameters, ...parameters },
  } as ExtrudeDefinition;
}

function blindDistance(definition: ExtrudeDefinition, value: number) {
  return withExtrudeParameters(definition, {
    extent: {
      mode: "oneSide",
      end: {
        kind: "blind",
        direction: "positive",
        distance: { source: "literal", value },
      },
    },
  });
}

/**
 * The mock seed's sketch and Extrude 1, then: Hole 1 into Extrude 1's body at
 * a point of a sketch that no longer exists, Extrude 2 as a separate new body
 * (unrelated to the Hole) and Extrude 3 cutting Extrude 1's body (the body the
 * Hole would have changed).
 */
async function documentWithDeletedHoleSketch(cursorFeatureId: FeatureId) {
  const seed: AuthoredModelDocument =
    await new MockKernelAdapter().exportAuthoredModelDocument("doc_workspace");
  const extrude1 = seed.features.find(
    (feature) => feature.featureId === "feature_extrude-1",
  )!;
  if (extrude1.definition.kind !== "extrude")
    throw new Error("Expected the seed Extrude 1.");
  const base = extrude1.definition;
  const features: AuthoredFeatureRecord[] = [
    extrude1,
    {
      featureId: "feature_hole-1" as FeatureId,
      label: "Hole 1",
      suppressed: false,
      definition: holeOnDeletedSketch(),
    },
    {
      featureId: "feature_extrude-2" as FeatureId,
      label: "Extrude 2",
      suppressed: false,
      definition: blindDistance(base, 5),
    },
    {
      featureId: "feature_extrude-3" as FeatureId,
      label: "Extrude 3",
      suppressed: false,
      definition: withExtrudeParameters(blindDistance(base, 4), {
        operation: { source: "literal", value: "cut" },
        booleanScope: { kind: "targetBody", bodyId: BASE_BODY },
      }),
    },
  ];
  return {
    base,
    features,
    document: {
      ...seed,
      features,
      featureOrder: features.map((feature) => feature.featureId),
      historyOrder: [
        { kind: "sketch", sketchId: "sketch_primary" },
        ...features.map((feature) => ({
          kind: "feature" as const,
          featureId: feature.featureId,
        })),
      ],
      cursor: { kind: "feature", featureId: cursorFeatureId },
      topologyLineage: [],
    } as AuthoredModelDocument,
  };
}

async function restoredAdapter(
  cursorFeatureId = "feature_extrude-3" as FeatureId,
) {
  const fixture = await documentWithDeletedHoleSketch(cursorFeatureId);
  const loaded = normalizeCollaborativeAuthoredModelDocument(fixture.document);
  const adapter = createAdapter();
  await adapter.restoreAuthoredModelDocument(
    loaded.document,
    loaded.diagnostics,
  );
  const { snapshot } = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const preview = (
    previewId: string,
    definition: FeatureDefinition,
    replacesFeatureId?: FeatureId,
  ) =>
    adapter.evaluatePreview({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: snapshot.document.revisionId,
      previewId: previewId as `preview_${string}`,
      ...(replacesFeatureId ? { replacesFeatureId } : {}),
      definition,
    });
  return { ...fixture, adapter, snapshot, preview };
}

function errors<Diagnostic extends { severity: string }>(
  diagnostics: readonly Diagnostic[],
) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

test("OCC preview: editing a feature after an unrelated failed feature previews its geometry", async () => {
  const { adapter, base, snapshot, preview } = await restoredAdapter();
  const committedErrors = errors(snapshot.document.diagnostics);
  expect(
    committedErrors.flatMap((diagnostic) =>
      diagnostic.featureId ? [diagnostic.featureId] : [],
    ),
    "The fixture's committed rebuild fails Hole 1 and blocks only Extrude 3.",
  ).toEqual(["feature_hole-1", "feature_extrude-3"]);
  expect(
    committedErrors.some(
      (diagnostic) => diagnostic.code === "merge-invalid-durable-reference",
    ),
    "The fixture's load reports the missing sketch point.",
  ).toBe(true);

  const edited = await preview(
    "preview_edit_extrude_2",
    blindDistance(base, 7),
    "feature_extrude-2" as FeatureId,
  );

  expect(
    errors(edited.diagnostics),
    "Hole 1's failure is not reported as the edited Extrude 2's.",
  ).toEqual([]);
  expect(
    edited.render.records.length,
    "The edited Extrude 2 previews its body.",
  ).toBeGreaterThan(0);
  adapter.dispose();
});

test("OCC preview: editing a feature on the failed feature's body names the blocking feature", async () => {
  const { adapter, features, preview } = await restoredAdapter();
  const extrude3 = features.find(
    (feature) => feature.featureId === "feature_extrude-3",
  )!;

  const edited = await preview(
    "preview_edit_extrude_3",
    blindDistance(extrude3.definition as ExtrudeDefinition, 3),
    extrude3.featureId,
  );

  expect(
    errors(edited.diagnostics),
    "The edited Extrude 3 reports what its commit would: blocked by Hole 1, by label.",
  ).toMatchObject([
    {
      code: "feature-dependency-blocked",
      message: "Extrude 3 is blocked by an earlier feature error.",
      repairGuidance: "Repair Hole 1, then rebuild Extrude 3.",
    },
  ]);
  adapter.dispose();
});

test("OCC preview: a new feature at the history tail reports only its own diagnostics, and a missing sketch says what to do", async () => {
  const { adapter, base, preview } = await restoredAdapter();

  const unrelated = await preview("preview_new_body", blindDistance(base, 6));
  expect(
    errors(unrelated.diagnostics),
    "The document's load diagnostics and Hole 1's and Extrude 3's committed failures are not the new feature's.",
  ).toEqual([]);
  expect(unrelated.render.records.length).toBeGreaterThan(0);

  const hole = await preview("preview_new_hole", holeOnDeletedSketch());
  const holeErrors = errors(hole.diagnostics);
  expect(holeErrors, "The new hole's own failure is reported.").toHaveLength(1);
  expectNoInternalIds(holeErrors.map((diagnostic) => diagnostic.message));
  expect(holeErrors[0]!.message).toMatch(/select from an existing sketch/);
  adapter.dispose();
});

test("OCC preview: a new feature inserted mid-history is named as its create names it", async () => {
  const { adapter, base, preview } = await restoredAdapter(
    "feature_extrude-2" as FeatureId,
  );

  const inserted = await preview(
    "preview_extrude-create",
    withExtrudeParameters(blindDistance(base, 2), {
      operation: { source: "literal", value: "cut" },
      booleanScope: { kind: "targetBody", bodyId: BASE_BODY },
    }),
  );

  const insertedErrors = errors(inserted.diagnostics);
  expect(
    insertedErrors,
    "The inserted cut on Hole 1's body is blocked by Hole 1.",
  ).toMatchObject([{ code: "feature-dependency-blocked" }]);
  expectNoInternalIds(
    insertedErrors.flatMap((diagnostic) => [
      diagnostic.message,
      diagnostic.repairGuidance,
    ]),
    ["preview_extrude-create"],
  );
  expect(insertedErrors[0]!.message).toMatch(/^Extrude \d+ is blocked/);
  adapter.dispose();
});
