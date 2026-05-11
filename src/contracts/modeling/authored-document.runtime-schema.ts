import typia from "typia";

import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  CONTRACT_VERSION,
} from "@/contracts/shared/versioning";
import type {
  AuthoredModelDocument,
  AuthoredModelDocumentDiagnostic,
  AuthoredModelDocumentMigrationResult,
} from "@/contracts/modeling/authored-document";
import { validateContract } from "@/contracts/shared/validation";
import { validateFeatureDefinitionAuthoredValueInvariants } from "@/contracts/modeling/feature-authored-values";

const authoredModelDocumentValidator =
  typia.createValidateEquals<AuthoredModelDocument>();

function createDiagnostic(
  reasonCode: string,
  message: string,
): AuthoredModelDocumentDiagnostic {
  return { reasonCode, message };
}

function validationDiagnostic(message: string): AuthoredModelDocumentDiagnostic {
  if (message.includes("schemaVersion")) {
    return createDiagnostic(
      "unsupported-schema-version",
      "Authored model document schema version is not supported.",
    );
  }

  if (message.includes("contractVersion")) {
    return createDiagnostic(
      "unsupported-contract-version",
      "Authored model document contract version is not supported.",
    );
  }

  return createDiagnostic("invalid-authored-document", message);
}

function validateAuthoredModelDocumentInvariants(
  document: AuthoredModelDocument,
): AuthoredModelDocumentDiagnostic | null {
  if (document.contractVersion !== CONTRACT_VERSION) {
    return createDiagnostic(
      "unsupported-contract-version",
      "Authored model document contract version is not supported.",
    );
  }

  if (document.schemaVersion !== AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION) {
    return createDiagnostic(
      "unsupported-schema-version",
      "Authored model document schema version is not supported.",
    );
  }

  const featureIds = document.features.map((feature) => feature.featureId);
  const featureIdSet = new Set(featureIds);
  const orderIdSet = new Set(document.featureOrder);

  for (const feature of document.features) {
    const authoredValueIssues = validateFeatureDefinitionAuthoredValueInvariants(
      feature.definition,
    );
    if (authoredValueIssues.length > 0) {
      return createDiagnostic(
        "invalid-authored-document",
        authoredValueIssues[0]?.message ??
          "Authored model document feature definition is invalid.",
      );
    }
  }

  if (featureIds.length !== featureIdSet.size) {
    return createDiagnostic(
      "invalid-authored-document",
      "Authored model document contains duplicate feature IDs.",
    );
  }

  if (
    document.featureOrder.length !== orderIdSet.size ||
    featureIds.some((featureId) => !orderIdSet.has(featureId))
  ) {
    return createDiagnostic(
      "invalid-authored-document",
      "Authored model document featureOrder must contain each feature exactly once.",
    );
  }

  const sketchIds = new Set(
    document.sketches.map((sketch) => sketch.sketchId),
  );
  const seenHistoryTargets = new Set<string>();

  for (const item of document.historyOrder) {
    const key =
      item.kind === "sketch"
        ? `sketch:${item.sketchId}`
        : `feature:${item.featureId}`;

    if (seenHistoryTargets.has(key)) {
      return createDiagnostic(
        "invalid-authored-document",
        "Authored model document historyOrder must not contain duplicates.",
      );
    }
    seenHistoryTargets.add(key);

    if (item.kind === "sketch" && !sketchIds.has(item.sketchId)) {
      return createDiagnostic(
        "invalid-authored-document",
        "Authored model document historyOrder references a missing sketch.",
      );
    }

    if (item.kind === "feature" && !featureIdSet.has(item.featureId)) {
      return createDiagnostic(
        "invalid-authored-document",
        "Authored model document historyOrder references a missing feature.",
      );
    }
  }

  for (const sketchId of sketchIds) {
    if (!seenHistoryTargets.has(`sketch:${sketchId}`)) {
      return createDiagnostic(
        "invalid-authored-document",
        "Authored model document historyOrder must contain each sketch exactly once.",
      );
    }
  }

  for (const featureId of featureIds) {
    if (!seenHistoryTargets.has(`feature:${featureId}`)) {
      return createDiagnostic(
        "invalid-authored-document",
        "Authored model document historyOrder must contain each feature exactly once.",
      );
    }
  }

  if (
    document.cursor.kind === "feature" &&
    !featureIdSet.has(document.cursor.featureId)
  ) {
    return createDiagnostic(
      "invalid-authored-document",
      "Authored model document cursor references a missing feature.",
    );
  }

  if (
    document.cursor.kind === "sketch" &&
    !sketchIds.has(document.cursor.sketchId)
  ) {
    return createDiagnostic(
      "invalid-authored-document",
      "Authored model document cursor references a missing sketch.",
    );
  }

  return null;
}

export function migrateAuthoredModelDocument(
  value: unknown,
): AuthoredModelDocumentMigrationResult {
  const result = validateContract(authoredModelDocumentValidator, value);
  if (!result.success) {
    return {
      ok: false,
      diagnostic: validationDiagnostic(
        result.issues[0]?.message ?? "Authored model document is invalid.",
      ),
    };
  }

  const invariantFailure = validateAuthoredModelDocumentInvariants(result.data);
  if (invariantFailure) {
    return {
      ok: false,
      diagnostic: invariantFailure,
    };
  }

  return {
    ok: true,
    document: result.data,
    migrated: false,
  };
}

export function parseAuthoredModelDocument(
  value: unknown,
): AuthoredModelDocumentMigrationResult {
  return migrateAuthoredModelDocument(value);
}
