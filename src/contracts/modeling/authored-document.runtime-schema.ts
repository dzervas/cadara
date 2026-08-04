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

  const lineageFeatureIds = new Set<string>();
  for (const lineage of document.topologyLineage ?? []) {
    if (
      lineageFeatureIds.has(lineage.featureId) ||
      !featureIdSet.has(lineage.featureId)
    ) {
      return createDiagnostic(
        "invalid-authored-document",
        "Authored topology lineage must reference each existing feature at most once.",
      );
    }
    lineageFeatureIds.add(lineage.featureId);

    const outputSlots = new Set<string>();
    const outputWitnessSets = new Set<string>();
    for (const output of lineage.outputs) {
      if (outputSlots.has(output.outputSlot) || output.topologyToken.length === 0) {
        return createDiagnostic(
          "invalid-authored-document",
          "Authored topology lineage outputs must have unique slots and non-empty tokens.",
        );
      }
      outputSlots.add(output.outputSlot);
      if (output.outputWitnesses) {
        const witnessKey = JSON.stringify([...output.outputWitnesses].sort());
        if (
          output.outputWitnesses.length === 0 ||
          new Set(output.outputWitnesses).size !== output.outputWitnesses.length ||
          output.outputWitnesses.some((witness) => witness.trim().length === 0) ||
          outputWitnessSets.has(witnessKey)
        ) {
          return createDiagnostic(
            "invalid-authored-document",
            "Authored topology lineage output witnesses must be unique non-empty exact sets.",
          );
        }
        outputWitnessSets.add(witnessKey);
      }

      const topologyIds = {
        face: new Set(output.topology.faceIds),
        edge: new Set(output.topology.edgeIds),
        vertex: new Set(output.topology.vertexIds),
      };
      if (
        topologyIds.face.size !== output.topology.faceIds.length ||
        topologyIds.edge.size !== output.topology.edgeIds.length ||
        topologyIds.vertex.size !== output.topology.vertexIds.length
      ) {
        return createDiagnostic(
          "invalid-authored-document",
          "Authored topology lineage outputs must not contain duplicate topology IDs.",
        );
      }

      const sourceKeys = new Set<string>();
      for (const source of output.sourceTargets) {
        if (sourceKeys.has(source.sourceKey)) {
          return createDiagnostic(
            "invalid-authored-document",
            "Authored topology lineage outputs must not contain duplicate source keys.",
          );
        }
        sourceKeys.add(source.sourceKey);
        const targetKeys = new Set<string>();
        for (const target of source.targets) {
          const targetId =
            target.kind === "face"
              ? target.faceId
              : target.kind === "edge"
                ? target.edgeId
                : target.vertexId;
          const targetKey = `${target.kind}:${target.bodyId}:${targetId}`;
          const belongsToOutput =
            target.kind === "face"
              ? topologyIds.face.has(target.faceId)
              : target.kind === "edge"
                ? topologyIds.edge.has(target.edgeId)
                : topologyIds.vertex.has(target.vertexId);
          if (
            target.bodyId !== output.outputSlot ||
            !belongsToOutput ||
            targetKeys.has(targetKey)
          ) {
            return createDiagnostic(
              "invalid-authored-document",
              "Authored topology lineage targets must be unique members of their output topology.",
            );
          }
          targetKeys.add(targetKey);
        }
      }

      if (
        new Set(output.unsupportedSourceKeys).size !==
          output.unsupportedSourceKeys.length ||
        output.unsupportedSourceKeys.some((sourceKey) => sourceKeys.has(sourceKey))
      ) {
        return createDiagnostic(
          "invalid-authored-document",
          "Authored topology lineage unsupported source keys must be unique and disjoint.",
        );
      }
    }
  }

  const sketchIds = new Set(
    document.sketches.map((sketch) => sketch.sketchId),
  );
  const seenHistoryTargets = new Set<string>();
  for (const sketch of document.sketches) {
    const slotRegionIds = new Set<string>();
    const slotWitnesses = new Set<string>();
    for (const slot of sketch.regionSlots ?? []) {
      const witnessKey = JSON.stringify([...slot.boundaryWitnesses].sort());
      if (
        slotRegionIds.has(slot.regionId) ||
        slotWitnesses.has(witnessKey) ||
        slot.boundaryWitnesses.length === 0 ||
        new Set(slot.boundaryWitnesses).size !== slot.boundaryWitnesses.length ||
        slot.boundaryWitnesses.some((witness) => witness.trim().length === 0)
      ) {
        return createDiagnostic(
          "invalid-authored-document",
          "Authored sketch region slots must have unique ids and exact non-empty witness sets.",
        );
      }
      slotRegionIds.add(slot.regionId);
      slotWitnesses.add(witnessKey);
    }
  }

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

  const document = result.data;
  const invariantFailure = validateAuthoredModelDocumentInvariants(document);
  if (invariantFailure) {
    return {
      ok: false,
      diagnostic: invariantFailure,
    };
  }

  return {
    ok: true,
    document,
    migrated: false,
  };
}

export function parseAuthoredModelDocument(
  value: unknown,
): AuthoredModelDocumentMigrationResult {
  return migrateAuthoredModelDocument(value);
}
