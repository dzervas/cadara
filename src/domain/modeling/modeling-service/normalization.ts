import type {
  BodyId,
  FeatureTreeNodeId,
  ObjectTreeNodeId,
  PickId,
  PrimitiveRef,
  RenderableId,
  SnapshotEntityId,
} from "@/core/editor/schema";
import type {
  DocumentHistoryItemRecord,
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  ExtrudeStartExtent,
  ExtrudeFeatureParameters,
  FeatureBooleanOperation,
  FeatureBooleanScope,
  FeatureDefinition,
  BakedBodyFeatureParameters,
  BakedBodyFeatureProvenance,
  FilletFeatureParameters,
  ObjectTreeNodeRecord,
  KernelDocumentSnapshot,
  SnapshotEntityRecord,
  WorkspaceSnapshot,
  PlaneFeatureParameters,
  RevolveEndCondition,
  RevolveFeatureParameters,
  ShellFeatureParameters,
  AdvancedSolidFeatureParameters,
} from "@/contracts/modeling/schema";
import type {
  RenderExport,
  RenderableEntityRecord,
} from "@/contracts/render/schema";
import {
  ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
  isAdvancedParticipantRole,
  isAdvancedSolidFeatureKind,
  type AdvancedSolidOperationIntent,
} from "@/contracts/modeling/advanced-solid";
import {
  parseWorkspaceSnapshot,
  requireKernelDocumentSnapshot,
} from "@/contracts/modeling/runtime-schema";
import {
  getAuthoredLiteralValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
  BAKED_BODY_FEATURE_SCHEMA_VERSION,
  FEATURE_REPLAY_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import type { FeatureReplayFeatureParameters } from "@/contracts/modeling/feature-replay";
import {
  isRecord,
  isString,
  isAuthoredNumberLike,
  isAuthoredEnumLike,
  assertBodyId,
  assertDocumentId,
  assertRevisionId,
  assertFeatureId,
  assertSketchId,
  assertPrimitiveRef,
  assertDurableRef,
  assertExtrudeProfileRefs,
  assertSurfaceProfileRefs,
  assertFilletEdgeRef,
  assertShellFaceRef,
  assertRevolveAxisRef,
  assertUpToTargetForKind,
  normalizeUpToOffset,
  toContractAuthoredValue,
} from "./validation";

export function normalizeSketchPlaneFrame(
  value: unknown,
): SketchPlaneDefinition["frame"] {
  if (!isRecord(value)) {
    throw new Error("Invalid sketch plane frame payload.");
  }
  return {
    origin: normalizePoint3(value.origin),
    xAxis: normalizePoint3(value.xAxis),
    yAxis: normalizePoint3(value.yAxis),
    normal: normalizePoint3(value.normal),
    linearUnit:
      value.linearUnit === "documentLength"
        ? value.linearUnit
        : (() => {
            throw new Error("Invalid sketch plane linear unit payload.");
          })(),
    handedness:
      value.handedness === "rightHanded"
        ? value.handedness
        : (() => {
            throw new Error("Invalid sketch plane handedness payload.");
          })(),
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
        distance: toContractAuthoredValue(
          value.distance as MaybeAuthoredValue<number>,
          12,
        ),
        ...(draftAngle !== undefined
          ? {
              draftAngle: toContractAuthoredValue(
                draftAngle as MaybeAuthoredValue<number>,
                0,
              ),
            }
          : {}),
      };
    }
    case "throughAll":
      return {
        kind: "throughAll",
        direction,
        ...(draftAngle !== undefined
          ? {
              draftAngle: toContractAuthoredValue(
                draftAngle as MaybeAuthoredValue<number>,
                0,
              ),
            }
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
          ? {
              draftAngle: toContractAuthoredValue(
                draftAngle as MaybeAuthoredValue<number>,
                0,
              ),
            }
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
        target: assertUpToTargetForKind(value.kind, value.target, {
          allowSketchPoint: true,
        }),
        ...(offset && "distance" in offset ? { offset } : {}),
        ...(draftAngle !== undefined
          ? {
              draftAngle: toContractAuthoredValue(
                draftAngle as MaybeAuthoredValue<number>,
                0,
              ),
            }
          : {}),
      } as ExtrudeEndCondition;
    }
    default:
      throw new Error("Invalid extrude end condition payload.");
  }
}

