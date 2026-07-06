import { test, expect } from "vitest";

import { ResultAsync, createAppError } from "@/contracts/errors";
import type { ImportProvider } from "@/contracts/import/provider";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import {
  applyImportPreparedActions,
  createImportSession,
  prepareImportActions,
  resolveLocalFileImportSource,
} from "@/domain/import/orchestrator";
import type { ModelingService } from "@/domain/modeling/modeling-service";

test("src/domain/import/orchestrator.spec.ts", async () => {
  const result = await applyImportPreparedActions({
    modelingService: {
      addDocumentVariable() {
        return ResultAsync.fromPromise(
          Promise.resolve({
            revisionId: "rev_2",
            variableId: "var_scale",
            revisionState: "advanced",
            rebuildResult: "reused",
            changedTargets: [],
            diagnostics: [],
          }),
          (error) =>
            createAppError({
              code: "test/add-variable",
              message: String(error),
            }),
        );
      },
      createFeature(input) {
        return ResultAsync.fromPromise(
          Promise.resolve({
            revisionId:
              input.baseRevisionId === "rev_2"
                ? "rev_3"
                : "rev_feature_unexpected",
            featureId: "feature_image_support",
            revisionState: "advanced",
            rebuildResult: "reused",
            changedTargets: [],
            diagnostics: [],
          }),
          (error) =>
            createAppError({
              code: "test/create-feature",
              message: String(error),
            }),
        );
      },
      commitSketch(input) {
        return ResultAsync.fromPromise(
          Promise.resolve({
            revisionId:
              input.baseRevisionId === "rev_3"
                ? "rev_4"
                : "rev_sketch_unexpected",
            sketchId: "sketch_imported_image",
            revisionState: "advanced",
            rebuildResult: "reused",
            changedTargets: [],
            diagnostics: [],
          }),
          (error) =>
            createAppError({
              code: "test/commit-sketch",
              message: String(error),
            }),
        );
      },
    } as unknown as ModelingService,
    baseRevisionId: "rev_1",
    actions: {
      addDocumentVariables: [
        {
          name: "scale",
          valueText: "10 mm",
        },
      ],
      createFeatures: [
        {
          featureType: "plane",
          featureLabel: "Image support",
          participantTargets: [],
          parameterValues: {},
        },
      ],
      commitSketches: [
        {
          baseRevisionId: "rev_ignored",
          solverCorrelation: null,
          sketchId: null,
          sketchLabel: "Imported image",
          plane: {
            support: {
              kind: "construction",
              constructionId: "construction_plane-xy",
            },
            frame: {
              origin: [0, 0, 0],
              xAxis: [1, 0, 0],
              yAxis: [0, 1, 0],
              normal: [0, 0, 1],
              linearUnit: "documentLength",
              handedness: "rightHanded",
            },
            key: "xy",
          },
          planeTarget: {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          planeKey: "xy",
          definition: {
            schemaVersion: "sketch-definition/v1alpha1",
            referenceIds: [],
            references: [],
            pointIds: [],
            points: [],
            entityIds: [],
            entities: [],
            constraintIds: [],
            constraints: [],
            dimensionIds: [],
            dimensions: [],
            styleIds: [],
            styles: [],
            svgRenderingEnabled: true,
            derivedRelationships: [],
            authoringOperations: [],
          },
        },
      ],
      diagnostics: [],
    },
  });

  expect(
    result.revisionId,
    "Import action application should advance to the final mutation revision.",
  ).toBe("rev_4");
  expect(
    result.createdEntityIds.variableIds[0] === "var_scale" &&
      result.createdEntityIds.featureIds[0] === "feature_image_support" &&
      result.createdEntityIds.sketchIds[0] === "sketch_imported_image",
    "Import action application should preserve created ids for variables, features, and sketches.",
  ).toBeTruthy();

  const file = new File(
    [new Uint8Array([0xde, 0xad, 0xbe, 0xef])],
    "fixture.step",
    { type: "model/step" },
  );
  const source = await resolveLocalFileImportSource(file);
  expect(
    source.name === "fixture.step" &&
      source.origin.kind === "localFile" &&
      source.origin.fileName === "fixture.step" &&
      source.mediaType === "model/step" &&
      source.bytes.length === 4 &&
      source.fingerprint.startsWith("sha256:"),
    "Local-file import source resolution should preserve file metadata, bytes, and a deterministic fingerprint.",
  ).toBeTruthy();

  const review = {
    providerReview: { units: "mm" as const },
    proposedActionKinds: ["createFeature" as const],
    diagnostics: [],
  };
  const providerCalls: string[] = [];
  const provider: ImportProvider<
    { units: "mm" },
    { body: string },
    FeatureEditorFormSchema
  > = {
    id: "step",
    label: "STEP",
    acceptedFileTypes: [{ extension: ".step", mediaType: "model/step" }],
    accepts: () => true,
    async review() {
      providerCalls.push("review");
      return review;
    },
    createDefaultSelections(returnedReview) {
      providerCalls.push("defaults");
      expect(
        returnedReview,
        "Import session creation should forward the provider review into default-selection creation.",
      ).toBe(review);
      return { body: "Body 1" };
    },
    getReviewFormSchema(returnedReview, selections) {
      providerCalls.push("schema");
      expect(
        returnedReview === review && selections.body === "Body 1",
        "Import session creation should build form schema from the provider review and default selections.",
      ).toBeTruthy();
      return { sections: [] } as FeatureEditorFormSchema;
    },
    applySelectionPatch(_review, selections) {
      return selections;
    },
    async prepare(input) {
      providerCalls.push("prepare");
      expect(
        input.source === source &&
          input.review === review &&
          input.selections.body === "Body 1" &&
          input.capabilities.context.documentId === "doc_workspace",
        "Prepared import actions should receive the resolved source, persisted review, selections, and import capabilities.",
      ).toBeTruthy();
      return {
        createFeatures: [
          {
            featureType: "plane",
            featureLabel: "Imported plane",
            participantTargets: [],
            parameterValues: {},
          },
        ],
        diagnostics: [
          { severity: "warning", message: "Imported with defaults." },
        ],
      };
    },
  };

  const session = await createImportSession({
    provider,
    source,
    capabilities: {
      context: {
        contractVersion: "cadara/v1alpha1",
        documentId: "doc_workspace",
        baseRevisionId: "rev_1",
      },
      modeling: {
        async bakeGeometry() {
          throw new Error("not used");
        },
        async reconstructMeshToBrep() {
          throw new Error("not used");
        },
      },
      sketch: {
        async convertVectorToSketch() {
          throw new Error("not used");
        },
      },
      assets: {
        async registerGeometryAsset() {
          throw new Error("not used");
        },
        async storeEmbeddedBinary() {
          throw new Error("not used");
        },
      },
    },
  });
  expect(
    session.providerId === "step" &&
      session.resolvedSource === source &&
      session.review === review &&
      (session.selections as { body: string }).body === "Body 1" &&
      providerCalls.slice(0, 3).join(",") === "review,defaults,schema",
    "Import session creation should run provider review, default selection, and form-schema wiring in order.",
  ).toBeTruthy();

  const prepared = await prepareImportActions({
    provider,
    source,
    review,
    selections: { body: "Body 1" },
    capabilities: {
      context: {
        contractVersion: "cadara/v1alpha1",
        documentId: "doc_workspace",
        baseRevisionId: "rev_1",
      },
      modeling: {
        async bakeGeometry() {
          throw new Error("not used");
        },
        async reconstructMeshToBrep() {
          throw new Error("not used");
        },
      },
      sketch: {
        async convertVectorToSketch() {
          throw new Error("not used");
        },
      },
      assets: {
        async registerGeometryAsset() {
          throw new Error("not used");
        },
        async storeEmbeddedBinary() {
          throw new Error("not used");
        },
      },
    },
  });
  expect(
    providerCalls.includes("prepare") &&
      prepared.createFeatures?.[0]?.featureLabel === "Imported plane" &&
      prepared.diagnostics?.[0]?.message === "Imported with defaults.",
    "Prepared import actions should come directly from the provider and preserve provider diagnostics.",
  ).toBeTruthy();
});

function makeRecordingModelingService(calls: string[]) {
  let counter = 1;
  const advance = () => {
    counter += 1;
    return `rev_${counter}`;
  };
  return {
    addDocumentVariable(input: { name: string }) {
      calls.push(`variable:${input.name}`);
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: advance(),
          variableId: `var_${input.name}`,
          revisionState: "advanced",
          rebuildResult: "reused",
          changedTargets: [],
          diagnostics: [],
        }),
        (error) =>
          createAppError({ code: "test/add-variable", message: String(error) }),
      );
    },
    createFeature(input: { featureLabel: string }) {
      calls.push(`feature:${input.featureLabel}`);
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: advance(),
          featureId: `feature_${input.featureLabel}`,
          revisionState: "advanced",
          rebuildResult: "reused",
          changedTargets: [],
          diagnostics: [],
        }),
        (error) =>
          createAppError({ code: "test/create-feature", message: String(error) }),
      );
    },
    commitSketch(input: { sketchLabel: string }) {
      calls.push(`sketch:${input.sketchLabel}`);
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: advance(),
          sketchId: `sketch_${input.sketchLabel}`,
          revisionState: "advanced",
          rebuildResult: "reused",
          changedTargets: [],
          diagnostics: [],
        }),
        (error) =>
          createAppError({ code: "test/commit-sketch", message: String(error) }),
      );
    },
  } as unknown as ModelingService;
}

