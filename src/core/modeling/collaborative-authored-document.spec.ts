import { test, expect } from "vitest";

import {
  createAuthoredModelDocumentFromSnapshot,
  type AuthoredModelDocument,
} from "@/contracts/modeling/authored-document";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import {
  COLLABORATIVE_MERGE_DIAGNOSTIC_CODES,
  normalizeCollaborativeAuthoredModelDocument,
  withoutMissingReferencesReportedByFeatures,
} from "@/core/modeling/collaborative-authored-document";
import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";

test("src/domain/modeling/collaborative-authored-document.spec.ts", async () => {
  async function createSeedDocument() {
    const snapshot = (
      await new MockKernelAdapter().getDocumentSnapshot({
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace",
      })
    ).snapshot;
    return createAuthoredModelDocumentFromSnapshot(snapshot);
  }

  function cloneExtrude(
    seed: AuthoredModelDocument,
    suffix: string,
  ): AuthoredModelDocument["features"][number] {
    const extrude = seed.features.find(
      (feature) => feature.featureId === "feature_extrude-1",
    );
    expect(extrude, "Seed extrude feature should exist.").toBeTruthy();
    return {
      featureId:
        `feature_extrude-${suffix}` as AuthoredModelDocument["features"][number]["featureId"],
      label: `Extrude ${suffix}`,
      definition: structuredClone(extrude.definition),
    };
  }

  const seed = await createSeedDocument();
  const concurrentInsertDocument: AuthoredModelDocument = {
    ...seed,
    features: [
      ...seed.features,
      cloneExtrude(seed, "a"),
      cloneExtrude(seed, "b"),
    ],
    featureOrder: ["feature_extrude-1"],
  };
  const concurrentInsert = normalizeCollaborativeAuthoredModelDocument(
    concurrentInsertDocument,
  );
  const concurrentAIndex = concurrentInsert.document.featureOrder.indexOf(
    "feature_extrude-a" as AuthoredModelDocument["featureOrder"][number],
  );
  const concurrentBIndex = concurrentInsert.document.featureOrder.indexOf(
    "feature_extrude-b" as AuthoredModelDocument["featureOrder"][number],
  );
  expect(
    concurrentAIndex >= 0 && concurrentBIndex > concurrentAIndex,
    "Concurrent feature insertions missing from order should append deterministically by durable ID.",
  ).toBeTruthy();

  const movedAndDeleted = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    featureOrder: [
      "feature_extrude-missing",
      ...seed.featureOrder,
    ] as AuthoredModelDocument["featureOrder"],
  });
  expect(
    movedAndDeleted.document.featureOrder.includes(
      "feature_extrude-missing" as AuthoredModelDocument["featureOrder"][number],
    ),
    "Move/delete races should not keep order entries for missing features.",
  ).toBeFalsy();
  expect(
    movedAndDeleted.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidFeatureOrder,
    ),
    "Move/delete races should emit explicit feature-order diagnostics.",
  ).toBeTruthy();

  const renameConflict = normalizeCollaborativeAuthoredModelDocument({
    ...concurrentInsertDocument,
    features: concurrentInsertDocument.features.map((feature) => ({
      ...feature,
      label: "Shared Label",
    })),
    featureOrder: concurrentInsert.document.featureOrder,
  });
  expect(
    renameConflict.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.concurrentLabelConflict,
    ),
    "Concurrent scalar label conflicts should be explicit diagnostics.",
  ).toBeTruthy();

  const missingCursor = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    cursor: {
      kind: "feature",
      featureId:
        "feature_deleted" as AuthoredModelDocument["features"][number]["featureId"],
    },
  } as AuthoredModelDocument);
  expect(
    missingCursor.document.cursor.kind,
    "Missing cursor targets should normalize to an empty cursor.",
  ).toBe("empty");
  expect(
    missingCursor.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.missingCursorTarget,
    ),
    "Missing cursor targets should emit stable merge diagnostics.",
  ).toBeTruthy();

  const variableConflict = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    variables: [
      { variableId: "variable_a", name: "a", valueText: "b + 1" },
      { variableId: "variable_b", name: "b", valueText: "a + 1" },
    ],
  } as AuthoredModelDocument);
  expect(
    variableConflict.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.unresolvedVariableCycle,
    ),
    "Variable cycles introduced by merge should have stable diagnostics.",
  ).toBeTruthy();

  expectNoInternalIds(
    [
      ...concurrentInsert.diagnostics,
      ...movedAndDeleted.diagnostics,
      ...renameConflict.diagnostics,
      ...missingCursor.diagnostics,
    ].map((diagnostic) => diagnostic.message),
    ["feature_extrude-a", "feature_extrude-b", "feature_deleted"],
  );

  const invalidReferenceDefinition: FeatureDefinition = {
    kind: "extrude",
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "solid",
      profiles: [
        {
          kind: "region",
          sketchId: "sketch_deleted",
          regionId: "region_deleted",
        },
      ],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: { kind: "blind", direction: "positive", distance: 1 },
      },
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    },
  };
  const invalidReference = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    features: [
      {
        featureId: "feature_invalid-ref",
        label: "Invalid Ref",
        definition: invalidReferenceDefinition,
      },
    ],
    featureOrder: ["feature_invalid-ref"],
  } as AuthoredModelDocument);
  expect(
    invalidReference.document.features[0]?.featureId,
    "Merge diagnostics should not delete authored records to hide invalid references.",
  ).toBe("feature_invalid-ref");
  expect(
    invalidReference.diagnostics.some(
      (diagnostic) =>
        diagnostic.code ===
        COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidDurableReference,
    ),
    "Invalid durable references caused by merge should be explicit diagnostics.",
  ).toBeTruthy();
});