/**
 * An absent start extent means the prism starts on the profile plane, which is
 * the only historical form. The offset forms must state their displacement
 * exactly; a malformed payload throws rather than silently falling back to the
 * profile plane, which would build a solid short by the intended offset.
 */
export function normalizeExtrudeStartExtent(
  value: unknown,
): ExtrudeStartExtent {
  if (value === undefined || value === null) return { kind: "profilePlane" };
  if (!isRecord(value)) {
    throw new Error("Invalid extrude start extent payload.");
  }
  if (value.kind === "profilePlane") return { kind: "profilePlane" };
  if (value.kind === "blindOffset") {
    if (!isAuthoredNumberLike(value.distance)) {
      throw new Error("Invalid extrude blind start-offset distance payload.");
    }
    if (value.direction !== "positive" && value.direction !== "negative") {
      throw new Error("Invalid extrude blind start-offset direction payload.");
    }
    const distance = toContractAuthoredValue(
      value.distance as MaybeAuthoredValue<number>,
      0,
    );
    // An authored expression (Onshape's `#tolerance*2` start offsets) resolves
    // to a literal later, exactly like the blind end distance, so only a
    // non-positive LITERAL is rejected here.
    const literalDistance = getAuthoredLiteralValue(distance);
    if (literalDistance !== null && literalDistance <= 0) {
      throw new Error("Extrude blind start-offset distance must be positive.");
    }
    return { kind: "blindOffset", distance, direction: value.direction };
  }
  if (value.kind === "sketchPointOffset") {
    const target = assertUpToTargetForKind("upToVertex", value.target, {
      allowSketchPoint: true,
    });
    if (target.kind !== "sketchPoint") {
      throw new Error(
        "An extrude sketch-point start offset requires a sketch-point target.",
      );
    }
    return { kind: "sketchPointOffset", target };
  }
  if (value.kind === "entityOffset") {
    const target = assertPrimitiveRef(value.target);
    if (target.kind !== "edge" && target.kind !== "face") {
      throw new Error(
        "An extrude entity start offset requires a durable edge or face target.",
      );
    }
    return { kind: "entityOffset", target };
  }
  throw new Error("Invalid extrude start extent payload.");
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

function normalizeResultBodyType(
  value: unknown,
  featureLabel: string,
): "solid" | "surface" {
  if (value === "solid" || value === "surface") {
    return value;
  }

  throw new Error(
    `${featureLabel} parameters must declare an explicit resultBodyType of "solid" or "surface".`,
  );
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

  const resultBodyType = normalizeResultBodyType(
    value.resultBodyType,
    "Extrude",
  );

  if (resultBodyType === "surface") {
    return {
      resultBodyType,
      profiles: assertSurfaceProfileRefs(value.profiles, "Extrude"),
      startExtent: normalizeExtrudeStartExtent(value.startExtent),
      extent: normalizeExtrudeExtent(value.extent),
    };
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
    resultBodyType,
    profiles: assertExtrudeProfileRefs(value.profiles, "Extrude"),
    startExtent: normalizeExtrudeStartExtent(value.startExtent),
    extent,
    operation: toContractAuthoredValue(
      value.operation as MaybeAuthoredValue<FeatureBooleanOperation>,
      "newBody",
    ),
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
    !isAuthoredNumberLike(value.radius) ||
    !Array.isArray(value.edgeTargets)
  ) {
    throw new Error("Invalid fillet feature parameters payload.");
  }

  const radius = getAuthoredLiteralValue(
    value.radius as MaybeAuthoredValue<number>,
  );
  if (radius !== null && radius <= 0) {
    throw new Error("Fillet radius must be positive.");
  }

  if (value.edgeTargets.length === 0) {
    throw new Error(
      "Fillet requests must include at least one durable edge target.",
    );
  }

  return {
    edgeTargets: value.edgeTargets.map((target) => assertFilletEdgeRef(target)),
    radius: toContractAuthoredValue(
      value.radius as MaybeAuthoredValue<number>,
      1,
    ),
  };
}

export function normalizePlaneFeatureParameters(
  value: unknown,
): PlaneFeatureParameters {
  if (!isRecord(value)) {
    throw new Error("Invalid plane feature parameters payload.");
  }

  if (value.mode === "explicitFrame") {
    return {
      mode: "explicitFrame",
      frame: normalizeSketchPlaneFrame(value.frame),
    };
  }

  if (value.mode !== "coplanar" || !isRecord(value.reference)) {
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
        angle: toContractAuthoredValue(
          value.angle as MaybeAuthoredValue<number>,
          Math.PI * 2,
        ),
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

  const resultBodyType = normalizeResultBodyType(
    value.resultBodyType,
    "Revolve",
  );
  const startAngle = isAuthoredNumberLike(value.startAngle)
    ? toContractAuthoredValue(value.startAngle as MaybeAuthoredValue<number>, 0)
    : toContractAuthoredValue(0, 0);

  if (resultBodyType === "surface") {
    return {
      resultBodyType,
      profiles: assertSurfaceProfileRefs(value.profiles, "Revolve"),
      axis: assertRevolveAxisRef(value.axis),
      startAngle,
      extent: normalizeRevolveExtent(value.extent),
    };
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
    resultBodyType,
    profiles: assertExtrudeProfileRefs(value.profiles, "Revolve"),
    axis: assertRevolveAxisRef(value.axis),
    startAngle,
    extent,
    operation: toContractAuthoredValue(
      value.operation as MaybeAuthoredValue<FeatureBooleanOperation>,
      "newBody",
    ),
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
    !isAuthoredNumberLike(value.thickness) ||
    !Array.isArray(value.faceTargets)
  ) {
    throw new Error("Invalid shell feature parameters payload.");
  }

  const thickness = getAuthoredLiteralValue(
    value.thickness as MaybeAuthoredValue<number>,
  );
  if (thickness !== null && thickness <= 0) {
    throw new Error("Shell thickness must be positive.");
  }

  const bodyTarget = assertPrimitiveRef(value.bodyTarget);

  if (bodyTarget.kind !== "body") {
    throw new Error("Shell bodyTarget must resolve to one durable body.");
  }

  if (
    value.mode !== undefined &&
    value.mode !== "openFaces" &&
    value.mode !== "closedHollow" &&
    value.mode !== "offsetAllFaces"
  ) {
    throw new Error("Invalid shell mode payload.");
  }

  if (
    value.direction !== undefined &&
    value.direction !== "inside" &&
    value.direction !== "outside"
  ) {
    throw new Error("Invalid shell direction payload.");
  }

  if (
    !isAuthoredEnumLike(value.operation, [
      "newBody",
      "join",
      "cut",
      "intersect",
    ])
  ) {
    throw new Error("Invalid shell operation payload.");
  }

  const booleanScope: FeatureBooleanScope =
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
        : { kind: "standalone" };

  const baseParameters = {
    bodyTarget,
    thickness: toContractAuthoredValue(
      value.thickness as MaybeAuthoredValue<number>,
      1,
    ),
    ...(value.direction === undefined
      ? {}
      : { direction: value.direction as "inside" | "outside" }),
    operation: toContractAuthoredValue(
      value.operation as MaybeAuthoredValue<FeatureBooleanOperation>,
      "newBody" as FeatureBooleanOperation,
    ),
    booleanScope,
  };

  if (value.mode === "closedHollow") {
    if (value.faceTargets.length !== 0) {
      throw new Error(
        "Shell closedHollow mode cannot include removable faces.",
      );
    }
    if (value.direction !== undefined && value.direction !== "inside") {
      throw new Error("Shell closedHollow mode requires an inside direction.");
    }

    return {
      ...baseParameters,
      mode: "closedHollow",
      faceTargets: [],
      direction: "inside",
    };
  }

  if (value.mode === "offsetAllFaces") {
    if (value.faceTargets.length !== 0) {
      throw new Error("Shell offsetAllFaces mode cannot include face targets.");
    }

    return {
      ...baseParameters,
      mode: "offsetAllFaces",
      faceTargets: [],
    };
  }

  if (value.faceTargets.length === 0) {
    throw new Error(
      "Shell requests must include at least one removable face target.",
    );
  }

  return {
    ...baseParameters,
    ...(value.mode === "openFaces" ? { mode: "openFaces" as const } : {}),
    faceTargets: value.faceTargets.map((target) => assertShellFaceRef(target)),
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
    !isAuthoredEnumLike(operationIntent, [
      "create",
      "add",
      "subtract",
      "intersect",
    ])
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
    ...(operationIntent
      ? {
          operationIntent: toContractAuthoredValue(
            operationIntent as MaybeAuthoredValue<AdvancedSolidOperationIntent>,
            "create",
          ),
        }
      : {}),
    ...(isRecord(value.options) ? { options: { ...value.options } } : {}),
  };
}

function normalizeBakedBodyProvenance(
  value: unknown,
): BakedBodyFeatureProvenance {
  if (!isRecord(value) || !isString(value.source)) {
    throw new Error("Invalid baked-body provenance payload.");
  }
  if (
    value.source !== "onshape" &&
    value.source !== "fileImport" &&
    value.source !== "generated"
  ) {
    throw new Error("Invalid baked-body provenance source.");
  }
  const provenance: BakedBodyFeatureProvenance = { source: value.source };
  if (isString(value.sourceId)) {
    provenance.sourceId = value.sourceId;
  }
  if (isString(value.sourceName)) {
    provenance.sourceName = value.sourceName;
  }
  if (isString(value.reason)) {
    provenance.reason = value.reason;
  }
  if (
    isRecord(value.featureSpan) &&
    isString(value.featureSpan.fromFeatureId) &&
    isString(value.featureSpan.toFeatureId)
  ) {
    provenance.featureSpan = {
      fromFeatureId: value.featureSpan.fromFeatureId,
      toFeatureId: value.featureSpan.toFeatureId,
    };
  }
  return provenance;
}

function normalizeFeatureReplayFeatureParameters(
  value: unknown,
): FeatureReplayFeatureParameters {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sourceFeatureIds) ||
    value.sourceFeatureIds.length === 0
  ) {
    throw new Error(
      "Feature replay requires one or more ordered source feature ids.",
    );
  }
  const sourceFeatureIds = value.sourceFeatureIds.map((featureId) =>
    assertFeatureId(featureId),
  );
  if (new Set(sourceFeatureIds).size !== sourceFeatureIds.length) {
    throw new Error("Feature replay source feature ids must be unique.");
  }
  if (!isRecord(value.transform)) {
    throw new Error("Feature replay requires a transform.");
  }
  if (value.transform.kind === "linear") {
    const direction = assertDurableRef(value.transform.direction);
    if (direction.kind !== "construction") {
      throw new Error(
        "Feature replay linear direction must be a construction plane.",
      );
    }
    if (
      !isAuthoredNumberLike(value.transform.instanceCount) ||
      !isAuthoredNumberLike(value.transform.spacing) ||
      typeof getAuthoredLiteralValue(
        value.transform.oppositeDirection as MaybeAuthoredValue<unknown>,
      ) !== "boolean"
    ) {
      throw new Error("Feature replay linear transform has invalid values.");
    }
    return {
      sourceFeatureIds,
      transform: {
        kind: "linear",
        direction,
        instanceCount: toContractAuthoredValue<number>(
          value.transform.instanceCount as MaybeAuthoredValue<number>,
          2,
        ),
        spacing: toContractAuthoredValue<number>(
          value.transform.spacing as MaybeAuthoredValue<number>,
          1,
        ),
        oppositeDirection: toContractAuthoredValue<boolean>(
          value.transform.oppositeDirection as MaybeAuthoredValue<boolean>,
          false,
        ),
      },
    };
  }
  if (value.transform.kind === "mirror") {
    const plane = assertDurableRef(value.transform.plane);
    if (plane.kind !== "construction") {
      throw new Error(
        "Feature replay mirror plane must be a construction plane.",
      );
    }
    return { sourceFeatureIds, transform: { kind: "mirror", plane } };
  }
  throw new Error("Feature replay transform is unsupported.");
}

