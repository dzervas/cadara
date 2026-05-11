import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
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
    variables: [
      {
        variableId: "variable_width" as const,
        name: "width",
        valueText: "10 + 2",
      },
    ],
  };

  const parsed = parseWorkspaceSnapshot(snapshot);

  expectTrue(
    parsed.document.variables[0]?.variableId === "variable_width",
    "Snapshot validation should preserve variable ids.",
  );
  expectTrue(
    parsed.document.variables[0]?.name === "width",
    "Snapshot validation should preserve variable names.",
  );
  expectTrue(
    parsed.document.variables[0]?.valueText === "10 + 2",
    "Snapshot validation should preserve raw variable value text.",
  );
  expectTrue(
    !("calculatedValue" in parsed.document.variables[0]!),
    "Snapshot validation should not add calculated variable values.",
  );
  expectTrue(
    parsed.document.references.length ===
      response.snapshot.document.references.length,
    "Snapshot validation should not change snapshot reference records.",
  );

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
    expectTrue(
      false,
      "Snapshot validation should reject persisted variable runtime calculation state.",
    );
  } catch (error) {
    expectTrue(
      error instanceof Error,
      "Snapshot validation should report invalid variable records.",
    );
  }
});
