import { test, expect } from "vitest";

import { IMPORT_CONTRACT_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  validateImportBinding,
  validateImportPreparedActions,
  validateImportSource,
  validateResolvedImportSource,
} from "@/contracts/import/validation";

test("src/contracts/import/validation.spec.ts", async () => {
  const importSourceResult = validateImportSource({
    kind: "localFile",
    fileName: "bracket.step",
    pathHint: "/workspace/bracket.step",
  });
  expect(
    importSourceResult.success,
    "Import source schema should accept local file sources.",
  ).toBeTruthy();

  const resolvedSourceResult = validateResolvedImportSource({
    name: "bracket.step",
    origin: {
      kind: "url",
      url: "https://example.com/bracket.step",
    },
    mediaType: "model/step",
    bytes: new Uint8Array([1, 2, 3, 4]),
    fingerprint: `sha256:${"a".repeat(64)}`,
  });
  expect(
    resolvedSourceResult.success,
    "Resolved import source schema should accept fetched byte payloads.",
  ).toBeTruthy();

  const bindingResult = validateImportBinding({
    schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
    kind: "cloudObject",
    service: "drive",
    objectId: "object-123",
    versionId: "v5",
    fingerprint: `sha256:${"b".repeat(64)}`,
    refreshPolicy: "manual",
  });
  expect(
    bindingResult.success,
    "Import binding schema should accept portable cloud object bindings.",
  ).toBeTruthy();

  const preparedActionsResult = validateImportPreparedActions({
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
  expect(
    preparedActionsResult.success,
    "Prepared action schema should accept adapter request payloads and import diagnostics.",
  ).toBeTruthy();

  expect(
    validateImportSource({ kind: "url", url: "not-a-url" }).success,
    "Import source validation should reject malformed URL sources.",
  ).toBeFalsy();
  expect(
    validateImportSource({ kind: "localFile", fileName: "   " }).success,
    "Import source validation should reject empty local file names.",
  ).toBeFalsy();
  expect(
    validateResolvedImportSource({
      name: "bracket.step",
      origin: { kind: "url", url: "https://example.com/bracket.step" },
      mediaType: "model/step",
      bytes: new Uint8Array([1, 2, 3, 4]),
      fingerprint: "sha256:not64hex",
    }).success,
    "Resolved import source validation should reject malformed fingerprints.",
  ).toBeFalsy();
  expect(
    validateImportBinding({
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "url",
      url: "not-a-url",
      fingerprint: `sha256:${"d".repeat(64)}`,
      refreshPolicy: "manual",
    }).success,
    "Import binding validation should reject malformed URL bindings.",
  ).toBeFalsy();
  expect(
    validateImportBinding({
      schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
      kind: "cloudObject",
      service: "",
      objectId: "object-123",
      fingerprint: `sha256:${"e".repeat(64)}`,
      refreshPolicy: "manual",
    }).success,
    "Import binding validation should reject empty cloud binding service names.",
  ).toBeFalsy();
  expect(
    validateImportPreparedActions({
      binding: {
        schemaVersion: IMPORT_CONTRACT_SCHEMA_VERSION,
        kind: "url",
        url: "https://example.com/bracket.step",
        fingerprint: "sha256:not64hex",
        refreshPolicy: "manual",
      },
    }).success,
    "Prepared action validation should reject invalid nested import bindings.",
  ).toBeFalsy();

  const variableRequest = (name: string) => ({
    contractVersion: "modeling-contract/v1alpha1" as const,
    documentId: "doc_workspace",
    baseRevisionId: "rev_1",
    variableId: `variable_${name}`,
    name,
    valueText: "10 mm",
  });

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a"), variableRequest("b")],
      orderedActions: [
        { kind: "addDocumentVariable", index: 1 },
        { kind: "addDocumentVariable", index: 0 },
      ],
    }).success,
    "Prepared action validation should accept an ordered sequence that permutes every prepared action once.",
  ).toBeTruthy();

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a"), variableRequest("b")],
      orderedActions: [{ kind: "addDocumentVariable", index: 0 }],
    }).success,
    "Prepared action validation should reject an ordered sequence that omits a prepared action.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a")],
      orderedActions: [
        { kind: "addDocumentVariable", index: 0 },
        { kind: "addDocumentVariable", index: 0 },
      ],
    }).success,
    "Prepared action validation should reject an ordered sequence that duplicates a prepared action.",
  ).toBeFalsy();

  expect(
    validateImportPreparedActions({
      addDocumentVariables: [variableRequest("a")],
      orderedActions: [{ kind: "addDocumentVariable", index: 5 }],
    }).success,
    "Prepared action validation should reject an ordered sequence with an out-of-range index.",
  ).toBeFalsy();
});
