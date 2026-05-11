import type {
  BodyId,
  FeatureId,
  FeatureTreeNodeId,
  ObjectTreeNodeId,
  PickId,
  PrimitiveRef,
  RenderableId,
  SnapshotEntityId,
} from "@/core/editor/schema";
import type {
  BodySnapshotRecord,
  ConstructionSnapshotRecord,
  DocumentVariableRecord,
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  ExtrudeFeatureParameters,
  FeatureDefinition,
  FeatureSnapshotRecord,
  FilletFeatureParameters,
  InvalidReferenceDetailPayload,
  ModelingDiagnostic,
  ModelingDiagnosticDetail,
  MutationRevisionState,
  ObjectTreeNodeRecord,
  KernelDocumentSnapshot,
  PreviewId,
  PreviewFreshness,
  RebuildResult,
  ReferenceRecord,
  SketchSnapshotRecord,
  SnapshotEntityRecord,
  WorkspaceSnapshot,
  PlaneFeatureParameters,
  RevolveEndCondition,
  RevolveFeatureParameters,
  ShellFeatureParameters,
  AdvancedSolidFeatureParameters,
} from "@/contracts/modeling/schema";
import type { GeometryAssetDiagnosticDetail } from "@/contracts/modeling/geometry-assets";
import type {
  RenderExport,
  RenderableEntityRecord,
} from "@/contracts/render/schema";
import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  isAdvancedParticipantRole,
  isAdvancedSolidFeatureKind,
} from "@/contracts/modeling/advanced-solid";
import {
  kernelDocumentSnapshotSchema,
  workspaceSnapshotSchema,
} from "@/contracts/modeling/runtime-schema";
import {
  getAuthoredLiteralValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type {
  ConstraintStatusRecord,
  ConstraintDefinition,
  DimensionStatusRecord,
  DimensionDefinition,
  ProjectedSketchGeometryConstraintOperand,
  ReadOnlySketchCurveConstraintOperand,
  ReadOnlySketchPointConstraintOperand,
  RegionRecord,
  SketchPoint2D,
  SketchReferenceDefinition,
  SketchSolveDiagnostic,
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
  SketchRecord,
  SketchStyleDefinition,
  SketchStyleRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
import type { DurableRef } from "@/contracts/shared/references";
import type { RegionId } from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  normalizeConstraintDefinitionCore,
  normalizeDimensionDefinitionCore,
} from "./sketch-definition-normalization";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import {
  isRecord,
  isString,
  isAuthoredNumberLike,
  isAuthoredEnumLike,
  assertBodyId,
  assertDocumentId,
  assertDocumentVariableId,
  assertRevisionId,
  assertFeatureId,
  assertSketchId,
  assertSketchPointId,
  assertSketchEntityId,
  assertConstraintId,
  assertDimensionId,
  assertRegionId,
  assertPrimitiveRef,
  assertDurableRef,
  assertSketchPlaneSupportRef,
  assertExtrudeProfileRefs,
  assertFilletEdgeRef,
  assertShellFaceRef,
  assertRevolveAxisRef,
  assertUpToTargetForKind,
  normalizeUpToOffset,
} from "./validation";

export function normalizeSketchPlaneKey(
  value: unknown,
): SketchPlaneDefinition["key"] {
  if (value === null) {
    return null;
  }

  if (value === "xy" || value === "yz" || value === "xz") {
    return value;
  }

  throw new Error("Invalid sketch plane key payload.");
}

export function normalizeSketchPlaneDefinition(
  value: unknown,
): SketchPlaneDefinition {
  if (!isRecord(value) || !isRecord(value.frame)) {
    throw new Error("Invalid sketch plane payload.");
  }

  return {
    support: assertSketchPlaneSupportRef(value.support),
    frame: {
      origin: normalizePoint3(value.frame.origin),
      xAxis: normalizePoint3(value.frame.xAxis),
      yAxis: normalizePoint3(value.frame.yAxis),
      normal: normalizePoint3(value.frame.normal),
      linearUnit:
        value.frame.linearUnit === "documentLength"
          ? value.frame.linearUnit
          : (() => {
              throw new Error("Invalid sketch plane linear unit payload.");
            })(),
      handedness:
        value.frame.handedness === "rightHanded"
          ? value.frame.handedness
          : (() => {
              throw new Error("Invalid sketch plane handedness payload.");
            })(),
    },
    key: normalizeSketchPlaneKey(value.key),
  };
}

export function normalizePoint3(
  value: unknown,
): readonly [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => typeof entry !== "number")
  ) {
    throw new Error("Invalid 3D point payload.");
  }

  return [value[0], value[1], value[2]];
}

export function normalizeExtrudeEnd(value: unknown): ExtrudeEndCondition {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Invalid extrude end condition payload.");
  }

  const direction = value.direction;
  if (direction !== "positive" && direction !== "negative") {
    throw new Error("Invalid extrude end condition direction payload.");
  }

  const draftAngle = value.draftAngle;
  if (draftAngle !== undefined && !isAuthoredNumberLike(draftAngle)) {
    throw new Error("Invalid extrude draft angle payload.");
  }

  switch (value.kind) {
    case "blind": {
      if (!isAuthoredNumberLike(value.distance)) {
        throw new Error("Invalid extrude blind distance payload.");
      }
      const literalDistance = getAuthoredLiteralValue(
        value.distance as MaybeAuthoredValue<number>,
      );
      if (literalDistance !== null && literalDistance <= 0) {
        throw new Error("Extrude depth must be positive.");
      }
      return {
        kind: "blind",
        direction,
        distance: value.distance as MaybeAuthoredValue<number>,
        ...(draftAngle !== undefined
          ? { draftAngle: draftAngle as MaybeAuthoredValue<number> }
          : {}),
      };
    }
    case "throughAll":
      return {
        kind: "throughAll",
        direction,
        ...(draftAngle !== undefined
          ? { draftAngle: draftAngle as MaybeAuthoredValue<number> }
          : {}),
      };
    case "upToNext": {
      const offset = normalizeUpToOffset(value.offset, "distance");
      const linearOffset = (
        offset && "distance" in offset ? offset : undefined
      ) as Extract<ExtrudeEndCondition, { kind: "upToNext" }>["offset"];
      return {
        kind: "upToNext",
        direction,
        ...(linearOffset ? { offset: linearOffset } : {}),
        ...(draftAngle !== undefined
          ? { draftAngle: draftAngle as MaybeAuthoredValue<number> }
          : {}),
      };
    }
    case "upToFace":
    case "upToPart":
    case "upToVertex": {
      const offset = normalizeUpToOffset(value.offset, "distance");
      return {
        kind: value.kind,
        direction,
        target: assertUpToTargetForKind(value.kind, value.target),
        ...(offset && "distance" in offset ? { offset } : {}),
        ...(draftAngle !== undefined
          ? { draftAngle: draftAngle as MaybeAuthoredValue<number> }
          : {}),
      } as ExtrudeEndCondition;
    }
    default:
      throw new Error("Invalid extrude end condition payload.");
  }
}

export function normalizeExtrudeExtent(value: unknown): ExtrudeFeatureExtent {
  if (!isRecord(value)) {
    throw new Error("Invalid extrude extent payload.");
  }

  if (value.mode === "oneSide") {
    return { mode: "oneSide", end: normalizeExtrudeEnd(value.end) };
  }

  if (value.mode === "symmetric") {
    const end = normalizeExtrudeEnd(value.end);
    if (end.kind !== "blind" && end.kind !== "throughAll") {
      throw new Error(
        "Symmetric extrude extents only support blind or throughAll end conditions.",
      );
    }
    return { mode: "symmetric", end };
  }

  if (value.mode === "twoSide") {
    return {
      mode: "twoSide",
      firstEnd: normalizeExtrudeEnd(value.firstEnd),
      secondEnd: normalizeExtrudeEnd(value.secondEnd),
    };
  }

  throw new Error("Invalid extrude extent mode payload.");
}

export function normalizeExtrudeFeatureParameters(
  value: unknown,
): ExtrudeFeatureParameters {
  if (!isRecord(value)) {
    throw new Error("Invalid extrude feature parameters payload.");
  }

  if ("profile" in value || "depth" in value || "direction" in value) {
    throw new Error(
      "Legacy extrude profile, depth, and direction aliases are not supported; use profiles and extent.",
    );
  }

  if (
    !isAuthoredEnumLike(value.operation, [
      "newBody",
      "join",
      "cut",
      "intersect",
    ])
  ) {
    throw new Error("Invalid extrude operation payload.");
  }

  const extent = normalizeExtrudeExtent(value.extent);

  return {
    profiles: assertExtrudeProfileRefs(value.profiles, "Extrude"),
    startExtent: { kind: "profilePlane" },
    extent,
    operation: value.operation as ExtrudeFeatureParameters["operation"],
    booleanScope:
      isRecord(value.booleanScope) &&
      value.booleanScope.kind === "targetBody" &&
      isString(value.booleanScope.bodyId)
        ? { kind: "targetBody", bodyId: value.booleanScope.bodyId as BodyId }
        : isRecord(value.booleanScope) &&
            value.booleanScope.kind === "targetBodies" &&
            Array.isArray(value.booleanScope.bodyIds)
          ? {
              kind: "targetBodies",
              bodyIds: value.booleanScope.bodyIds.map((bodyId) =>
                assertBodyId(bodyId),
              ),
            }
          : { kind: "standalone" },
  };
}

export function normalizeFilletFeatureParameters(
  value: unknown,
): FilletFeatureParameters {
  if (
    !isRecord(value) ||
    typeof value.radius !== "number" ||
    !Array.isArray(value.edgeTargets)
  ) {
    throw new Error("Invalid fillet feature parameters payload.");
  }

  if (value.radius <= 0) {
    throw new Error("Fillet radius must be positive.");
  }

  if (value.edgeTargets.length === 0) {
    throw new Error(
      "Fillet requests must include at least one durable edge target.",
    );
  }

  return {
    edgeTargets: value.edgeTargets.map((target) => assertFilletEdgeRef(target)),
    radius: value.radius,
  };
}

export function normalizePlaneFeatureParameters(
  value: unknown,
): PlaneFeatureParameters {
  if (
    !isRecord(value) ||
    value.mode !== "coplanar" ||
    !isRecord(value.reference)
  ) {
    throw new Error("Invalid plane feature parameters payload.");
  }

  const target = assertPrimitiveRef(value.reference.target);

  if (target.kind !== "construction" && target.kind !== "face") {
    throw new Error(
      "Plane coplanar references must target a construction plane or planar face.",
    );
  }

  return {
    mode: "coplanar",
    reference: {
      target,
    },
  };
}

