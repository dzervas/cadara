import { z, type ZodIssue } from "zod";

import type {
  ModelingOperationHistoryEntry,
  ModelingOperationHistoryPayload,
  OperationHistoryValidationResult,
  PersistedAddDocumentVariablePayload,
  PersistedCommitSketchPayload,
  PersistedCreateFeaturePayload,
  PersistedDeleteFeaturePayload,
  PersistedSetFeatureSuppressionPayload,
  PersistedDeleteTargetPayload,
  PersistedRenameBodyPayload,
  PersistedReorderDocumentHistoryPayload,
  PersistedReorderFeaturePayload,
  PersistedSetFeatureCursorPayload,
  PersistedUpdateDocumentVariablePayload,
  PersistedUpdateFeaturePayload,
} from "@/contracts/modeling/operation-history";
import { featureDefinitionSchema } from "@/contracts/modeling/runtime-schema";
import {
  OPERATION_HISTORY_SCHEMA_VERSION,
  type OperationHistorySchemaVersion,
} from "@/contracts/shared/versioning";
import {
  contractVersionSchema,
  documentIdSchema,
  bodyIdSchema,
  documentVariableIdSchema,
  featureIdSchema,
  literalVersionSchema,
  sketchIdSchema,
  stringSchema,
} from "@/contracts/shared/runtime-schema";
import { durableRefSchema } from "@/contracts/shared/references.runtime-schema";
import { sketchDefinitionSchema } from "@/contracts/sketch/runtime-schema";
import { sketchPlaneDefinitionSchema } from "@/contracts/shared/sketch-plane.runtime-schema";

const transportOnlyFields = [
  "contractVersion",
  "documentId",
  "baseRevisionId",
  "requestId",
  "solverCorrelation",
] as const;
const advancedFeatureKinds = new Set([
  "combine",
  "sweep",
  "loft",
  "wrap",
  "thicken",
  "enclose",
  "split",
  "deleteSolid",
  "faceBlend",
  "chamfer",
  "hole",
  "externalThread",
  "mirror",
  "transform",
]);
const advancedOperationIntents = new Set([
  "create",
  "add",
  "subtract",
  "intersect",
]);
const advancedParticipantRoles = new Set([
  "profile",
  "path",
  "guideCurve",
  "face",
  "edge",
  "body",
  "toolBody",
  "targetBody",
  "plane",
  "axis",
  "transformReference",
  "enclosingRegionSeed",
]);

function hasTransportOnlyFields(value: Record<string, unknown>) {
  return transportOnlyFields.some((field) => field in value);
}

const operationHistorySchemaVersionSchema =
  literalVersionSchema<OperationHistorySchemaVersion>(
    OPERATION_HISTORY_SCHEMA_VERSION,
    "schemaVersion",
    "Unsupported operation history schema version",
  );

const persistedCommitSketchPayloadSchema = z
  .object({
    sketchId: stringSchema.nullable(),
    sketchLabel: stringSchema,
    plane: sketchPlaneDefinitionSchema,
    definition: sketchDefinitionSchema,
  })
  .superRefine((value, ctx) => {
    const expectedSketchId = value.sketchId;
    let inferredSketchId: string | null = null;

    const validateSketchId = (
      target: { kind: string; sketchId: string },
      targetKind: "sketchPoint" | "sketchEntity",
      entryKind: "point" | "entity",
    ) => {
      if (target.kind !== targetKind) {
        ctx.addIssue({
          code: "custom",
          message: `commitSketch definition has inconsistent ${entryKind} sketch IDs.`,
        });
        return;
      }

      if (expectedSketchId !== null && target.sketchId !== expectedSketchId) {
        ctx.addIssue({
          code: "custom",
          message: `commitSketch definition has inconsistent ${entryKind} sketch IDs.`,
        });
        return;
      }

      if (inferredSketchId === null) {
        inferredSketchId = target.sketchId;
        return;
      }

      if (target.sketchId !== inferredSketchId) {
        ctx.addIssue({
          code: "custom",
          message: `commitSketch definition has inconsistent ${entryKind} sketch IDs.`,
        });
      }
    };

    for (const point of value.definition.points) {
      validateSketchId(point.target, "sketchPoint", "point");
    }

    for (const entity of value.definition.entities) {
      validateSketchId(entity.target, "sketchEntity", "entity");
    }
  })
  .transform((value) => value as PersistedCommitSketchPayload);