test("applyImportPreparedActions honors an explicit interleaved order", async () => {
  const calls: string[] = [];
  await applyImportPreparedActions({
    modelingService: makeRecordingModelingService(calls),
    baseRevisionId: "rev_1",
    actions: {
      addDocumentVariables: [{ name: "scale", valueText: "10 mm" }],
      createFeatures: [
        {
          featureType: "plane",
          featureLabel: "F1",
          participantTargets: [],
          parameterValues: {},
        },
      ],
      commitSketches: [
        {
          sketchLabel: "S1",
          plane: null,
          definition: null,
        } as never,
      ],
      orderedActions: [
        { kind: "addDocumentVariable", index: 0 },
        { kind: "createFeature", index: 0 },
        { kind: "commitSketch", index: 0 },
      ],
    },
  });

  expect(
    calls.join(","),
    "Ordered application should apply actions in exactly the provider-specified sequence across kinds.",
  ).toBe("variable:scale,feature:F1,sketch:S1");
});

test("applyImportPreparedActions falls back to grouped order without a sequence", async () => {
  const calls: string[] = [];
  await applyImportPreparedActions({
    modelingService: makeRecordingModelingService(calls),
    baseRevisionId: "rev_1",
    actions: {
      commitSketches: [{ sketchLabel: "S1", plane: null, definition: null } as never],
      createFeatures: [
        {
          featureType: "plane",
          featureLabel: "F1",
          participantTargets: [],
          parameterValues: {},
        },
      ],
      addDocumentVariables: [{ name: "scale", valueText: "10 mm" }],
    },
  });

  expect(
    calls.join(","),
    "Grouped fallback should apply variables, then features, then sketches, preserving existing provider behavior.",
  ).toBe("variable:scale,feature:F1,sketch:S1");
});