export function normalizeRevolveEnd(value: unknown): RevolveEndCondition {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Invalid revolve end condition payload.");
  }

  if (value.kind === "full") {
    return { kind: "full" };
  }

  const direction = value.direction;
  if (direction !== "clockwise" && direction !== "counterClockwise") {
    throw new Error("Invalid revolve end direction payload.");
  }

  switch (value.kind) {
    case "blind": {
      if (!isAuthoredNumberLike(value.angle)) {
        throw new Error("Invalid revolve blind angle payload.");
      }
      const literalAngle = getAuthoredLiteralValue(
        value.angle as MaybeAuthoredValue<number>,
      );
      if (literalAngle !== null && literalAngle <= 0) {
        throw new Error("Revolve angle must be positive.");
      }
      return {
        kind: "blind",
        direction,
        angle: value.angle as Extract<
          RevolveEndCondition,
          { kind: "blind" }
        >["angle"],
      };
    }
    case "upToNext": {
      const offset = normalizeUpToOffset(value.offset, "angle");
      const angularOffset = (
        offset && "angle" in offset ? offset : undefined
      ) as Extract<RevolveEndCondition, { kind: "upToNext" }>["offset"];
      return {
        kind: "upToNext",
        direction,
        ...(angularOffset ? { offset: angularOffset } : {}),
      };
    }
    case "upToFace":
    case "upToPart":
    case "upToVertex": {
      const offset = normalizeUpToOffset(value.offset, "angle");
      return {
        kind: value.kind,
        direction,
        target: assertUpToTargetForKind(value.kind, value.target),
        ...(offset && "angle" in offset ? { offset } : {}),
      } as RevolveEndCondition;
    }
    default:
      throw new Error("Invalid revolve end condition payload.");
  }
}

export function normalizeRevolveExtent(
  value: unknown,
): RevolveFeatureParameters["extent"] {
  if (!isRecord(value)) {
    throw new Error("Invalid revolve extent payload.");
  }

  if (value.mode === "oneSide") {
    return { mode: "oneSide", end: normalizeRevolveEnd(value.end) };
  }

  if (value.mode === "symmetric") {
    const end = normalizeRevolveEnd(value.end);
    if (end.kind !== "blind") {
      throw new Error(
        "Symmetric revolve extents only support blind angular end conditions.",
      );
    }
    return { mode: "symmetric", end };
  }

  if (value.mode === "twoSide") {
    const firstEnd = normalizeRevolveEnd(value.firstEnd);
    const secondEnd = normalizeRevolveEnd(value.secondEnd);
    if (firstEnd.kind === "full" || secondEnd.kind === "full") {
      throw new Error(
        "Two-side revolve extents cannot use full end conditions.",
      );
    }
    return { mode: "twoSide", firstEnd, secondEnd };
  }

  throw new Error("Invalid revolve extent mode payload.");
}

export function normalizeRevolveFeatureParameters(
  value: unknown,
): RevolveFeatureParameters {
  if (!isRecord(value)) {
    throw new Error("Invalid revolve feature parameters payload.");
  }

  if ("profile" in value) {
    throw new Error(
      "Legacy revolve profile alias is not supported; use profiles.",
    );
  }

  if (
    !isAuthoredEnumLike(value.operation, [
      "newBody",
      "join",
      "cut",
      "intersect",
    ])
  ) {
    throw new Error("Invalid revolve operation payload.");
  }

  const extent = normalizeRevolveExtent(value.extent);

  return {
    profiles: assertExtrudeProfileRefs(value.profiles, "Revolve"),
    axis: assertRevolveAxisRef(value.axis),
    startAngle: isAuthoredNumberLike(value.startAngle)
      ? (value.startAngle as RevolveFeatureParameters["startAngle"])
      : 0,
    extent,
    operation: value.operation as RevolveFeatureParameters["operation"],
    booleanScope:
      isRecord(value.booleanScope) &&
      value.booleanScope.kind === "targetBody" &&
      isString(value.booleanScope.bodyId)
        ? { kind: "targetBody", bodyId: value.booleanScope.bodyId as BodyId }
        : isRecord(value.booleanScope) &&
            value.booleanScope.kind === "targetBodies" &&
            Array.isArray(value.booleanScope.bodyIds)
          ? {
              kind: "targetBodies",
              bodyIds: value.booleanScope.bodyIds.map((bodyId) =>
                assertBodyId(bodyId),
              ),
            }
          : { kind: "standalone" },
  };
}

export function normalizeShellFeatureParameters(
  value: unknown,
): ShellFeatureParameters {
  if (
    !isRecord(value) ||
    typeof value.thickness !== "number" ||
    !Array.isArray(value.faceTargets)
  ) {
    throw new Error("Invalid shell feature parameters payload.");
  }

  if (value.thickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  const bodyTarget = assertPrimitiveRef(value.bodyTarget);

  if (bodyTarget.kind !== "body") {
    throw new Error("Shell bodyTarget must resolve to one durable body.");
  }

  if (
    value.operation !== "newBody" &&
    value.operation !== "join" &&
    value.operation !== "cut" &&
    value.operation !== "intersect"
  ) {
    throw new Error("Invalid shell operation payload.");
  }

  if (value.faceTargets.length === 0) {
    throw new Error(
      "Shell requests must include at least one removable face target.",
    );
  }

  return {
    bodyTarget,
    faceTargets: value.faceTargets.map((target) => assertShellFaceRef(target)),
    thickness: value.thickness,
    operation: value.operation,
    booleanScope:
      isRecord(value.booleanScope) &&
      value.booleanScope.kind === "targetBody" &&
      isString(value.booleanScope.bodyId)
        ? { kind: "targetBody", bodyId: value.booleanScope.bodyId as BodyId }
        : isRecord(value.booleanScope) &&
            value.booleanScope.kind === "targetBodies" &&
            Array.isArray(value.booleanScope.bodyIds)
          ? {
              kind: "targetBodies",
              bodyIds: value.booleanScope.bodyIds.map((bodyId) =>
                assertBodyId(bodyId),
              ),
            }
          : { kind: "standalone" },
  };
}

export function normalizeAdvancedSolidFeatureParameters(
  value: unknown,
): AdvancedSolidFeatureParameters {
  if (!isRecord(value) || !Array.isArray(value.participants)) {
    throw new Error("Invalid advanced solid feature parameters payload.");
  }

  const operationIntent = value.operationIntent;
  if (
    operationIntent !== undefined &&
    operationIntent !== "create" &&
    operationIntent !== "add" &&
    operationIntent !== "subtract" &&
    operationIntent !== "intersect"
  ) {
    throw new Error("Invalid advanced solid operation intent payload.");
  }

  return {
    participants: value.participants.map((participant) => {
      if (
        !isRecord(participant) ||
        !isAdvancedParticipantRole(participant.role) ||
        !Array.isArray(participant.targets)
      ) {
        throw new Error("Invalid advanced solid participant payload.");
      }

      return {
        role: participant.role,
        targets: participant.targets.map((target) => assertDurableRef(target)),
      };
    }),
    ...(operationIntent ? { operationIntent } : {}),
    ...(isRecord(value.options) ? { options: { ...value.options } } : {}),
  };
}

export function normalizeFeatureDefinition(value: unknown): FeatureDefinition {
  if (
    !isRecord(value) ||
    !isString(value.kind) ||
    !isString(value.featureTypeVersion)
  ) {
    throw new Error("Invalid feature definition payload.");
  }

  switch (value.kind) {
    case "extrude":
      return {
        kind: "extrude",
        featureTypeVersion:
          value.featureTypeVersion === EXTRUDE_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: normalizeExtrudeFeatureParameters(value.parameters),
      };
    case "fillet":
      return {
        kind: "fillet",
        featureTypeVersion:
          value.featureTypeVersion === FILLET_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : FILLET_FEATURE_SCHEMA_VERSION,
        parameters: normalizeFilletFeatureParameters(value.parameters),
      };
    case "plane":
      return {
        kind: "plane",
        featureTypeVersion:
          value.featureTypeVersion === PLANE_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : PLANE_FEATURE_SCHEMA_VERSION,
        parameters: normalizePlaneFeatureParameters(value.parameters),
      };
    case "revolve":
      return {
        kind: "revolve",
        featureTypeVersion:
          value.featureTypeVersion === REVOLVE_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : REVOLVE_FEATURE_SCHEMA_VERSION,
        parameters: normalizeRevolveFeatureParameters(value.parameters),
      };
    case "shell":
      return {
        kind: "shell",
        featureTypeVersion:
          value.featureTypeVersion === SHELL_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : SHELL_FEATURE_SCHEMA_VERSION,
        parameters: normalizeShellFeatureParameters(value.parameters),
      };
    default:
      if (isAdvancedSolidFeatureKind(value.kind)) {
        return {
          kind: value.kind,
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: normalizeAdvancedSolidFeatureParameters(value.parameters),
        };
      }
      throw new Error("Invalid feature definition kind.");
  }
}

export function normalizeDiagnostics(value: unknown): ModelingDiagnostic[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid diagnostics payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.code) ||
      !isString(entry.message) ||
      (entry.severity !== "info" &&
        entry.severity !== "warning" &&
        entry.severity !== "error")
    ) {
      throw new Error("Invalid diagnostic record.");
    }

    return {
      code: entry.code,
      severity: entry.severity,
      message: entry.message,
      featureId:
        entry.featureId == null ? null : assertFeatureId(entry.featureId),
      fieldId: entry.fieldId == null ? null : String(entry.fieldId),
      fieldPath: Array.isArray(entry.fieldPath)
        ? entry.fieldPath.map((segment) =>
            typeof segment === "number" ? segment : String(segment),
          )
        : undefined,
      repairGuidance:
        entry.repairGuidance == null ? null : String(entry.repairGuidance),
      target: entry.target == null ? null : assertDurableRef(entry.target),
      detail:
        entry.detail == null ? null : normalizeDiagnosticDetail(entry.detail),
    };
  });
}

export function normalizeModelingDocumentSettings(
  value: unknown,
): KernelDocumentSnapshot["settings"] {
  if (
    !isRecord(value) ||
    value.linearUnit !== "millimeter" ||
    typeof value.modelingTolerance !== "number" ||
    typeof value.angularToleranceRadians !== "number"
  ) {
    throw new Error("Invalid modeling document settings payload.");
  }

  return {
    linearUnit: "millimeter",
    modelingTolerance: value.modelingTolerance,
    angularToleranceRadians: value.angularToleranceRadians,
  };
}

export function normalizeModelingKernelCapabilities(
  value: unknown,
): KernelDocumentSnapshot["capabilities"] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.supportedFeatureKinds) ||
    !Array.isArray(value.previewableFeatureKinds) ||
    !Array.isArray(value.supportedProfileKinds) ||
    typeof value.supportsFaceBackedSketchPlanes !== "boolean" ||
    typeof value.supportsDurableTopologyNaming !== "boolean"
  ) {
    throw new Error("Invalid modeling kernel capability payload.");
  }

  return {
    supportedFeatureKinds:
      value.supportedFeatureKinds as KernelDocumentSnapshot["capabilities"]["supportedFeatureKinds"],
    previewableFeatureKinds:
      value.previewableFeatureKinds as KernelDocumentSnapshot["capabilities"]["previewableFeatureKinds"],
    supportedProfileKinds:
      value.supportedProfileKinds as KernelDocumentSnapshot["capabilities"]["supportedProfileKinds"],
    supportsFaceBackedSketchPlanes: value.supportsFaceBackedSketchPlanes,
    supportsDurableTopologyNaming: value.supportsDurableTopologyNaming,
  };
}

