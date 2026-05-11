import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import { IMPORT_CONTRACT_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  importBindingSchema,
  importPreparedActionsSchema,
  importSourceSchema,
  resolvedImportSourceSchema,
} from "@/contracts/import/validation";

test("src/contracts/import/validation.spec.ts", async () => {
  const importSourceResult = importSourceSchema.safeParse({
    kind: "localFile",
    fileName: "bracket.step",
    pathHint: "/workspace/bracket.step",
  });
  expectTrue(
    importSourceResult.success,
    "Import source schema should accept local file sources.",
  );

  const resolvedSourceResult = resolvedImportSourceSchema.safeParse({
    name: "bracket.step",
    origin: {
      kind: "url",
      url: "https://example.com/bracket.step",
    },
    mediaType: "model/step",
    bytes: new Uint8Array([1, 2, 3, 4]),
    fingerprint: `sha256:${"a".repeat(64)}`,
  });
  expectTrue(
    resolvedSourceResult.success,
    "Resolved import source schema should accept fetched byte payloads.",
  );

  const bindingResult = importBindingSchema.safeParse({
    schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
    kind: "cloudObject",
    service: "drive",
    objectId: "object-123",
    versionId: "v5",
    fingerprint: `sha256:${"b".repeat(64)}`,
    refreshPolicy: "manual",
  });
  expectTrue(
    bindingResult.success,
    "Import binding schema should accept portable cloud object bindings.",
  );

  const preparedActionsResult = importPreparedActionsSchema.safeParse({
    addDocumentVariables: [
      {
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_workspace",
        baseRevisionId: "rev_1",
        variableId: "variable_imported_pitch",
        name: "pitch",
        valueText: "42 mm",
      },
    ],
    binding: {
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "url",
      url: "https://example.com/bracket.step",
      fingerprint: `sha256:${"c".repeat(64)}`,
      refreshPolicy: "manual",
    },
    diagnostics: [
      {
        severity: "warning",
        message: "Ignored unsupported metadata block.",
        code: "metadata-skipped",
      },
    ],
  });
  expectTrue(
    preparedActionsResult.success,
    "Prepared action schema should accept adapter request payloads and import diagnostics.",
  );
});