const rawFeatureDefinitionSchema = z.unknown().superRefine((value, ctx) => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const definition = value as Record<string, unknown>;
    if (
      (definition.kind === "extrude" || definition.kind === "revolve") &&
      typeof definition.parameters === "object" &&
      definition.parameters !== null &&
      !Array.isArray(definition.parameters)
    ) {
      const parameters = definition.parameters as Record<string, unknown>;

      if ("profile" in parameters) {
        ctx.addIssue({
          code: "custom",
          message: `${definition.kind} uses unsupported parameters.profile instead of profiles.`,
        });
        return;
      }

      if (
        !Array.isArray(parameters.profiles) ||
        parameters.profiles.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: `${definition.kind} profiles must be non-empty.`,
        });
        return;
      }

      const seenProfiles = new Set<string>();
      for (const profile of parameters.profiles) {
        const key = JSON.stringify(profile);
        if (seenProfiles.has(key)) {
          ctx.addIssue({
            code: "custom",
            message: `${definition.kind} contains duplicate profile references.`,
          });
          return;
        }
        seenProfiles.add(key);
      }
    }

    if (
      typeof definition.kind === "string" &&
      advancedFeatureKinds.has(definition.kind) &&
      typeof definition.parameters === "object" &&
      definition.parameters !== null &&
      !Array.isArray(definition.parameters)
    ) {
      const parameters = definition.parameters as Record<string, unknown>;
      const operationIntent = parameters.operationIntent;
      if (
        operationIntent !== undefined &&
        typeof operationIntent === "string" &&
        !advancedOperationIntents.has(operationIntent)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Advanced feature has an invalid operation intent.",
        });
        return;
      }

      if (!Array.isArray(parameters.participants)) {
        ctx.addIssue({
          code: "custom",
          message: "Advanced feature has invalid participants.",
        });
        return;
      }

      for (const participant of parameters.participants) {
        if (
          typeof participant !== "object" ||
          participant === null ||
          Array.isArray(participant) ||
          typeof (participant as Record<string, unknown>).role !== "string" ||
          !advancedParticipantRoles.has(
            (participant as Record<string, unknown>).role as string,
          ) ||
          !Array.isArray((participant as Record<string, unknown>).targets)
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Advanced feature has an invalid participant.",
          });
          return;
        }
      }
    }
  }

  const parsed = featureDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
    return;
  }
});

const persistedCreateFeaturePayloadSchema = z
  .object({
    featureLabel: stringSchema.optional(),
    definition: rawFeatureDefinitionSchema,
  })
  .transform(
    (value) =>
      ({
        featureLabel: value.featureLabel,
        definition: featureDefinitionSchema.parse(value.definition),
      }) as PersistedCreateFeaturePayload,
  );

const persistedUpdateFeaturePayloadSchema = z
  .object({
    featureId: featureIdSchema,
    featureLabel: stringSchema.optional(),
    definition: rawFeatureDefinitionSchema,
  })
  .transform(
    (value) =>
      ({
        featureId: value.featureId,
        featureLabel: value.featureLabel,
        definition: featureDefinitionSchema.parse(value.definition),
      }) as PersistedUpdateFeaturePayload,
  );

const persistedDeleteFeaturePayloadSchema = z
  .object({
    featureId: featureIdSchema,
  })
  .transform((value) => value as PersistedDeleteFeaturePayload);

const persistedSetFeatureSuppressionPayloadSchema = z
  .object({
    featureId: featureIdSchema,
    suppressed: z.boolean(),
  })
  .strict()
  .transform((value) => value as PersistedSetFeatureSuppressionPayload);

const persistedDeleteTargetPayloadSchema = z
  .object({
    target: durableRefSchema,
  })
  .transform((value) => value as PersistedDeleteTargetPayload);

const persistedRenameBodyPayloadSchema = z
  .object({
    bodyId: bodyIdSchema,
    bodyLabel: stringSchema,
  })
  .transform((value) => value as PersistedRenameBodyPayload);

const persistedReorderFeaturePayloadSchema = z
  .object({
    featureId: featureIdSchema,
    beforeFeatureId: featureIdSchema.nullable(),
  })
  .transform((value) => value as PersistedReorderFeaturePayload);

const documentHistoryOrderEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sketch"), sketchId: sketchIdSchema }),
  z.object({ kind: z.literal("feature"), featureId: featureIdSchema }),
]);

const persistedReorderDocumentHistoryPayloadSchema = z
  .object({
    item: documentHistoryOrderEntrySchema,
    beforeItem: documentHistoryOrderEntrySchema.nullable(),
  })
  .transform((value) => value as PersistedReorderDocumentHistoryPayload);

const persistedSetFeatureCursorPayloadSchema = z
  .object({
    cursor: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("empty") }),
      z.object({ kind: z.literal("feature"), featureId: featureIdSchema }),
    ]),
  })
  .transform((value) => value as PersistedSetFeatureCursorPayload);

const persistedAddDocumentVariablePayloadSchema = z
  .object({
    variableId: documentVariableIdSchema,
    name: stringSchema,
    valueText: stringSchema,
  })
  .strict()
  .transform((value) => value as PersistedAddDocumentVariablePayload);