export function normalizeInvalidReferenceDetail(
  value: unknown,
): InvalidReferenceDetailPayload {
  if (!isRecord(value) || !isString(value.reason)) {
    throw new Error("Invalid invalid reference detail payload.");
  }

  return {
    reason: value.reason,
    target: assertDurableRef(value.target),
    ownerFeatureId:
      value.ownerFeatureId === null
        ? null
        : assertFeatureId(value.ownerFeatureId),
    ownerSketchId:
      value.ownerSketchId === null ? null : assertSketchId(value.ownerSketchId),
    sourceTarget:
      value.sourceTarget === null ? null : assertDurableRef(value.sourceTarget),
  };
}

export function normalizeDiagnosticDetail(
  value: unknown,
): ModelingDiagnosticDetail {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error("Invalid diagnostic detail payload.");
  }

  switch (value.kind) {
    case "invalidReference":
      return {
        kind: "invalidReference",
        reference: normalizeInvalidReferenceDetail(value.reference),
      };
    case "revisionConflict":
      return {
        kind: "revisionConflict",
        expectedRevisionId: assertRevisionId(value.expectedRevisionId),
        actualRevisionId: assertRevisionId(value.actualRevisionId),
      };
    case "stalePreview":
      return {
        kind: "stalePreview",
        previewId: value.previewId as PreviewId,
        requestedRevisionId: assertRevisionId(value.requestedRevisionId),
        currentRevisionId: assertRevisionId(value.currentRevisionId),
      };
    case "rebuildFailure":
      if (
        !Array.isArray(value.affectedFeatureIds) ||
        !Array.isArray(value.affectedTargets)
      ) {
        throw new Error("Invalid rebuild failure detail payload.");
      }

      return {
        kind: "rebuildFailure",
        affectedFeatureIds: value.affectedFeatureIds.map((featureId) =>
          assertFeatureId(featureId),
        ),
        affectedTargets: value.affectedTargets.map((target) =>
          assertDurableRef(target),
        ),
      };
    case "geometryAsset":
      if (
        !isString(value.code) ||
        !isString(value.assetId) ||
        !isString(value.hash) ||
        !isString(value.hashPrefix) ||
        typeof value.byteLength !== "number" ||
        !isString(value.format) ||
        !isString(value.mediaType) ||
        !Array.isArray(value.ownerFeatureIds)
      ) {
        throw new Error("Invalid geometry asset diagnostic detail payload.");
      }

      return {
        kind: "geometryAsset",
        code: value.code as GeometryAssetDiagnosticDetail["code"],
        assetId: value.assetId as GeometryAssetDiagnosticDetail["assetId"],
        hash: value.hash as GeometryAssetDiagnosticDetail["hash"],
        hashPrefix: value.hashPrefix,
        byteLength: value.byteLength,
        format: value.format as GeometryAssetDiagnosticDetail["format"],
        mediaType: value.mediaType,
        ownerFeatureIds: value.ownerFeatureIds.map((featureId) =>
          assertFeatureId(featureId),
        ),
      };
    default:
      throw new Error("Invalid diagnostic detail kind.");
  }
}

export function normalizeRevisionState(value: unknown): MutationRevisionState {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error("Invalid revision state payload.");
  }

  switch (value.kind) {
    case "accepted":
      return {
        kind: "accepted",
        baseRevisionId: assertRevisionId(value.baseRevisionId),
      };
    case "conflict":
      return {
        kind: "conflict",
        expectedRevisionId: assertRevisionId(value.expectedRevisionId),
        actualRevisionId: assertRevisionId(value.actualRevisionId),
      };
    case "rejected":
      if (!isString(value.reasonCode)) {
        throw new Error("Invalid rejected revision state payload.");
      }

      return {
        kind: "rejected",
        baseRevisionId: assertRevisionId(value.baseRevisionId),
        reasonCode: value.reasonCode,
      };
    default:
      throw new Error("Invalid revision state kind.");
  }
}

export function normalizePreviewFreshness(value: unknown): PreviewFreshness {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error("Invalid preview freshness payload.");
  }

  switch (value.kind) {
    case "fresh":
      return {
        kind: "fresh",
        baseRevisionId: assertRevisionId(value.baseRevisionId),
      };
    case "stale":
      return {
        kind: "stale",
        requestedRevisionId: assertRevisionId(value.requestedRevisionId),
        currentRevisionId: assertRevisionId(value.currentRevisionId),
      };
    default:
      throw new Error("Invalid preview freshness kind.");
  }
}

export function normalizeRebuildResult(value: unknown): RebuildResult {
  if (
    !isRecord(value) ||
    !isString(value.kind) ||
    !Array.isArray(value.diagnostics)
  ) {
    throw new Error("Invalid rebuild result payload.");
  }

  switch (value.kind) {
    case "rebuilt":
      if (
        !isString(value.revisionId) ||
        !Array.isArray(value.invalidatedTargets)
      ) {
        throw new Error("Invalid rebuilt result payload.");
      }

      return {
        kind: "rebuilt",
        revisionId: assertRevisionId(value.revisionId),
        invalidatedTargets: normalizeChangedTargets(value.invalidatedTargets),
        diagnostics: normalizeDiagnostics(value.diagnostics),
      };
    case "skipped":
      if (
        value.reasonCode !== "revisionConflict" &&
        value.reasonCode !== "validationRejected" &&
        value.reasonCode !== "noOp"
      ) {
        throw new Error("Invalid skipped rebuild result payload.");
      }

      return {
        kind: "skipped",
        reasonCode: value.reasonCode,
        invalidatedTargets: [],
        diagnostics: normalizeDiagnostics(value.diagnostics),
      };
    case "failed":
      if (
        !isString(value.revisionId) ||
        !isString(value.reasonCode) ||
        !Array.isArray(value.invalidatedTargets)
      ) {
        throw new Error("Invalid failed rebuild result payload.");
      }

      return {
        kind: "failed",
        revisionId: assertRevisionId(value.revisionId),
        reasonCode: value.reasonCode,
        invalidatedTargets: normalizeChangedTargets(value.invalidatedTargets),
        diagnostics: normalizeDiagnostics(value.diagnostics),
      };
    default:
      throw new Error("Unsupported rebuild result payload.");
  }
}

export function normalizeFeatureTree(
  value: unknown,
): WorkspaceSnapshot["presentation"]["featureTree"] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid feature tree payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isString(entry.description) ||
      (entry.kind !== "plane" &&
        entry.kind !== "sketch" &&
        entry.kind !== "feature")
    ) {
      throw new Error("Invalid feature tree record.");
    }

    return {
      id: entry.id as FeatureTreeNodeId,
      label: entry.label,
      description: entry.description,
      kind: entry.kind,
      target: assertDurableRef(entry.target),
      ownerFeatureId:
        entry.ownerFeatureId === null
          ? null
          : assertFeatureId(entry.ownerFeatureId),
      ownerSketchId:
        entry.ownerSketchId === null
          ? null
          : assertSketchId(entry.ownerSketchId),
      sourceFeatureId:
        entry.sourceFeatureId === null
          ? null
          : assertFeatureId(entry.sourceFeatureId),
    };
  });
}

export function normalizeDocumentPresentation(
  value: unknown,
): WorkspaceSnapshot["presentation"] {
  if (!isRecord(value)) {
    throw new Error("Invalid document presentation payload.");
  }

  return {
    featureTree: normalizeFeatureTree(value.featureTree),
    objects: normalizeObjects(value.objects),
    documentHistory: normalizeDocumentHistory(value.documentHistory),
    entities: normalizeEntities(value.entities),
  };
}

export function normalizeObjects(value: unknown): ObjectTreeNodeRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid object tree payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isString(entry.description) ||
      (entry.kind !== "body" &&
        entry.kind !== "construction" &&
        entry.kind !== "sketch")
    ) {
      throw new Error("Invalid object tree record.");
    }

    return {
      id: entry.id as ObjectTreeNodeId,
      label: entry.label,
      description: entry.description,
      kind: entry.kind,
      target: assertDurableRef(entry.target),
      ownerBodyId:
        entry.ownerBodyId === null ? null : assertBodyId(entry.ownerBodyId),
      ownerFeatureId:
        entry.ownerFeatureId === null
          ? null
          : assertFeatureId(entry.ownerFeatureId),
      ownerSketchId:
        entry.ownerSketchId === null
          ? null
          : assertSketchId(entry.ownerSketchId),
    };
  });
}

export function normalizeDocumentHistory(
  value: unknown,
): DocumentHistoryItemRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid document history payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isString(entry.description) ||
      (entry.kind !== "sketch" && entry.kind !== "feature")
    ) {
      throw new Error("Invalid document history item.");
    }

    if (entry.kind === "sketch") {
      const sketchId = assertSketchId(entry.sketchId);
      return {
        id: entry.id as DocumentHistoryItemRecord["id"],
        label: entry.label,
        description: entry.description,
        kind: "sketch",
        target: { kind: "sketch", sketchId },
        sketchId,
        featureId: null,
      };
    }

    const featureId = assertFeatureId(entry.featureId);
    if (typeof entry.suppressed !== "boolean") {
      throw new Error("Invalid document history feature suppression payload.");
    }

    return {
      id: entry.id as DocumentHistoryItemRecord["id"],
      label: entry.label,
      description: entry.description,
      kind: "feature",
      target: { kind: "feature", featureId },
      sketchId: null,
      featureId,
      suppressed: entry.suppressed,
    };
  });
}

export function normalizeOwnership(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Invalid ownership payload.");
  }

  return {
    ownerDocumentId: assertDocumentId(value.ownerDocumentId),
    ownerRevisionId: assertRevisionId(value.ownerRevisionId),
    ownerFeatureId:
      value.ownerFeatureId === null
        ? null
        : assertFeatureId(value.ownerFeatureId),
    ownerSketchId:
      value.ownerSketchId === null ? null : assertSketchId(value.ownerSketchId),
    ownerBodyId:
      value.ownerBodyId === null ? null : assertBodyId(value.ownerBodyId),
  };
}

export function normalizeReferences(value: unknown): ReferenceRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid reference payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !(entry.ownerFeatureId === null || isString(entry.ownerFeatureId))
    ) {
      throw new Error("Invalid reference record.");
    }

    return {
      id: entry.id as ReferenceRecord["id"],
      label: entry.label,
      target: assertDurableRef(entry.target),
      ownerDocumentId: assertDocumentId(entry.ownerDocumentId),
      ownerRevisionId: assertRevisionId(entry.ownerRevisionId),
      ownerFeatureId: entry.ownerFeatureId as FeatureId | null,
      ownerSketchId:
        entry.ownerSketchId === null
          ? null
          : assertSketchId(entry.ownerSketchId),
      ownerBodyId:
        entry.ownerBodyId === null ? null : assertBodyId(entry.ownerBodyId),
      invalidation:
        entry.invalidation === null
          ? null
          : normalizeInvalidReferenceDetail(entry.invalidation),
    };
  });
}

