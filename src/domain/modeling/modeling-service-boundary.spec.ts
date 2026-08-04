import { test, expect } from "vitest";

import type {
  AddDocumentVariableResponse,
  CreateFeatureResponse,
} from "@/contracts/modeling/schema";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/domain/modeling/modeling-service-boundary.spec.ts", async () => {
  class MalformedDualSchemaResponseAdapter extends MockKernelAdapter {
    override async createFeature(): Promise<CreateFeatureResponse> {
      return {
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_workspace",
        revisionId: "rev_0001",
        revisionState: { kind: "accepted", baseRevisionId: "rev_0001" },
        rebuildResult: {
          kind: "succeeded",
          invalidatedTargets: [],
          diagnostics: [],
        },
        changedTargets: [],
        diagnostics: [],
      } as unknown as CreateFeatureResponse;
    }

    override async addDocumentVariable(): Promise<AddDocumentVariableResponse> {
      return {
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_workspace",
        revisionId: "rev_0001",
        revisionState: { kind: "accepted", baseRevisionId: "rev_0001" },
        rebuildResult: {
          kind: "succeeded",
          invalidatedTargets: [],
          diagnostics: [],
        },
        changedTargets: [],
        diagnostics: [],
      } as unknown as AddDocumentVariableResponse;
    }
  }

  const service = createModelingService(
    new MalformedDualSchemaResponseAdapter(),
    {
      currentDocumentId: "doc_workspace",
    },
  );
  const snapshot = await service.getCurrentDocumentSnapshot();
  const seedFeature = snapshot.document.features.find(
    (feature) => feature.definition.kind === "extrude",
  );
  expect(seedFeature?.definition.kind, "Seed extrude feature must exist.").toBe(
    "extrude",
  );

  const featureResult = await service.createFeature({
    baseRevisionId: snapshot.document.revisionId,
    definition: seedFeature.definition,
  });

  expect(
    featureResult.isErr(),
    "Malformed feature mutation responses should return a boundary error.",
  ).toBeTruthy();
  expect(
    featureResult.error.message.includes("CreateFeatureResponse"),
    "Feature response errors should name the first schema.",
  ).toBeTruthy();
  expect(
    featureResult.error.message.includes("UpdateFeatureResponse"),
    "Feature response errors should name the fallback schema.",
  ).toBeTruthy();
  expect(
    featureResult.error.message.includes("featureId"),
    "Feature response errors should include actionable schema issue paths.",
  ).toBeTruthy();

  const variableResult = await service.addDocumentVariable({
    baseRevisionId: snapshot.document.revisionId,
    variableId: "variable_width",
    name: "width",
    valueText: "10",
  });

  expect(
    variableResult.isErr(),
    "Malformed document variable mutation responses should return a boundary error.",
  ).toBeTruthy();
  expect(
    variableResult.error.message.includes("AddDocumentVariableResponse"),
    "Variable response errors should name the first schema.",
  ).toBeTruthy();
  expect(
    variableResult.error.message.includes("UpdateDocumentVariableResponse"),
    "Variable response errors should name the fallback schema.",
  ).toBeTruthy();
  expect(
    variableResult.error.message.includes("variableId"),
    "Variable response errors should include actionable schema issue paths.",
  ).toBeTruthy();
});

// Lane: logic. Seam: the modeling service lifecycle delegates disposal to its
// kernel adapter so isolated history-probe services release native runtime state.
test("modeling service disposal releases its kernel adapter", () => {
  let disposeCalls = 0;
  class DisposableAdapter extends MockKernelAdapter {
    dispose() {
      disposeCalls += 1;
    }
  }
  const service = createModelingService(new DisposableAdapter(), {
    currentDocumentId: "doc_workspace",
  });

  service.dispose();

  expect(disposeCalls).toBe(1);
});