test("applyImportPreparedActions rejects an invalid ordered sequence before mutating", async () => {
  const calls: string[] = [];
  await expect(
    applyImportPreparedActions({
      modelingService: makeRecordingModelingService(calls),
      baseRevisionId: "rev_1",
      actions: {
        createFeatures: [
          {
            featureType: "plane",
            featureLabel: "F1",
            participantTargets: [],
            parameterValues: {},
          },
        ],
        // Omits the feature entirely -> invalid permutation.
        orderedActions: [],
      },
    }),
  ).rejects.toThrow();

  expect(
    calls.length,
    "An invalid ordered sequence must be rejected before any action is applied.",
  ).toBe(0);
});

test("applyImportPreparedActions rolls back applied operations on mid-sequence failure", async () => {
  const calls: string[] = [];
  let counter = 1;
  const advance = () => {
    counter += 1;
    return `rev_${counter}`;
  };
  const service = {
    addDocumentVariable(input: { name: string }) {
      calls.push(`variable:${input.name}`);
      return ResultAsync.fromPromise(
        Promise.resolve({
          revisionId: advance(),
          variableId: `var_${input.name}`,
          revisionState: "advanced",
          rebuildResult: "reused",
          changedTargets: [],
          diagnostics: [],
        }),
        (error) => createAppError({ code: "test/var", message: String(error) }),
      );
    },
    commitSketch() {
      calls.push("sketch");
      // The second operation fails, forcing atomic rollback of the first.
      return ResultAsync.fromPromise(
        Promise.reject(new Error("kernel rejected the sketch")),
        () =>
          createAppError({
            code: "test/commit-sketch",
            message: "kernel rejected the sketch",
          }),
      );
    },
  } as unknown as ModelingService;

  const rolledBackCounts: number[] = [];
  const result = await applyImportPreparedActions({
    modelingService: service,
    baseRevisionId: "rev_1",
    actions: {
      addDocumentVariables: [{ name: "scale", valueText: "10" }],
      commitSketches: [{ sketchLabel: "S1", plane: null, definition: null } as never],
      orderedActions: [
        { kind: "addDocumentVariable", index: 0 },
        { kind: "commitSketch", index: 0 },
      ],
    },
    rollback: async (count) => {
      rolledBackCounts.push(count);
    },
  });

  expect(
    calls.join(","),
    "Application should stop at the failing operation.",
  ).toBe("variable:scale,sketch");
  expect(
    rolledBackCounts,
    "Rollback should be invoked once with the number of operations already applied.",
  ).toEqual([1]);
  expect(
    result.rolledBack &&
      result.createdEntityIds.variableIds.length === 0 &&
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "import-apply-failed",
      ),
    "A rolled-back import must report no created entities and an atomic-failure diagnostic, without throwing.",
  ).toBeTruthy();
});