export function normalizeDocumentVariables(
  value: unknown,
): DocumentVariableRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid document variables payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.variableId) ||
      !isString(entry.name) ||
      !isString(entry.valueText)
    ) {
      throw new Error("Invalid document variable record.");
    }

    return {
      variableId: assertDocumentVariableId(entry.variableId),
      name: entry.name,
      valueText: entry.valueText,
    };
  });
}

export function normalizeRenderables(value: unknown): RenderableEntityRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid renderable payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !isRecord(entry.binding) ||
      !isString(entry.binding.pickId) ||
      typeof entry.binding.pickPriority !== "number" ||
      !(
        entry.binding.topology === null ||
        entry.binding.topology === "face" ||
        entry.binding.topology === "edge" ||
        entry.binding.topology === "vertex"
      ) ||
      (entry.binding.semanticClass !== "bodyFace" &&
        entry.binding.semanticClass !== "planarFace" &&
        entry.binding.semanticClass !== "featureEdge" &&
        entry.binding.semanticClass !== "featureVertex" &&
        entry.binding.semanticClass !== "region" &&
        entry.binding.semanticClass !== "sketchCurve" &&
        entry.binding.semanticClass !== "sketchPoint" &&
        entry.binding.semanticClass !== "construction") ||
      !isRecord(entry.geometry) ||
      !isString(entry.geometry.kind)
    ) {
      throw new Error("Invalid renderable record.");
    }

    const geometry: RenderableEntityRecord["geometry"] = (() => {
      switch (entry.geometry.kind) {
        case "mesh": {
          if (
            !Array.isArray(entry.geometry.vertexPositions) ||
            !Array.isArray(entry.geometry.triangleIndices) ||
            !(
              entry.geometry.vertexNormals === null ||
              Array.isArray(entry.geometry.vertexNormals)
            )
          ) {
            throw new Error("Invalid mesh geometry payload.");
          }

          if (entry.geometry.vertexPositions.length === 0) {
            throw new Error(
              "Mesh geometry must contain at least one vertex position.",
            );
          }

          const vertexPositions = entry.geometry.vertexPositions;
          const vertexNormals = entry.geometry.vertexNormals;
          const triangleIndices = entry.geometry.triangleIndices;

          if (
            vertexNormals !== null &&
            vertexNormals.length !== vertexPositions.length
          ) {
            throw new Error(
              "Mesh vertex normals must align 1:1 with vertex positions.",
            );
          }

          return {
            kind: "mesh" as const,
            vertexPositions: vertexPositions.map((point) => {
              if (
                !Array.isArray(point) ||
                point.length !== 3 ||
                point.some((component) => typeof component !== "number")
              ) {
                throw new Error("Invalid mesh vertex position payload.");
              }

              return point as [number, number, number];
            }),
            vertexNormals:
              vertexNormals === null
                ? null
                : vertexNormals.map((normal) => {
                    if (
                      !Array.isArray(normal) ||
                      normal.length !== 3 ||
                      normal.some((component) => typeof component !== "number")
                    ) {
                      throw new Error("Invalid mesh vertex normal payload.");
                    }

                    return normal as [number, number, number];
                  }),
            triangleIndices: triangleIndices.map((triangle) => {
              if (
                !Array.isArray(triangle) ||
                triangle.length !== 3 ||
                triangle.some(
                  (index) =>
                    typeof index !== "number" || !Number.isInteger(index),
                )
              ) {
                throw new Error("Invalid mesh triangle index payload.");
              }

              if (
                triangle.some(
                  (index) => index < 0 || index >= vertexPositions.length,
                )
              ) {
                throw new Error(
                  "Mesh triangle indices must reference existing vertex positions.",
                );
              }

              return triangle as [number, number, number];
            }),
          };
        }
        case "polyline": {
          if (
            !Array.isArray(entry.geometry.points) ||
            typeof entry.geometry.isClosed !== "boolean"
          ) {
            throw new Error("Invalid polyline geometry payload.");
          }

          if (!entry.geometry.isClosed && entry.geometry.points.length < 2) {
            throw new Error("Open polylines must contain at least 2 points.");
          }

          if (entry.geometry.isClosed && entry.geometry.points.length < 3) {
            throw new Error("Closed polylines must contain at least 3 points.");
          }

          let previousPointKey: string | null = null;
          const distinctPointKeys = new Set<string>();

          return {
            kind: "polyline" as const,
            points: entry.geometry.points.map((point) => {
              if (
                !Array.isArray(point) ||
                point.length !== 3 ||
                point.some((component) => typeof component !== "number")
              ) {
                throw new Error("Invalid polyline point payload.");
              }

              const pointKey = `${point[0]}:${point[1]}:${point[2]}`;

              if (previousPointKey === pointKey) {
                throw new Error(
                  "Polyline points must not contain consecutive duplicates.",
                );
              }

              previousPointKey = pointKey;
              distinctPointKeys.add(pointKey);

              return point as [number, number, number];
            }),
            isClosed: entry.geometry.isClosed,
          };
        }
        case "marker": {
          if (
            !Array.isArray(entry.geometry.position) ||
            entry.geometry.position.length !== 3 ||
            entry.geometry.position.some(
              (component) => typeof component !== "number",
            ) ||
            typeof entry.geometry.displayRadius !== "number"
          ) {
            throw new Error("Invalid marker geometry payload.");
          }

          if (entry.geometry.displayRadius <= 0) {
            throw new Error("Marker display radius must be strictly positive.");
          }

          return {
            kind: "marker" as const,
            position: entry.geometry.position as [number, number, number],
            displayRadius: entry.geometry.displayRadius,
          };
        }
        default:
          throw new Error("Invalid renderable geometry kind.");
      }
    })();

    const target = assertPrimitiveRef(entry.binding.target);
    if (
      geometry.kind === "polyline" &&
      geometry.isClosed &&
      new Set(
        geometry.points.map((point) => `${point[0]}:${point[1]}:${point[2]}`),
      ).size < 3
    ) {
      throw new Error(
        "Closed polylines must contain at least 3 distinct positions.",
      );
    }

    if (entry.binding.topology === "face" && target.kind !== "face") {
      throw new Error("Face bindings must target durable faces.");
    }

    if (entry.binding.topology === "edge" && target.kind !== "edge") {
      throw new Error("Edge bindings must target durable edges.");
    }

    if (entry.binding.topology === "vertex" && target.kind !== "vertex") {
      throw new Error("Vertex bindings must target durable vertices.");
    }

    if (
      entry.binding.topology === null &&
      target.kind !== "construction" &&
      target.kind !== "region" &&
      target.kind !== "sketchEntity" &&
      target.kind !== "sketchPoint"
    ) {
      throw new Error(
        "Non-topological render bindings must target durable construction, region, or sketch refs.",
      );
    }

    if (
      (entry.binding.semanticClass === "bodyFace" ||
        entry.binding.semanticClass === "planarFace") &&
      (entry.binding.topology !== "face" || target.kind !== "face")
    ) {
      throw new Error("Face semantic classes must bind to durable faces.");
    }

    if (
      entry.binding.semanticClass === "featureEdge" &&
      (entry.binding.topology !== "edge" || target.kind !== "edge")
    ) {
      throw new Error("featureEdge bindings must bind to durable edges.");
    }

    if (
      entry.binding.semanticClass === "featureVertex" &&
      (entry.binding.topology !== "vertex" || target.kind !== "vertex")
    ) {
      throw new Error("featureVertex bindings must bind to durable vertices.");
    }

    if (
      entry.binding.semanticClass === "region" &&
      (entry.binding.topology !== null || target.kind !== "region")
    ) {
      throw new Error(
        "region bindings must target durable sketch regions without topology.",
      );
    }

    if (
      entry.binding.semanticClass === "construction" &&
      (entry.binding.topology !== null || target.kind !== "construction")
    ) {
      throw new Error(
        "construction bindings must target durable construction refs without topology.",
      );
    }

    if (
      entry.binding.semanticClass === "sketchCurve" &&
      (entry.binding.topology !== null || target.kind !== "sketchEntity")
    ) {
      throw new Error(
        "sketchCurve bindings must target durable sketch entities without topology.",
      );
    }

    if (
      entry.binding.semanticClass === "sketchPoint" &&
      (entry.binding.topology !== null || target.kind !== "sketchPoint")
    ) {
      throw new Error(
        "sketchPoint bindings must target durable sketch points without topology.",
      );
    }

    const binding: RenderableEntityRecord["binding"] = (() => {
      switch (entry.binding.semanticClass) {
        case "bodyFace":
        case "planarFace":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "face" }>,
            topology: "face",
            semanticClass: entry.binding.semanticClass,
          };
        case "featureEdge":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "edge" }>,
            topology: "edge",
            semanticClass: "featureEdge",
          };
        case "featureVertex":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "vertex" }>,
            topology: "vertex",
            semanticClass: "featureVertex",
          };
        case "construction":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "construction" }>,
            topology: null,
            semanticClass: "construction",
          };
        case "region":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "region" }>,
            topology: null,
            semanticClass: "region",
          };
        case "sketchCurve":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "sketchEntity" }>,
            topology: null,
            semanticClass: "sketchCurve",
          };
        case "sketchPoint":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "sketchPoint" }>,
            topology: null,
            semanticClass: "sketchPoint",
          };
      }
    })();

    return {
      id: entry.id as RenderableId,
      label: entry.label,
      ownerBodyId:
        entry.ownerBodyId === null ? null : assertBodyId(entry.ownerBodyId),
      ownerFeatureId:
        entry.ownerFeatureId === null
          ? null
          : assertFeatureId(entry.ownerFeatureId),
      binding,
      geometry,
    };
  });
}

export function normalizeRenderExport(value: unknown): RenderExport {
  if (!isRecord(value) || value.schemaVersion !== "render-export/v1alpha1") {
    throw new Error("Invalid render export payload.");
  }

  return {
    schemaVersion: value.schemaVersion,
    records: normalizeRenderables(value.records),
  };
}

export function normalizeSketches(value: unknown): SketchSnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid sketch snapshot payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.sketchId) ||
      !isString(entry.label)
    ) {
      throw new Error("Invalid sketch snapshot record.");
    }

    return {
      ...normalizeOwnership(entry),
      sketchId: assertSketchId(entry.sketchId),
      label: entry.label,
      plane: normalizeSketchPlaneDefinition(entry.plane),
      sketch: normalizeSketchRecord(entry.sketch),
    };
  });
}

export function normalizeSketchRecord(value: unknown): SketchRecord {
  if (!isRecord(value) || !isString(value.sketchId) || !isString(value.label)) {
    throw new Error("Invalid sketch record payload.");
  }

  return {
    ...normalizeOwnership(value),
    sketchId: assertSketchId(value.sketchId),
    label: value.label,
    planeSupport: assertSketchPlaneSupportRef(value.planeSupport),
    definition: normalizeSketchDefinition(value.definition),
    solvedSnapshot: normalizeSolvedSketchSnapshot(value.solvedSnapshot),
    projectedReferences: normalizeProjectedSketchReferences(
      value.projectedReferences ?? [],
    ),
    regions: normalizeRegionRecords(value.regions),
  };
}