function normalizeBakedBodyFeatureParameters(
  value: unknown,
): BakedBodyFeatureParameters {
  if (
    !isRecord(value) ||
    !isString(value.assetId) ||
    !isString(value.format) ||
    !isString(value.hash) ||
    typeof value.byteLength !== "number" ||
    !isString(value.label)
  ) {
    throw new Error("Invalid baked-body feature parameters payload.");
  }
  const replacement = value.replacement;
  if (!isRecord(replacement) || !isString(replacement.kind)) {
    throw new Error("Invalid baked-body replacement payload.");
  }
  const normalizedReplacement: BakedBodyFeatureParameters["replacement"] =
    replacement.kind === "append"
      ? { kind: "append" }
      : replacement.kind === "replaceBodies" &&
          Array.isArray(replacement.bodyIds) &&
          replacement.bodyIds.every(isString)
        ? { kind: "replaceBodies", bodyIds: replacement.bodyIds as BodyId[] }
        : (() => {
            throw new Error("Invalid baked-body replacement payload.");
          })();
  return {
    assetId: value.assetId as BakedBodyFeatureParameters["assetId"],
    format: value.format as BakedBodyFeatureParameters["format"],
    hash: value.hash as BakedBodyFeatureParameters["hash"],
    byteLength: value.byteLength,
    label: value.label,
    provenance: normalizeBakedBodyProvenance(value.provenance),
    replacement: normalizedReplacement,
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
    case "bakedBody":
      return {
        kind: "bakedBody",
        featureTypeVersion:
          value.featureTypeVersion === BAKED_BODY_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : BAKED_BODY_FEATURE_SCHEMA_VERSION,
        parameters: normalizeBakedBodyFeatureParameters(value.parameters),
      };
    case "featureReplay":
      return {
        kind: "featureReplay",
        featureTypeVersion:
          value.featureTypeVersion === FEATURE_REPLAY_FEATURE_SCHEMA_VERSION
            ? value.featureTypeVersion
            : FEATURE_REPLAY_FEATURE_SCHEMA_VERSION,
        parameters: normalizeFeatureReplayFeatureParameters(value.parameters),
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
        entry.binding.semanticClass !== "body" &&
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

          for (const point of vertexPositions) {
            if (
              !Array.isArray(point) ||
              point.length !== 3 ||
              point.some((component) => typeof component !== "number")
            ) {
              throw new Error("Invalid mesh vertex position payload.");
            }
          }
          for (const normal of vertexNormals ?? []) {
            if (
              !Array.isArray(normal) ||
              normal.length !== 3 ||
              normal.some((component) => typeof component !== "number")
            ) {
              throw new Error("Invalid mesh vertex normal payload.");
            }
          }
          for (const triangle of triangleIndices) {
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
          }

          const mesh = {
            kind: "mesh" as const,
            vertexPositions: vertexPositions as [number, number, number][],
            vertexNormals: vertexNormals as [number, number, number][] | null,
            triangleIndices: triangleIndices as [number, number, number][],
          };
          // An exact, validated mesh keeps its identity across snapshots, so
          // unchanged meshes do not rebuild viewport geometry (cadara-lyi).
          return Object.keys(entry.geometry).length === 4
            ? (entry.geometry as typeof mesh)
            : mesh;
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
      target.kind !== "body" &&
      target.kind !== "construction" &&
      target.kind !== "region" &&
      target.kind !== "sketchEntity" &&
      target.kind !== "sketchPoint"
    ) {
      throw new Error(
        "Non-topological render bindings must target durable body, construction, region, or sketch refs.",
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
      entry.binding.semanticClass === "body" &&
      (entry.binding.topology !== null || target.kind !== "body")
    ) {
      throw new Error(
        "body bindings must target durable bodies without subtopology.",
      );
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
        case "body":
          return {
            pickId: entry.binding.pickId as PickId,
            pickPriority: entry.binding.pickPriority,
            target: target as Extract<PrimitiveRef, { kind: "body" }>,
            topology: null,
            semanticClass: "body",
          };
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
  const parsed = requireKernelDocumentSnapshot(value);

  return {
    ...parsed,
    settings: normalizeModelingDocumentSettings(parsed.settings),
    capabilities: normalizeModelingKernelCapabilities(parsed.capabilities),
    render: normalizeRenderExport(parsed.render),
  };
}

export function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const parsed = parseWorkspaceSnapshot(value);
  const document = normalizeKernelDocumentSnapshot(parsed.document);
  const presentation = normalizeDocumentPresentation(parsed.presentation);

  return {
    ...parsed,
    document,
    presentation,
  };
}
