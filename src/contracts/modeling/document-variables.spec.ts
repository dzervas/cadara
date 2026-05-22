import { test, expect } from "vitest";

import { parseWorkspaceSnapshot } from "@/contracts/modeling/runtime-schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/contracts/modeling/document-variables.spec.ts", async () => {
  const adapter = new MockKernelAdapter();
  const response = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const snapshot = {
    ...response.snapshot,
    document: {
      ...response.snapshot.document,
      variables: [
        {
          variableId: "variable_width" as const,
          name: "width",
          valueText: "10 + 2",
        },
      ],
    },
  };

  const parsed = parseWorkspaceSnapshot(snapshot);

  expect(
    parsed.document.variables[0]?.variableId,
    "Snapshot validation should preserve variable ids.",
  ).toBe("variable_width");
  expect(
    parsed.document.variables[0]?.name,
    "Snapshot validation should preserve variable names.",
  ).toBe("width");
  expect(
    parsed.document.variables[0]?.valueText,
    "Snapshot validation should preserve raw variable value text.",
  ).toBe("10 + 2");
  expect(
    "calculatedValue" in parsed.document.variables[0]!,
    "Snapshot validation should not add calculated variable values.",
  ).toBeFalsy();
  expect(
    parsed.document.references.length,
    "Snapshot validation should not change snapshot reference records.",
  ).toBe(response.snapshot.document.references.length);

  try {
    parseWorkspaceSnapshot({
      ...snapshot,
      document: {
        ...snapshot.document,
        variables: [
          {
            variableId: "variable_width",
            name: "width",
            valueText: "10 + 2",
            calculatedValue: 12,
          },
        ],
      },
    });
    expect(
      false,
      "Snapshot validation should reject persisted variable runtime calculation state.",
    ).toBeTruthy();
  } catch (error) {
    expect(
      error instanceof Error,
      "Snapshot validation should report invalid variable records.",
    ).toBeTruthy();
  }
});