export function normalizeProjectedSketchReferences(
  value: unknown,
): ProjectedSketchReferenceRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid projected sketch reference payload.");
  }

  return value.map((reference) => {
    if (
      !isRecord(reference) ||
      !isString(reference.referenceId) ||
      !isString(reference.status) ||
      !Array.isArray(reference.geometry) ||
      !Array.isArray(reference.diagnostics)
    ) {
      throw new Error("Invalid projected sketch reference record.");
    }

    return {
      referenceId:
        reference.referenceId as import("@/contracts/shared/ids").ReferenceId,
      status:
        reference.status === "projected" ||
        reference.status === "unsupportedSource" ||
        reference.status === "missingSource" ||
        reference.status === "outOfPlane" ||
        reference.status === "ambiguous"
          ? reference.status
          : (() => {
              throw new Error(
                "Invalid projected sketch reference status payload.",
              );
            })(),
      geometry: reference.geometry.map((geometry) =>
        normalizeProjectedSketchReferenceGeometry(geometry),
      ),
      diagnostics: reference.diagnostics.map((diagnostic) =>
        normalizeSketchSolveDiagnostic(diagnostic),
      ),
    };
  });
}

export function normalizeProjectedSketchReferenceGeometry(
  value: unknown,
): ProjectedSketchReferenceGeometry {
  if (
    !isRecord(value) ||
    !isString(value.geometryId) ||
    !isString(value.kind)
  ) {
    throw new Error("Invalid projected sketch geometry payload.");
  }

  const geometryId =
    value.geometryId as import("@/contracts/shared/ids").ProjectedGeometryId;

  if (value.kind === "point") {
    return {
      geometryId,
      kind: "point",
      position: normalizePoint2D(
        value.position,
        "Invalid projected point payload.",
      ),
    };
  }

  if (value.kind === "lineSegment") {
    return {
      geometryId,
      kind: "lineSegment",
      startPosition: normalizePoint2D(
        value.startPosition,
        "Invalid projected line start payload.",
      ),
      endPosition: normalizePoint2D(
        value.endPosition,
        "Invalid projected line end payload.",
      ),
    };
  }

  if (value.kind === "circle") {
    if (typeof value.radius !== "number") {
      throw new Error("Invalid projected circle radius payload.");
    }
    return {
      geometryId,
      kind: "circle",
      centerPosition: normalizePoint2D(
        value.centerPosition,
        "Invalid projected circle center payload.",
      ),
      radius: value.radius,
    };
  }

  if (value.kind === "arc") {
    if (
      value.sweepDirection !== "clockwise" &&
      value.sweepDirection !== "counterClockwise"
    ) {
      throw new Error("Invalid projected arc sweep payload.");
    }
    return {
      geometryId,
      kind: "arc",
      centerPosition: normalizePoint2D(
        value.centerPosition,
        "Invalid projected arc center payload.",
      ),
      startPosition: normalizePoint2D(
        value.startPosition,
        "Invalid projected arc start payload.",
      ),
      endPosition: normalizePoint2D(
        value.endPosition,
        "Invalid projected arc end payload.",
      ),
      sweepDirection: value.sweepDirection,
    };
  }

  if (value.kind === "spline") {
    if (
      !Array.isArray(value.fitPoints) ||
      (value.degree !== 2 && value.degree !== 3) ||
      typeof value.isClosed !== "boolean"
    ) {
      throw new Error("Invalid projected spline payload.");
    }
    return {
      geometryId,
      kind: "spline",
      fitPoints: value.fitPoints.map((point) =>
        normalizePoint2D(point, "Invalid projected spline point payload."),
      ),
      degree: value.degree,
      isClosed: value.isClosed,
    };
  }

  throw new Error("Invalid projected sketch geometry kind payload.");
}

export function normalizePoint2D(
  value: unknown,
  errorMessage: string,
): SketchPoint2D {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((component) => typeof component !== "number")
  ) {
    throw new Error(errorMessage);
  }

  return value as unknown as SketchPoint2D;
}

export function normalizeSketchDefinition(value: unknown): SketchDefinition {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "sketch-definition/v1alpha1" ||
    !Array.isArray(value.referenceIds) ||
    !Array.isArray(value.references) ||
    !Array.isArray(value.pointIds) ||
    !Array.isArray(value.points) ||
    !Array.isArray(value.entityIds) ||
    !Array.isArray(value.entities) ||
    !Array.isArray(value.constraintIds) ||
    !Array.isArray(value.constraints) ||
    !Array.isArray(value.dimensionIds) ||
    !Array.isArray(value.dimensions)
  ) {
    throw new Error("Invalid sketch definition payload.");
  }

  return {
    schemaVersion: value.schemaVersion,
    referenceIds: value.referenceIds.map((referenceId) => {
      if (!isString(referenceId)) {
        throw new Error("Invalid sketch reference ID payload.");
      }

      return referenceId as import("@/contracts/shared/ids").ReferenceId;
    }),
    references: value.references.map((reference) =>
      normalizeSketchReferenceDefinition(reference),
    ),
    pointIds: value.pointIds.map((pointId) => assertSketchPointId(pointId)),
    points: value.points.map((point) => normalizeSketchPointDefinition(point)),
    entityIds: value.entityIds.map((entityId) =>
      assertSketchEntityId(entityId),
    ),
    entities: value.entities.map((entity) =>
      normalizeSketchEntityDefinition(entity),
    ),
    constraintIds: value.constraintIds.map((constraintId) =>
      assertConstraintId(constraintId),
    ),
    constraints: value.constraints.map((constraint) =>
      normalizeConstraintDefinition(constraint),
    ),
    dimensionIds: value.dimensionIds.map((dimensionId) =>
      assertDimensionId(dimensionId),
    ),
    dimensions: value.dimensions.map((dimension) =>
      normalizeDimensionDefinition(dimension),
    ),
    styleIds: Array.isArray(value.styleIds)
      ? value.styleIds.map((styleId) => {
          if (!isString(styleId)) {
            throw new Error("Invalid sketch style ID payload.");
          }

          return styleId as import("@/contracts/shared/ids").SketchStyleId;
        })
      : [],
    styles: Array.isArray(value.styles)
      ? value.styles.map((style) => normalizeSketchStyleRecord(style))
      : [],
    svgRenderingEnabled:
      typeof value.svgRenderingEnabled === "boolean"
        ? value.svgRenderingEnabled
        : true,
    derivedRelationships: Array.isArray(value.derivedRelationships)
      ? value.derivedRelationships.map((relationship) =>
          normalizeSketchDerivationDefinition(relationship),
        )
      : [],
    authoringOperations: Array.isArray(value.authoringOperations)
      ? (value.authoringOperations as SketchDefinition["authoringOperations"])
      : [],
  };
}

export function normalizeSketchStyleDefinition(
  value: unknown,
): SketchStyleDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("Invalid sketch style definition payload.");
  }

  return {
    ...(value.fillMode === "none" ||
    value.fillMode === "solid" ||
    value.fillMode === "gradient"
      ? { fillMode: value.fillMode }
      : {}),
    ...(isString(value.fillColor) ? { fillColor: value.fillColor } : {}),
    ...(isString(value.gradientStartColor)
      ? { gradientStartColor: value.gradientStartColor }
      : {}),
    ...(isString(value.gradientEndColor)
      ? { gradientEndColor: value.gradientEndColor }
      : {}),
    ...(typeof value.strokeEnabled === "boolean"
      ? { strokeEnabled: value.strokeEnabled }
      : {}),
    ...(isString(value.strokeColor) ? { strokeColor: value.strokeColor } : {}),
    ...(typeof value.strokeWidth === "number"
      ? { strokeWidth: value.strokeWidth }
      : {}),
    ...(value.strokeCap === "butt" ||
    value.strokeCap === "round" ||
    value.strokeCap === "square"
      ? { strokeCap: value.strokeCap }
      : {}),
    ...(value.strokeJoin === "miter" ||
    value.strokeJoin === "round" ||
    value.strokeJoin === "bevel"
      ? { strokeJoin: value.strokeJoin }
      : {}),
    ...(typeof value.strokeMiterLimit === "number"
      ? { strokeMiterLimit: value.strokeMiterLimit }
      : {}),
    ...(typeof value.strokeDashSize === "number"
      ? { strokeDashSize: value.strokeDashSize }
      : {}),
    ...(typeof value.strokeGapSize === "number"
      ? { strokeGapSize: value.strokeGapSize }
      : {}),
  };
}

export function normalizeSketchStyleRecord(value: unknown): SketchStyleRecord {
  if (
    !isRecord(value) ||
    !isString(value.styleId) ||
    !isString(value.label) ||
    !isRecord(value.target)
  ) {
    throw new Error("Invalid sketch style record payload.");
  }

  const target =
    value.target.kind === "entity" && isString(value.target.entityId)
      ? {
          kind: "entity" as const,
          entityId: assertSketchEntityId(value.target.entityId),
        }
      : value.target.kind === "region" && isString(value.target.regionId)
        ? {
            kind: "region" as const,
            regionId: value.target.regionId as RegionId,
          }
        : null;

  if (!target || !isRecord(value.fill) || !isRecord(value.stroke)) {
    throw new Error("Invalid sketch style record payload.");
  }

  return {
    styleId: value.styleId as import("@/contracts/shared/ids").SketchStyleId,
    label: value.label,
    target,
    fill: normalizeSketchStyleFill(value.fill),
    stroke: normalizeSketchStyleStroke(value.stroke),
  };
}

export function normalizeSketchStyleFill(
  value: Record<string, unknown>,
): SketchStyleRecord["fill"] {
  if (value.kind === "none") {
    return { kind: "none" };
  }

  if (
    value.kind === "solid" &&
    isString(value.color) &&
    typeof value.opacity === "number"
  ) {
    return { kind: "solid", color: value.color, opacity: value.opacity };
  }

  if (value.kind === "gradient" && isRecord(value.gradient)) {
    const gradient = value.gradient;
    if (
      gradient.kind === "linear" &&
      typeof gradient.angleRadians === "number" &&
      isString(gradient.startColor) &&
      typeof gradient.startOpacity === "number" &&
      isString(gradient.endColor) &&
      typeof gradient.endOpacity === "number"
    ) {
      return {
        kind: "gradient",
        gradient: {
          kind: "linear",
          angleRadians: gradient.angleRadians,
          startColor: gradient.startColor,
          startOpacity: gradient.startOpacity,
          endColor: gradient.endColor,
          endOpacity: gradient.endOpacity,
        },
      };
    }
  }

  throw new Error("Invalid sketch style fill payload.");
}

