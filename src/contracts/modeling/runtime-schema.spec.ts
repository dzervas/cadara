import { test, expect } from "vitest";

import {
  requireDeleteDocumentTargetRequest,
  requireDeleteDocumentTargetResponse,
  validateGetDocumentSnapshotResponse,
  validateKernelDocumentSnapshot,
  validateWorkspaceSnapshot,
  validateDeleteDocumentTargetRequest,
} from "@/contracts/modeling/runtime-schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/contracts/modeling/runtime-schema.spec.ts", async () => {
  const request = requireDeleteDocumentTargetRequest({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: "rev_0001",
    target: { kind: "feature", featureId: "feature_extrude-1" },
  });
  expect(
    request.target.kind,
    "Generic delete requests should accept feature history targets.",
  ).toBe("feature");

  const unsupportedRequest = requireDeleteDocumentTargetRequest({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: "rev_0001",
    target: { kind: "face", bodyId: "body_part-1", faceId: "face_top" },
  });
  expect(
    unsupportedRequest.target.kind,
    "Generic delete requests should preserve unsupported durable targets for adapter rejection.",
  ).toBe("face");

  const malformedRequest = validateDeleteDocumentTargetRequest({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: "rev_0001",
    target: { kind: "feature" },
  });
  expect(
    malformedRequest.success,
    "Malformed generic delete targets should fail runtime request validation.",
  ).toBeFalsy();

  const conflictResponse = requireDeleteDocumentTargetResponse({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    revisionId: "rev_0002",
    deletedTarget: { kind: "body", bodyId: "body_part-1" },
    revisionState: {
      kind: "conflict",
      expectedRevisionId: "rev_0001",
      actualRevisionId: "rev_0002",
    },
    rebuildResult: {
      kind: "skipped",
      reasonCode: "revisionConflict",
      invalidatedTargets: [],
      diagnostics: [],
    },
    changedTargets: [],
    diagnostics: [],
  });
  expect(
    conflictResponse.revisionState.kind,
    "Generic delete responses should validate stale revision conflicts.",
  ).toBe("conflict");

  const adapter = new MockKernelAdapter();
  const response = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  expect(
    validateGetDocumentSnapshotResponse(response).success,
    "Seeded document snapshot responses should use canonical authored-value wrappers.",
  ).toBeTruthy();

  const invalidFeature = response.snapshot.document.features.find(
    (feature) => feature.definition.kind === "extrude",
  );
  expect(
    invalidFeature?.definition.kind,
    "Seeded snapshot should expose an extrude definition for boundary validation.",
  ).toBe("extrude");

  const invalidDefinition = {
    ...invalidFeature.definition,
    parameters: {
      ...invalidFeature.definition.parameters,
      extent: {
        mode: "oneSide",
        end: {
          kind: "blind",
          direction: "positive",
          distance: 12,
        },
      },
    },
  };
  const invalidDocument = {
    ...response.snapshot.document,
    features: response.snapshot.document.features.map((feature) =>
      feature.featureId === invalidFeature.featureId
        ? { ...feature, definition: invalidDefinition }
        : feature,
    ),
  };
  const invalidWorkspace = {
    ...response.snapshot,
    document: invalidDocument,
  };
  const invalidResponse = {
    ...response,
    snapshot: invalidWorkspace,
  };

  expect(
    validateKernelDocumentSnapshot(invalidDocument).success,
    "Kernel snapshot validation should reject legacy raw authored values nested in feature definitions.",
  ).toBeFalsy();
  expect(
    validateWorkspaceSnapshot(invalidWorkspace).success,
    "Workspace snapshot validation should reject legacy raw authored values nested in feature definitions.",
  ).toBeFalsy();
  expect(
    validateGetDocumentSnapshotResponse(invalidResponse).success,
    "Snapshot response validation should reject legacy raw authored values nested in feature definitions.",
  ).toBeFalsy();
});