// Logic lane; seam: the load normalizer's missing-reference diagnostic and
// the filter that drops it once a feature's rebuild error names the same
// target (the kernel's labelled error says the same and how to repair it).
test("a missing reference names its feature by label and is dropped only where a feature error names the same target", async () => {
  const seed = createAuthoredModelDocumentFromSnapshot(
    (
      await new MockKernelAdapter().getDocumentSnapshot({
        contractVersion: CONTRACT_VERSION,
        documentId: "doc_workspace",
      })
    ).snapshot,
  );
  const extrude = seed.features.find(
    (feature) => feature.featureId === "feature_extrude-1",
  )!;
  if (extrude.definition.kind !== "extrude")
    throw new Error("Expected the seed Extrude 1.");
  const missingRegion = {
    kind: "region" as const,
    sketchId: "sketch_deleted" as const,
    regionId: "region_deleted" as const,
  };
  const loaded = normalizeCollaborativeAuthoredModelDocument({
    ...seed,
    features: [
      {
        ...extrude,
        definition: {
          ...extrude.definition,
          parameters: {
            ...extrude.definition.parameters,
            profiles: [missingRegion],
          },
        },
      },
    ],
    featureOrder: [extrude.featureId],
  } as AuthoredModelDocument);
  const missing = loaded.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code ===
      COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidDurableReference,
  );

  expect(missing).toMatchObject([
    {
      message: "Extrude 1 references a missing sketch region.",
      repairGuidance:
        "Edit Extrude 1 and select an existing sketch region. This notice clears when the document is opened again.",
      target: missingRegion,
    },
  ]);
  expectNoInternalIds(
    missing.flatMap((diagnostic) => [
      diagnostic.message,
      diagnostic.repairGuidance,
    ]),
    [extrude.featureId],
  );

  const featureError = {
    code: "occ-missing-reference",
    severity: "error" as const,
    message: "Extrude 1 profile selection is incorrect.",
    featureId: extrude.featureId,
    target: missingRegion,
    detail: null,
  };
  expect(
    withoutMissingReferencesReportedByFeatures([...missing, featureError]),
    "The feature's own error replaces the document-level duplicate.",
  ).toEqual([featureError]);
  expect(
    withoutMissingReferencesReportedByFeatures([
      ...missing,
      { ...featureError, target: { ...missingRegion, regionId: "region_other" } },
    ]),
    "A feature error about another target does not hide it.",
  ).toHaveLength(2);
  expect(
    withoutMissingReferencesReportedByFeatures(missing),
    "Kept when it is the only signal.",
  ).toEqual(missing);
});