export function normalizeSketchStyleStroke(
  value: Record<string, unknown>,
): SketchStyleRecord["stroke"] {
  if (
    !isString(value.color) ||
    typeof value.opacity !== "number" ||
    typeof value.width !== "number" ||
    (value.lineCap !== "butt" &&
      value.lineCap !== "round" &&
      value.lineCap !== "square") ||
    (value.lineJoin !== "miter" &&
      value.lineJoin !== "round" &&
      value.lineJoin !== "bevel") ||
    typeof value.miterLimit !== "number"
  ) {
    throw new Error("Invalid sketch style stroke payload.");
  }

  return {
    color: value.color,
    opacity: value.opacity,
    width: value.width,
    lineCap: value.lineCap,
    lineJoin: value.lineJoin,
    miterLimit: value.miterLimit,
    ...(typeof value.dashSize === "number" ? { dashSize: value.dashSize } : {}),
    ...(typeof value.gapSize === "number" ? { gapSize: value.gapSize } : {}),
  };
}

export function normalizeSketchDerivationOutput(
  value: unknown,
): SketchDerivationDefinition["outputs"][number] {
  if (
    !isRecord(value) ||
    !isString(value.seedEntityId) ||
    !isString(value.outputEntityId) ||
    typeof value.instanceIndex !== "number" ||
    !Array.isArray(value.seedPointIds) ||
    !Array.isArray(value.outputPointIds)
  ) {
    throw new Error("Invalid sketch derivation output payload.");
  }

  return {
    seedEntityId: assertSketchEntityId(value.seedEntityId),
    outputEntityId: assertSketchEntityId(value.outputEntityId),
    instanceIndex: value.instanceIndex,
    seedPointIds: value.seedPointIds.map((pointId) =>
      assertSketchPointId(pointId),
    ),
    outputPointIds: value.outputPointIds.map((pointId) =>
      assertSketchPointId(pointId),
    ),
  };
}

export function normalizeSketchDerivationDefinition(
  value: unknown,
): SketchDerivationDefinition {
  if (
    !isRecord(value) ||
    !isString(value.derivationId) ||
    !value.derivationId.startsWith("sketch_derivation_") ||
    !isString(value.label) ||
    !isString(value.kind) ||
    !Array.isArray(value.seedEntityIds) ||
    !Array.isArray(value.outputs)
  ) {
    throw new Error("Invalid sketch derivation definition payload.");
  }

  const base = {
    derivationId: value.derivationId,
    label: value.label,
    seedEntityIds: value.seedEntityIds.map((entityId) =>
      assertSketchEntityId(entityId),
    ),
    outputs: value.outputs.map((output) =>
      normalizeSketchDerivationOutput(output),
    ),
  };

  if (value.kind === "mirror") {
    if (
      !isRecord(value.mirrorReference) ||
      value.mirrorReference.kind !== "lineEntity"
    ) {
      throw new Error("Invalid sketch mirror derivation payload.");
    }

    return {
      ...base,
      kind: "mirror",
      mirrorReference: {
        kind: "lineEntity",
        entityId: assertSketchEntityId(value.mirrorReference.entityId),
      },
    };
  }

  if (value.kind === "linearPattern") {
    return {
      ...base,
      kind: "linearPattern",
      vector: normalizePoint2D(
        value.vector,
        "Invalid sketch linear pattern vector payload.",
      ),
      instanceCount:
        typeof value.instanceCount === "number" ? value.instanceCount : 0,
    };
  }

  if (value.kind === "circularPattern") {
    return {
      ...base,
      kind: "circularPattern",
      center: normalizePoint2D(
        value.center,
        "Invalid sketch circular pattern center payload.",
      ),
      angleRadians:
        typeof value.angleRadians === "number"
          ? value.angleRadians
          : Number.NaN,
      instanceCount:
        typeof value.instanceCount === "number" ? value.instanceCount : 0,
    };
  }

  if (value.kind === "transform") {
    return {
      ...base,
      kind: "transform",
      origin: normalizePoint2D(
        value.origin,
        "Invalid sketch transform origin payload.",
      ),
      translation: normalizePoint2D(
        value.translation,
        "Invalid sketch transform translation payload.",
      ),
      rotationRadians:
        typeof value.rotationRadians === "number"
          ? value.rotationRadians
          : Number.NaN,
      scale: typeof value.scale === "number" ? value.scale : Number.NaN,
    };
  }

  throw new Error("Invalid sketch derivation kind payload.");
}

export function normalizeSketchReferenceDefinition(
  value: unknown,
): SketchReferenceDefinition {
  if (
    !isRecord(value) ||
    !isString(value.referenceId) ||
    !isString(value.kind) ||
    !isString(value.label)
  ) {
    throw new Error("Invalid sketch reference definition payload.");
  }

  if (value.kind === "constructionPlane") {
    if (!isRecord(value.source) || value.projectionMode !== "coplanar") {
      throw new Error("Invalid construction-plane sketch reference payload.");
    }

    const source = assertPrimitiveRef(value.source);

    if (source.kind !== "construction") {
      throw new Error(
        "Construction-plane sketch reference must target construction geometry.",
      );
    }

    return {
      referenceId:
        value.referenceId as import("@/contracts/shared/ids").ReferenceId,
      kind: "constructionPlane",
      label: value.label,
      source,
      projectionMode: value.projectionMode,
    };
  }

  if (value.kind === "modelReference") {
    if (
      !isRecord(value.source) ||
      (value.projectionMode !== "projectAlongPlaneNormal" &&
        value.projectionMode !== "useExistingCoplanarGeometry")
    ) {
      throw new Error("Invalid model sketch reference payload.");
    }

    const source = assertPrimitiveRef(value.source);

    if (
      source.kind !== "face" &&
      source.kind !== "edge" &&
      source.kind !== "vertex"
    ) {
      throw new Error(
        "Model sketch reference must target a face, edge, or vertex.",
      );
    }

    return {
      referenceId:
        value.referenceId as import("@/contracts/shared/ids").ReferenceId,
      kind: "modelReference",
      label: value.label,
      source,
      projectionMode: value.projectionMode,
    };
  }

  throw new Error("Invalid sketch reference definition kind.");
}

export function normalizeSketchPointDefinition(
  value: unknown,
): SketchPointDefinition {
  if (
    !isRecord(value) ||
    !isString(value.pointId) ||
    !isString(value.label) ||
    !isRecord(value.target) ||
    !Array.isArray(value.position) ||
    value.position.length !== 2 ||
    value.position.some((component) => typeof component !== "number") ||
    typeof value.isConstruction !== "boolean"
  ) {
    throw new Error("Invalid sketch point definition payload.");
  }

  return {
    pointId: assertSketchPointId(value.pointId),
    label: value.label,
    target: assertPrimitiveRef(value.target) as SketchPointDefinition["target"],
    position: value.position as unknown as SketchPointDefinition["position"],
    isConstruction: value.isConstruction,
    style: normalizeSketchStyleDefinition(value.style),
  };
}

export function normalizeSketchEntityDefinition(
  value: unknown,
): SketchEntityDefinition {
  if (
    !isRecord(value) ||
    !isString(value.kind) ||
    !isString(value.entityId) ||
    !isString(value.label)
  ) {
    throw new Error("Invalid sketch entity definition payload.");
  }

  if (value.kind === "lineSegment") {
    if (
      !isRecord(value.target) ||
      !isString(value.startPointId) ||
      !isString(value.endPointId) ||
      typeof value.isConstruction !== "boolean"
    ) {
      throw new Error("Invalid line segment definition payload.");
    }

    return {
      kind: "lineSegment",
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(
        value.target,
      ) as SketchEntityDefinition["target"],
      isConstruction: value.isConstruction,
      startPointId: assertSketchPointId(value.startPointId),
      endPointId: assertSketchPointId(value.endPointId),
      style: normalizeSketchStyleDefinition(value.style),
    };
  }

  if (value.kind === "circle") {
    if (
      !isRecord(value.target) ||
      !isString(value.centerPointId) ||
      typeof value.radius !== "number" ||
      typeof value.isConstruction !== "boolean"
    ) {
      throw new Error("Invalid circle definition payload.");
    }

    return {
      kind: "circle",
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(
        value.target,
      ) as SketchEntityDefinition["target"],
      isConstruction: value.isConstruction,
      centerPointId: assertSketchPointId(value.centerPointId),
      radius: value.radius,
      style: normalizeSketchStyleDefinition(value.style),
    };
  }

  if (value.kind === "point") {
    if (
      !isRecord(value.target) ||
      !isString(value.pointId) ||
      typeof value.isConstruction !== "boolean"
    ) {
      throw new Error("Invalid point definition payload.");
    }

    return {
      kind: "point",
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(
        value.target,
      ) as SketchEntityDefinition["target"],
      isConstruction: value.isConstruction,
      pointId: assertSketchPointId(value.pointId),
      style: normalizeSketchStyleDefinition(value.style),
    };
  }

  if (value.kind === "arc") {
    if (
      !isRecord(value.target) ||
      !isString(value.centerPointId) ||
      !isString(value.startPointId) ||
      !isString(value.endPointId) ||
      (value.sweepDirection !== "clockwise" &&
        value.sweepDirection !== "counterClockwise") ||
      typeof value.isConstruction !== "boolean"
    ) {
      throw new Error("Invalid arc definition payload.");
    }

    return {
      kind: "arc",
      entityId: assertSketchEntityId(value.entityId),
      label: value.label,
      target: assertPrimitiveRef(
        value.target,
      ) as SketchEntityDefinition["target"],
      isConstruction: value.isConstruction,
      centerPointId: assertSketchPointId(value.centerPointId),
      startPointId: assertSketchPointId(value.startPointId),
      endPointId: assertSketchPointId(value.endPointId),
      sweepDirection: value.sweepDirection,
      style: normalizeSketchStyleDefinition(value.style),
    };
  }

  throw new Error("Invalid sketch entity definition kind.");
}

export function normalizeConstraintDefinition(
  value: unknown,
): ConstraintDefinition {
  return normalizeConstraintDefinitionCore(value);
}

export function normalizeLocalPointConstraintOperand(
  value: Record<string, unknown>,
): Extract<
  ConstraintDefinition,
  { kind: "coincidentProjectedPoint" }
>["point"] {
  if (value.kind !== "localPoint" || !isString(value.pointId)) {
    throw new Error("Invalid local point constraint operand payload.");
  }

  return {
    kind: "localPoint",
    pointId: assertSketchPointId(value.pointId),
  };
}

export function normalizeLocalEntityConstraintOperand(
  value: Record<string, unknown>,
): Extract<ConstraintDefinition, { kind: "parallelProjectedLine" }>["line"] {
  if (value.kind !== "localEntity" || !isString(value.entityId)) {
    throw new Error("Invalid local entity constraint operand payload.");
  }

  return {
    kind: "localEntity",
    entityId: assertSketchEntityId(value.entityId),
  };
}

export function normalizeProjectedGeometryConstraintOperand(
  value: Record<string, unknown>,
): ProjectedSketchGeometryConstraintOperand {
  if (!isRecord(value.reference) || value.kind !== "projectedGeometry") {
    throw new Error("Invalid projected geometry constraint operand payload.");
  }

  const reference = value.reference;
  if (
    !isString(reference.kind) ||
    (reference.kind !== "projectedPoint" &&
      reference.kind !== "projectedLineSegment" &&
      reference.kind !== "projectedCircle" &&
      reference.kind !== "projectedArc" &&
      reference.kind !== "projectedSpline") ||
    !isString(reference.referenceId) ||
    !isString(reference.geometryId)
  ) {
    throw new Error(
      "Invalid projected geometry reference constraint operand payload.",
    );
  }

  return {
    kind: "projectedGeometry",
    reference: {
      kind: reference.kind,
      referenceId:
        reference.referenceId as import("@/contracts/shared/ids").ReferenceId,
      geometryId:
        reference.geometryId as import("@/contracts/shared/ids").ProjectedGeometryId,
    },
  };
}