const persistedUpdateDocumentVariablePayloadSchema = z
  .object({
    variableId: documentVariableIdSchema,
    name: stringSchema,
    valueText: stringSchema,
  })
  .strict()
  .transform((value) => value as PersistedUpdateDocumentVariablePayload);

const operationHistoryEntrySchema = z
  .object({
    kind: z.union([
      z.literal("commitSketch"),
      z.literal("createFeature"),
      z.literal("updateFeature"),
      z.literal("setFeatureSuppression"),
      z.literal("deleteFeature"),
      z.literal("deleteTarget"),
      z.literal("renameBody"),
      z.literal("reorderFeature"),
      z.literal("reorderDocumentHistory"),
      z.literal("setFeatureCursor"),
      z.literal("addDocumentVariable"),
      z.literal("updateDocumentVariable"),
    ]),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((value, ctx) => {
    if (hasTransportOnlyFields(value.payload)) {
      ctx.addIssue({
        code: "custom",
        message: "Entry payload contains transport-only request metadata.",
        path: ["payload"],
      });
      return;
    }

    const payloadSchema = (() => {
      switch (value.kind) {
        case "commitSketch":
          return persistedCommitSketchPayloadSchema;
        case "createFeature":
          return persistedCreateFeaturePayloadSchema;
        case "updateFeature":
          return persistedUpdateFeaturePayloadSchema;
        case "setFeatureSuppression":
          return persistedSetFeatureSuppressionPayloadSchema;
        case "deleteFeature":
          return persistedDeleteFeaturePayloadSchema;
        case "deleteTarget":
          return persistedDeleteTargetPayloadSchema;
        case "renameBody":
          return persistedRenameBodyPayloadSchema;
        case "reorderFeature":
          return persistedReorderFeaturePayloadSchema;
        case "reorderDocumentHistory":
          return persistedReorderDocumentHistoryPayloadSchema;
        case "setFeatureCursor":
          return persistedSetFeatureCursorPayloadSchema;
        case "addDocumentVariable":
          return persistedAddDocumentVariablePayloadSchema;
        case "updateDocumentVariable":
          return persistedUpdateDocumentVariablePayloadSchema;
        default:
          return null;
      }
    })();

    if (!payloadSchema) {
      ctx.addIssue({
        code: "custom",
        message: "Entry uses an unsupported operation kind.",
        path: ["kind"],
      });
      return;
    }

    const result = payloadSchema.safeParse(value.payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
      }
    }
  })
  .transform((value) => {
    switch (value.kind) {
      case "commitSketch":
        return {
          kind: value.kind,
          payload: persistedCommitSketchPayloadSchema.parse(value.payload),
        };
      case "createFeature":
        return {
          kind: value.kind,
          payload: persistedCreateFeaturePayloadSchema.parse(value.payload),
        };
      case "updateFeature":
        return {
          kind: value.kind,
          payload: persistedUpdateFeaturePayloadSchema.parse(value.payload),
        };
      case "setFeatureSuppression":
        return {
          kind: value.kind,
          payload: persistedSetFeatureSuppressionPayloadSchema.parse(
            value.payload,
          ),
        };
      case "deleteFeature":
        return {
          kind: value.kind,
          payload: persistedDeleteFeaturePayloadSchema.parse(value.payload),
        };
      case "deleteTarget":
        return {
          kind: value.kind,
          payload: persistedDeleteTargetPayloadSchema.parse(value.payload),
        };
      case "renameBody":
        return {
          kind: value.kind,
          payload: persistedRenameBodyPayloadSchema.parse(value.payload),
        };
      case "reorderFeature":
        return {
          kind: value.kind,
          payload: persistedReorderFeaturePayloadSchema.parse(value.payload),
        };
      case "reorderDocumentHistory":
        return {
          kind: value.kind,
          payload: persistedReorderDocumentHistoryPayloadSchema.parse(
            value.payload,
          ),
        };
      case "setFeatureCursor":
        return {
          kind: value.kind,
          payload: persistedSetFeatureCursorPayloadSchema.parse(value.payload),
        };
      case "addDocumentVariable":
        return {
          kind: value.kind,
          payload: persistedAddDocumentVariablePayloadSchema.parse(
            value.payload,
          ),
        };
      case "updateDocumentVariable":
        return {
          kind: value.kind,
          payload: persistedUpdateDocumentVariablePayloadSchema.parse(
            value.payload,
          ),
        };
    }
  }) as z.ZodType<ModelingOperationHistoryEntry>;

export const operationHistoryPayloadSchema = z
  .object({
    contractVersion: contractVersionSchema,
    schemaVersion: operationHistorySchemaVersionSchema,
    documentId: documentIdSchema,
    baseRepositoryHeads: z.array(z.string()).optional(),
    entries: z.array(operationHistoryEntrySchema),
  })
  .transform((value) => value as ModelingOperationHistoryPayload);

function mapIssueToValidationFailure(
  issue: ZodIssue,
): Exclude<OperationHistoryValidationResult, { ok: true }> {
  const path = issue.path.map((segment) => String(segment)).join(".");

  if (issue.message.startsWith("Unsupported contract version")) {
    return {
      ok: false,
      reasonCode: "unsupported-contract-version",
      message: "Operation history contract version is not supported.",
    };
  }

  if (
    issue.message.startsWith("Unsupported operation history schema version")
  ) {
    return {
      ok: false,
      reasonCode: "unsupported-schema-version",
      message: "Operation history schema version is not supported.",
    };
  }

  if (path === "documentId") {
    return {
      ok: false,
      reasonCode: "invalid-document-id",
      message: "Operation history document identity is invalid.",
    };
  }

  if (path === "entries") {
    return {
      ok: false,
      reasonCode: "invalid-entries",
      message: "Operation history entries must be an ordered array.",
    };
  }

  const entryIndex = typeof issue.path[1] === "number" ? issue.path[1] : 0;

  if (
    issue.message === "Entry payload contains transport-only request metadata."
  ) {
    return {
      ok: false,
      reasonCode: "transport-field-leak",
      message: `Operation history entry ${entryIndex} contains transport-only request metadata.`,
    };
  }

  if (issue.message.includes("parameters.profile")) {
    return {
      ok: false,
      reasonCode: "legacy-profile-parameter",
      message: `Operation history entry ${entryIndex} uses legacy ${issue.message.startsWith("extrude") ? "extrude" : "revolve"} parameters.profile instead of profiles.`,
    };
  }

  if (issue.message.includes("duplicate profile references")) {
    return {
      ok: false,
      reasonCode: "duplicate-profile-reference",
      message: `Operation history entry ${entryIndex} contains duplicate ${issue.message.startsWith("extrude") ? "extrude" : "revolve"} profile references.`,
    };
  }

  if (issue.message.includes("profiles must be non-empty")) {
    return {
      ok: false,
      reasonCode: "invalid-profile-collection",
      message: `Operation history entry ${entryIndex} must include a non-empty ${issue.message.startsWith("extrude") ? "extrude" : "revolve"} profiles collection.`,
    };
  }

  if (
    issue.message.includes("inconsistent point sketch IDs") ||
    issue.message.includes("inconsistent entity sketch IDs")
  ) {
    return {
      ok: false,
      reasonCode: "inconsistent-commit-sketch-targets",
      message: `Operation history entry ${entryIndex} has a commitSketch definition with inconsistent ${issue.message.includes("point") ? "point" : "entity"} sketch IDs.`,
    };
  }

  if (path.includes("participants")) {
    return {
      ok: false,
      reasonCode: "invalid-advanced-participant",
      message: `Operation history entry ${entryIndex} has an invalid advanced participant.`,
    };
  }

  if (path.includes("operationIntent")) {
    return {
      ok: false,
      reasonCode: "invalid-advanced-operation-intent",
      message: `Operation history entry ${entryIndex} has an invalid advanced operation intent.`,
    };
  }

  if (issue.message === "Advanced feature has an invalid participant.") {
    return {
      ok: false,
      reasonCode: "invalid-advanced-participant",
      message: `Operation history entry ${entryIndex} has an invalid advanced participant.`,
    };
  }

  if (issue.message === "Advanced feature has an invalid operation intent.") {
    return {
      ok: false,
      reasonCode: "invalid-advanced-operation-intent",
      message: `Operation history entry ${entryIndex} has an invalid advanced operation intent.`,
    };
  }

  if (
    String(issue.path[2] ?? "") === "definition" &&
    String(issue.path[0] ?? "") === "payload"
  ) {
    return {
      ok: false,
      reasonCode: "invalid-create-feature-entry",
      message: `Operation history entry ${entryIndex} has an invalid createFeature payload.`,
    };
  }

  return {
    ok: false,
    reasonCode: "invalid-entry-shape",
    message: `Operation history entry ${entryIndex} is not a typed operation entry.`,
  };
}

export function parseOperationHistoryPayload(
  value: unknown,
): OperationHistoryValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      reasonCode: "invalid-payload-shape",
      message: "Operation history payload must be an object.",
    };
  }

  const result = operationHistoryPayloadSchema.safeParse(value);
  if (result.success) {
    return {
      ok: true,
      payload: result.data,
    };
  }

  return mapIssueToValidationFailure(result.error.issues[0]!);
}
