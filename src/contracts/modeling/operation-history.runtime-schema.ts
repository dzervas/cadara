import typia from "typia";

import type {
  ModelingOperationHistoryPayload,
  OperationHistoryValidationResult,
} from "@/contracts/modeling/operation-history";
import {
  CONTRACT_VERSION,
  OPERATION_HISTORY_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { validateContract } from "@/contracts/shared/validation";

const operationHistoryPayloadValidator =
  typia.createValidateEquals<ModelingOperationHistoryPayload>();

const transportOnlyFields = [
  "contractVersion",
  "documentId",
  "baseRevisionId",
  "requestId",
  "solverCorrelation",
] as const;

function hasTransportOnlyFields(value: Record<string, unknown>) {
  return transportOnlyFields.some((field) => field in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateOperationHistoryInvariants(
  payload: ModelingOperationHistoryPayload,
): OperationHistoryValidationResult {
  if (payload.contractVersion !== CONTRACT_VERSION) {
    return {
      ok: false,
      reasonCode: "unsupported-contract-version",
      message: "Operation history contract version is not supported.",
    };
  }

  if (payload.schemaVersion !== OPERATION_HISTORY_SCHEMA_VERSION) {
    return {
      ok: false,
      reasonCode: "unsupported-schema-version",
      message: "Operation history schema version is not supported.",
    };
  }

  for (const [entryIndex, entry] of payload.entries.entries()) {
    const entryInvariant = findEntryInvariantIssue(entry, entryIndex);
    if (entryInvariant) {
      return entryInvariant;
    }
  }

  return {
    ok: true,
    payload,
  };
}

function findEntryInvariantIssue(
  entry: unknown,
  entryIndex: number,
): OperationHistoryValidationResult | null {
  if (!isRecord(entry)) {
    return null;
  }

  const kind = entry.kind;
  const payload = entry.payload;
  if ("payload" in entry && !isRecord(payload)) {
    return {
      ok: false,
      reasonCode: "invalid-entry-shape",
      message: `Operation history entry ${entryIndex} payload must be an object.`,
    };
  }
  if (isRecord(payload) && hasTransportOnlyFields(payload)) {
    return {
      ok: false,
      reasonCode: "transport-field-leak",
      message: `Operation history entry ${entryIndex} contains request envelope fields that must not be persisted.`,
    };
  }

  if (kind === "commitSketch" && isRecord(payload)) {
    const def = payload.definition;
    if (!isRecord(def)) {
      return null;
    }

    const sketchIds = new Set<string | null>();
    const points = Array.isArray(def.points) ? def.points : [];
    const entities = Array.isArray(def.entities) ? def.entities : [];
    for (const point of points) {
      if (isRecord(point) && isRecord(point.target)) {
        sketchIds.add((point.target.sketchId as string | null) ?? null);
      }
    }
    for (const entity of entities) {
      if (isRecord(entity) && isRecord(entity.target)) {
        sketchIds.add((entity.target.sketchId as string | null) ?? null);
      }
    }
    if (sketchIds.size > 1) {
      return {
        ok: false,
        reasonCode: "inconsistent-commit-sketch-targets",
        message:
          "Persisted commitSketch entry contains targets referencing different sketch ids.",
      };
    }
  }

  if (
    (kind === "createFeature" || kind === "updateFeature") &&
    isRecord(payload)
  ) {
    const def = payload.definition;
    if (isRecord(def) && isRecord(def.parameters)) {
      const params = def.parameters as Record<string, unknown>;

      if ("profile" in params && !Array.isArray(params.profiles)) {
        return {
          ok: false,
          reasonCode: "legacy-profile-parameter",
          message:
            "Legacy singular profile parameter is no longer accepted.",
        };
      }

      if (Array.isArray(params.profiles)) {
        if (params.profiles.length === 0) {
          return {
            ok: false,
            reasonCode: "invalid-profile-collection",
            message: "Feature profile collection must not be empty.",
          };
        }

        const profileKeys = params.profiles.map((profile) =>
          isRecord(profile)
            ? `${profile.kind}:${profile.sketchId}:${profile.regionId ?? profile.entityId ?? profile.bodyId ?? profile.faceId ?? ""}`
            : `invalid:${entryIndex}`,
        );
        if (new Set(profileKeys).size !== profileKeys.length) {
          return {
            ok: false,
            reasonCode: "duplicate-profile-reference",
            message: "Feature profile collection must not contain duplicates.",
          };
        }
      }

      if (Array.isArray(params.participants)) {
        for (const participant of params.participants) {
          if (
            !isRecord(participant) ||
            !Array.isArray((participant as Record<string, unknown>).targets)
          ) {
            return {
              ok: false,
              reasonCode: "invalid-advanced-participant",
              message:
                "Advanced feature participants must have array targets.",
            };
          }
        }
      }

      if (
        "extent" in params &&
        isRecord(params.extent) &&
        (params.extent as Record<string, unknown>).mode === "symmetric"
      ) {
        const extent = params.extent as Record<string, unknown>;
        const end = extent.end as Record<string, unknown> | undefined;
        if (def.kind === "extrude" && end) {
          if (end.kind !== "blind" && end.kind !== "throughAll") {
            return {
              ok: false,
              reasonCode: "invalid-symmetric-extent",
              message:
                "Symmetric extrude extents only accept blind or throughAll end conditions.",
            };
          }
        }
        if (def.kind === "revolve" && end) {
          if (end.kind !== "blind") {
            return {
              ok: false,
              reasonCode: "invalid-symmetric-extent",
              message:
                "Symmetric revolve extents only accept blind end conditions.",
            };
          }
        }
      }
    }
  }

  return null;
}

function reasonCodeForPath(path: string | undefined, message: string | undefined) {
  if (!path) {
    return "invalid-payload-shape";
  }

  if (path.includes("contractVersion")) {
    return "unsupported-contract-version";
  }

  if (path.includes("schemaVersion")) {
    return "unsupported-schema-version";
  }

  if (path.includes("entries")) {
    for (const field of transportOnlyFields) {
      if (path.includes(field) || message?.includes(field)) {
        return "transport-field-leak";
      }
    }
    return "invalid-entry-shape";
  }

  return "invalid-payload-shape";
}

function findOperationHistoryInvariantIssue(
  value: unknown,
): OperationHistoryValidationResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const entries = value.entries;
  if (!Array.isArray(entries)) {
    return null;
  }

  for (const [entryIndex, entry] of entries.entries()) {
    const issue = findEntryInvariantIssue(entry, entryIndex);
    if (issue) {
      return issue;
    }
  }

  return null;
}

export function parseOperationHistoryPayload(
  value: unknown,
): OperationHistoryValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      reasonCode: "invalid-payload-shape",
      message: "Operation history payload must be an object.",
    };
  }

  const result = validateContract(operationHistoryPayloadValidator, value);
  if (!result.success) {
    const issue = result.issues[0];
    const invariantIssue = findOperationHistoryInvariantIssue(value);
    if (invariantIssue) {
      return invariantIssue;
    }

    return {
      ok: false,
      reasonCode: reasonCodeForPath(issue?.path, issue?.message),
      message:
        issue?.message ?? "Operation history payload failed validation.",
    };
  }

  return validateOperationHistoryInvariants(result.data);
}