export function normalizeReadOnlySketchPointConstraintOperand(
  value: unknown,
): ReadOnlySketchPointConstraintOperand {
  if (!isRecord(value)) {
    throw new Error("Invalid sketch point operand payload.");
  }

  if (value.kind === "sketchDatum") {
    if (
      value.datum !== "origin" &&
      value.datum !== "xAxis" &&
      value.datum !== "yAxis"
    ) {
      throw new Error("Invalid sketch datum constraint operand payload.");
    }

    return {
      kind: "sketchDatum",
      datum: value.datum,
    };
  }

  return normalizeProjectedGeometryConstraintOperand(value);
}

export function normalizeReadOnlySketchCurveConstraintOperand(
  value: unknown,
): ReadOnlySketchCurveConstraintOperand {
  if (!isRecord(value)) {
    throw new Error("Invalid sketch curve operand payload.");
  }

  if (value.kind === "sketchDatum") {
    if (
      value.datum !== "origin" &&
      value.datum !== "xAxis" &&
      value.datum !== "yAxis"
    ) {
      throw new Error("Invalid sketch datum constraint operand payload.");
    }

    return {
      kind: "sketchDatum",
      datum: value.datum,
    };
  }

  return normalizeProjectedGeometryConstraintOperand(value);
}

export function normalizeSketchCurveConstraintOperand(
  value: unknown,
): Extract<DimensionDefinition, { kind: "lineDistance" }>["lines"][number] {
  if (!isRecord(value)) {
    throw new Error("Invalid sketch curve operand payload.");
  }

  return value.kind === "localEntity"
    ? normalizeLocalEntityConstraintOperand(value)
    : normalizeReadOnlySketchCurveConstraintOperand(value);
}

export function normalizeSketchPointConstraintOperand(
  value: unknown,
): Extract<DimensionDefinition, { kind: "linePointDistance" }>["point"] {
  if (!isRecord(value)) {
    throw new Error("Invalid sketch point operand payload.");
  }

  return value.kind === "localPoint"
    ? normalizeLocalPointConstraintOperand(value)
    : normalizeReadOnlySketchPointConstraintOperand(value);
}

export function normalizeDimensionLineAnnotationPlacement(
  value: unknown,
): Extract<DimensionDefinition, { kind: "distance" }>["annotationPlacement"] {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isRecord(value) ||
    value.kind !== "dimensionLine" ||
    typeof value.offset !== "number" ||
    (value.angleRadians !== undefined && typeof value.angleRadians !== "number")
  ) {
    throw new Error("Invalid dimension line annotation placement payload.");
  }

  return {
    kind: "dimensionLine",
    offset: value.offset,
    angleRadians: value.angleRadians,
  };
}

export function normalizeDimensionAngleAnnotationPlacement(
  value: unknown,
): Extract<DimensionDefinition, { kind: "lineAngle" }>["annotationPlacement"] {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isRecord(value) ||
    value.kind !== "angleArc" ||
    typeof value.radius !== "number" ||
    (value.side !== "minor" && value.side !== "major")
  ) {
    throw new Error("Invalid angle annotation placement payload.");
  }

  return {
    kind: "angleArc",
    radius: value.radius,
    side: value.side,
  };
}

export function normalizeDimensionDefinition(
  value: unknown,
): DimensionDefinition {
  return normalizeDimensionDefinitionCore(value);
}

export function normalizeSolvedSketchSnapshot(
  value: unknown,
): SolvedSketchSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "solved-sketch/v1alpha1" ||
    !isRecord(value.status) ||
    !isString(value.status.solveState) ||
    !isString(value.status.constraintState) ||
    !Array.isArray(value.solvedEntities) ||
    !Array.isArray(value.solvedPoints) ||
    !Array.isArray(value.constraintStatuses) ||
    !Array.isArray(value.dimensionStatuses) ||
    !Array.isArray(value.diagnostics)
  ) {
    throw new Error("Invalid solved sketch snapshot payload.");
  }

  return {
    schemaVersion: value.schemaVersion,
    status: {
      solveState:
        value.status.solveState === "notEvaluated" ||
        value.status.solveState === "solved" ||
        value.status.solveState === "partiallySolved" ||
        value.status.solveState === "failed"
          ? value.status.solveState
          : (() => {
              throw new Error("Invalid solved sketch solve state payload.");
            })(),
      constraintState:
        value.status.constraintState === "unknown" ||
        value.status.constraintState === "underConstrained" ||
        value.status.constraintState === "wellConstrained" ||
        value.status.constraintState === "overConstrained" ||
        value.status.constraintState === "inconsistent"
          ? value.status.constraintState
          : (() => {
              throw new Error(
                "Invalid solved sketch constraint state payload.",
              );
            })(),
    },
    solvedEntities: value.solvedEntities.map((entity) =>
      normalizeSolvedSketchEntityGeometry(entity),
    ),
    solvedPoints: value.solvedPoints.map((point) => {
      if (
        !isRecord(point) ||
        !isString(point.pointId) ||
        !isRecord(point.target) ||
        !Array.isArray(point.solvedPosition) ||
        point.solvedPosition.length !== 2 ||
        point.solvedPosition.some((component) => typeof component !== "number")
      ) {
        throw new Error("Invalid solved sketch point payload.");
      }

      return {
        pointId: assertSketchPointId(point.pointId),
        target: assertPrimitiveRef(
          point.target,
        ) as SolvedSketchSnapshot["solvedPoints"][number]["target"],
        solvedPosition:
          point.solvedPosition as unknown as SolvedSketchSnapshot["solvedPoints"][number]["solvedPosition"],
      };
    }),
    constraintStatuses: value.constraintStatuses.map((status) =>
      normalizeConstraintStatusRecord(status),
    ),
    dimensionStatuses: value.dimensionStatuses.map((status) =>
      normalizeDimensionStatusRecord(status),
    ),
    diagnostics: value.diagnostics.map((diagnostic) =>
      normalizeSketchSolveDiagnostic(diagnostic),
    ),
  };
}

export function normalizeSolvedSketchEntityGeometry(
  value: unknown,
): SolvedSketchSnapshot["solvedEntities"][number] {
  if (!isRecord(value) || !isString(value.entityId) || !isString(value.kind)) {
    throw new Error("Invalid solved sketch entity payload.");
  }

  if (value.kind === "point") {
    if (
      !Array.isArray(value.solvedPosition) ||
      value.solvedPosition.length !== 2 ||
      value.solvedPosition.some((component) => typeof component !== "number")
    ) {
      throw new Error("Invalid solved point-entity payload.");
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: "point",
      solvedPosition: value.solvedPosition as unknown as [number, number],
    };
  }

  if (value.kind === "lineSegment") {
    if (
      !Array.isArray(value.startPosition) ||
      value.startPosition.length !== 2 ||
      value.startPosition.some((component) => typeof component !== "number") ||
      !Array.isArray(value.endPosition) ||
      value.endPosition.length !== 2 ||
      value.endPosition.some((component) => typeof component !== "number")
    ) {
      throw new Error("Invalid solved line-segment payload.");
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: "lineSegment",
      startPosition: value.startPosition as unknown as [number, number],
      endPosition: value.endPosition as unknown as [number, number],
    };
  }

  if (value.kind === "circle") {
    if (
      !Array.isArray(value.centerPosition) ||
      value.centerPosition.length !== 2 ||
      value.centerPosition.some((component) => typeof component !== "number") ||
      typeof value.solvedRadius !== "number"
    ) {
      throw new Error("Invalid solved circle payload.");
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: "circle",
      centerPosition: value.centerPosition as unknown as [number, number],
      solvedRadius: value.solvedRadius,
    };
  }

  if (value.kind === "arc") {
    if (
      !Array.isArray(value.centerPosition) ||
      value.centerPosition.length !== 2 ||
      value.centerPosition.some((component) => typeof component !== "number") ||
      !Array.isArray(value.startPosition) ||
      value.startPosition.length !== 2 ||
      value.startPosition.some((component) => typeof component !== "number") ||
      !Array.isArray(value.endPosition) ||
      value.endPosition.length !== 2 ||
      value.endPosition.some((component) => typeof component !== "number") ||
      (value.sweepDirection !== "clockwise" &&
        value.sweepDirection !== "counterClockwise")
    ) {
      throw new Error("Invalid solved arc payload.");
    }

    return {
      entityId: assertSketchEntityId(value.entityId),
      kind: "arc",
      centerPosition: value.centerPosition as unknown as [number, number],
      startPosition: value.startPosition as unknown as [number, number],
      endPosition: value.endPosition as unknown as [number, number],
      sweepDirection: value.sweepDirection,
    };
  }

  throw new Error("Invalid solved sketch entity kind.");
}

export function normalizeConstraintStatusRecord(
  value: unknown,
): ConstraintStatusRecord {
  if (
    !isRecord(value) ||
    !isString(value.constraintId) ||
    (value.status !== "satisfied" &&
      value.status !== "unsatisfied" &&
      value.status !== "conflicting")
  ) {
    throw new Error("Invalid constraint status payload.");
  }

  return {
    constraintId: assertConstraintId(value.constraintId),
    status: value.status,
  };
}

export function normalizeDimensionStatusRecord(
  value: unknown,
): DimensionStatusRecord {
  if (
    !isRecord(value) ||
    !isString(value.dimensionId) ||
    (value.status !== "driving" &&
      value.status !== "driven" &&
      value.status !== "unsatisfied") ||
    !(typeof value.solvedValue === "number" || value.solvedValue === null)
  ) {
    throw new Error("Invalid dimension status payload.");
  }

  return {
    dimensionId: assertDimensionId(value.dimensionId),
    status: value.status,
    solvedValue: value.solvedValue,
  };
}

export function normalizeSketchSolveDiagnostic(
  value: unknown,
): SketchSolveDiagnostic {
  if (
    !isRecord(value) ||
    !isString(value.code) ||
    (value.severity !== "info" &&
      value.severity !== "warning" &&
      value.severity !== "error") ||
    !isString(value.message)
  ) {
    throw new Error("Invalid sketch solve diagnostic payload.");
  }

  const target = (() => {
    if (value.target == null) {
      return null;
    }

    if (!isRecord(value.target) || !isString(value.target.kind)) {
      throw new Error("Invalid sketch solve diagnostic target payload.");
    }

    switch (value.target.kind) {
      case "entity":
        return isString(value.target.entityId)
          ? {
              kind: "entity" as const,
              entityId: assertSketchEntityId(value.target.entityId),
            }
          : (() => {
              throw new Error("Invalid sketch solve entity target.");
            })();
      case "point":
        return isString(value.target.pointId)
          ? {
              kind: "point" as const,
              pointId: assertSketchPointId(value.target.pointId),
            }
          : (() => {
              throw new Error("Invalid sketch solve point target.");
            })();
      case "constraint":
        return isString(value.target.constraintId)
          ? {
              kind: "constraint" as const,
              constraintId: assertConstraintId(value.target.constraintId),
            }
          : (() => {
              throw new Error("Invalid sketch solve constraint target.");
            })();
      case "dimension":
        return isString(value.target.dimensionId)
          ? {
              kind: "dimension" as const,
              dimensionId: assertDimensionId(value.target.dimensionId),
            }
          : (() => {
              throw new Error("Invalid sketch solve dimension target.");
            })();
      case "region":
        return isString(value.target.regionId)
          ? {
              kind: "region" as const,
              regionId: assertRegionId(value.target.regionId),
            }
          : (() => {
              throw new Error("Invalid sketch solve region target.");
            })();
      default:
        throw new Error("Invalid sketch solve diagnostic target kind.");
    }
  })();

  return {
    code: value.code,
    severity: value.severity,
    message: value.message,
    target,
  };
}

export function normalizeRegionRecords(value: unknown): RegionRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid sketch region payload.");
  }

  return value.map((region) => {
    if (
      !isRecord(region) ||
      !isString(region.regionId) ||
      !isString(region.label) ||
      !isRecord(region.target) ||
      !isRecord(region.sourceSketch) ||
      !Array.isArray(region.loops) ||
      typeof region.isClosed !== "boolean"
    ) {
      throw new Error("Invalid region record payload.");
    }

    return {
      ...normalizeOwnership(region),
      regionId: assertRegionId(region.regionId),
      label: region.label,
      target: assertPrimitiveRef(region.target) as RegionRecord["target"],
      sourceSketch: assertPrimitiveRef(
        region.sourceSketch,
      ) as RegionRecord["sourceSketch"],
      loops: region.loops.map((loop) => {
        if (
          !isRecord(loop) ||
          !isString(loop.loopId) ||
          (loop.role !== "outer" && loop.role !== "inner") ||
          (loop.orientation !== "clockwise" &&
            loop.orientation !== "counterClockwise") ||
          !Array.isArray(loop.segments) ||
          !Array.isArray(loop.boundaryPointIds) ||
          typeof loop.isClosed !== "boolean"
        ) {
          throw new Error("Invalid region loop payload.");
        }

        return {
          loopId: loop.loopId as RegionRecord["loops"][number]["loopId"],
          role: loop.role,
          orientation: loop.orientation,
          segments: loop.segments.map((segment) => {
            if (
              !isRecord(segment) ||
              !isRecord(segment.source) ||
              !isString(segment.source.kind)
            ) {
              throw new Error("Invalid region boundary segment payload.");
            }

            return {
              source:
                segment.source.kind === "entity"
                  ? {
                      kind: "entity" as const,
                      entityId: assertSketchEntityId(segment.source.entityId),
                    }
                  : segment.source.kind === "projectedGeometry"
                    ? {
                        kind: "projectedGeometry" as const,
                        reference: {
                          kind:
                            isRecord(segment.source.reference) &&
                            (segment.source.reference.kind ===
                              "projectedPoint" ||
                              segment.source.reference.kind ===
                                "projectedLineSegment" ||
                              segment.source.reference.kind ===
                                "projectedCircle" ||
                              segment.source.reference.kind ===
                                "projectedArc" ||
                              segment.source.reference.kind ===
                                "projectedSpline")
                              ? segment.source.reference.kind
                              : undefined,
                          referenceId:
                            isRecord(segment.source.reference) &&
                            isString(segment.source.reference.referenceId)
                              ? (segment.source.reference
                                  .referenceId as import("@/contracts/shared/ids").ReferenceId)
                              : (() => {
                                  throw new Error(
                                    "Invalid projected geometry reference ID payload.",
                                  );
                                })(),
                          geometryId:
                            isRecord(segment.source.reference) &&
                            isString(segment.source.reference.geometryId)
                              ? (segment.source.reference
                                  .geometryId as import("@/contracts/shared/ids").ProjectedGeometryId)
                              : (() => {
                                  throw new Error(
                                    "Invalid projected geometry geometry ID payload.",
                                  );
                                })(),
                        },
                      }
                    : (() => {
                        throw new Error(
                          "Invalid region boundary source payload.",
                        );
                      })(),
              startPointId:
                segment.startPointId === null
                  ? null
                  : assertSketchPointId(segment.startPointId),
              endPointId:
                segment.endPointId === null
                  ? null
                  : assertSketchPointId(segment.endPointId),
              traversalDirection:
                segment.traversalDirection === "reverse"
                  ? ("reverse" as const)
                  : undefined,
            };
          }),
          boundaryPointIds: loop.boundaryPointIds.map((pointId) =>
            assertSketchPointId(pointId),
          ),
          isClosed: loop.isClosed,
        };
      }),
      isClosed: region.isClosed,
    };
  });
}

export function normalizeFeatures(value: unknown): FeatureSnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid feature snapshot payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.featureId) ||
      !isString(entry.label) ||
      typeof entry.suppressed !== "boolean" ||
      !isRecord(entry.definition) ||
      !Array.isArray(entry.producedTargets)
    ) {
      throw new Error("Invalid feature snapshot record.");
    }

    return {
      ...normalizeOwnership(entry),
      featureId: assertFeatureId(entry.featureId),
      label: entry.label,
      suppressed: entry.suppressed,
      definition: normalizeFeatureDefinition(entry.definition),
      producedTargets: entry.producedTargets.map((target) =>
        assertDurableRef(target),
      ),
    };
  });
}

export function normalizeDocumentFeatureCursor(
  value: unknown,
  features: readonly FeatureSnapshotRecord[],
  sketches: readonly SketchSnapshotRecord[] = [],
): DocumentFeatureCursor {
  if (!isRecord(value) || !isString(value.kind)) {
    throw new Error("Invalid document feature cursor payload.");
  }

  if (value.kind === "empty") {
    return { kind: "empty" };
  }

  if (value.kind === "sketch" && isString(value.sketchId)) {
    const sketchId = assertSketchId(value.sketchId);

    if (!sketches.some((sketch) => sketch.sketchId === sketchId)) {
      throw new Error(
        `Document feature cursor references missing sketch ${sketchId}.`,
      );
    }

    return { kind: "sketch", sketchId };
  }

  if (value.kind === "feature" && isString(value.featureId)) {
    const featureId = assertFeatureId(value.featureId);

    if (!features.some((feature) => feature.featureId === featureId)) {
      throw new Error(
        `Document feature cursor references missing feature ${featureId}.`,
      );
    }

    return { kind: "feature", featureId };
  }

  throw new Error("Invalid document feature cursor payload.");
}

export function normalizeBodies(value: unknown): BodySnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid body snapshot payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.bodyId) ||
      !isString(entry.label) ||
      !isRecord(entry.topology) ||
      !Array.isArray(entry.topology.faceIds) ||
      !Array.isArray(entry.topology.edgeIds) ||
      !Array.isArray(entry.topology.vertexIds)
    ) {
      throw new Error("Invalid body snapshot record.");
    }

    return {
      ...normalizeOwnership(entry),
      bodyId: assertBodyId(entry.bodyId),
      label: entry.label,
      topology: {
        faceIds: entry.topology.faceIds.map((faceId) => {
          if (!isString(faceId)) {
            throw new Error("Invalid face ID payload.");
          }

          return faceId as BodySnapshotRecord["topology"]["faceIds"][number];
        }),
        edgeIds: entry.topology.edgeIds.map((edgeId) => {
          if (!isString(edgeId)) {
            throw new Error("Invalid edge ID payload.");
          }

          return edgeId as BodySnapshotRecord["topology"]["edgeIds"][number];
        }),
        vertexIds: entry.topology.vertexIds.map((vertexId) => {
          if (!isString(vertexId)) {
            throw new Error("Invalid vertex ID payload.");
          }

          return vertexId as BodySnapshotRecord["topology"]["vertexIds"][number];
        }),
      },
    };
  });
}

export function normalizeConstructions(
  value: unknown,
): ConstructionSnapshotRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid construction snapshot payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.constructionId) ||
      !isString(entry.label) ||
      entry.constructionType !== "plane"
    ) {
      throw new Error("Invalid construction snapshot record.");
    }

    return {
      ...normalizeOwnership(entry),
      constructionId:
        entry.constructionId as ConstructionSnapshotRecord["constructionId"],
      label: entry.label,
      constructionType: entry.constructionType,
      plane: normalizeSketchPlaneDefinition(entry.plane),
      target: assertDurableRef(entry.target),
    };
  });
}

export function normalizeEntities(value: unknown): SnapshotEntityRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid snapshot entity payload.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.label) ||
      !Array.isArray(entry.relatedTargets) ||
      !Array.isArray(entry.contributingFeatureIds) ||
      !Array.isArray(entry.consumedByFeatureIds) ||
      !Array.isArray(entry.selectionSemantics)
    ) {
      throw new Error("Invalid snapshot entity record.");
    }

    return {
      ...normalizeOwnership(entry),
      id: entry.id as SnapshotEntityId,
      label: entry.label,
      target: assertDurableRef(entry.target),
      relatedTargets: entry.relatedTargets.map((target) =>
        assertDurableRef(target),
      ),
      contributingFeatureIds: entry.contributingFeatureIds.map((featureId) =>
        assertFeatureId(featureId),
      ),
      consumedByFeatureIds: entry.consumedByFeatureIds.map((featureId) =>
        assertFeatureId(featureId),
      ),
      selectionSemantics: entry.selectionSemantics.map((semantic) => {
        if (
          semantic !== "body" &&
          semantic !== "face" &&
          semantic !== "edge" &&
          semantic !== "vertex" &&
          semantic !== "constructionPlane" &&
          semantic !== "existingSketch" &&
          semantic !== "sketchEntity" &&
          semantic !== "sketchPoint" &&
          semantic !== "constraintAnnotation" &&
          semantic !== "dimensionAnnotation" &&
          semantic !== "planarFace" &&
          semantic !== "planarReference"
        ) {
          throw new Error("Invalid snapshot entity selection semantic.");
        }

        return semantic;
      }),
    };
  });
}

export function normalizeKernelDocumentSnapshot(
  value: unknown,
): KernelDocumentSnapshot {
  const parsed = kernelDocumentSnapshotSchema.parse(value);

  return {
    ...parsed,
    settings: normalizeModelingDocumentSettings(parsed.settings),
    capabilities: normalizeModelingKernelCapabilities(parsed.capabilities),
    render: normalizeRenderExport(parsed.render),
  };
}

export function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const parsed = workspaceSnapshotSchema.parse(value);
  const document = normalizeKernelDocumentSnapshot(parsed.document);
  const presentation = normalizeDocumentPresentation(parsed.presentation);

  return {
    ...parsed,
    document,
    presentation,
  };
}

export function normalizeChangedTargets(value: unknown): DurableRef[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid changed target payload.");
  }

  return value.map((entry) => assertDurableRef(entry));
}
