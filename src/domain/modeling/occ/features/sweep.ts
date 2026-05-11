import type {
  FeatureBooleanOperation,
  FeatureBooleanScope,
} from "@/contracts/modeling/schema";
import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import {
  getAuthoredLiteralValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import type { Vec3 } from "@/domain/modeling/occ/math";
import {
  buildAxisFromLineEdge,
  buildRegionProfileFace,
  getExtrusionNormalForPlanarFace,
} from "@/domain/modeling/occ/sketch-profile";
import {
  magnitude,
  normalize,
  subtract,
  toGpDir,
  toGpPnt,
  toGpVec,
  toVec3FromGpPoint,
} from "@/domain/modeling/occ/geometry";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  requireSketchSnapshot,
  requireRegion,
  requireBody,
  requireFace,
  requireEdge,
  requireConstructionPlaneDefinition,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import { applyBooleanPolicy } from "@/domain/modeling/occ/features/boolean-operations";

type SweepProfileControl =
  | "none"
  | "keepProfileOrientation"
  | "lockProfileFaces"
  | "lockProfileDirection";
type SweepTwistOption =
  | { type: "none" }
  | { type: "turns"; turns: number }
  | { type: "angle"; angle: number }
  | { type: "pitch"; pitch: number };

function buildSweepProfileShape(
  context: OccFeatureExecutionContext,
  profile: DurableRef,
) {
  if (profile.kind === "region") {
    const sketch = requireSketchSnapshot(context, profile.sketchId);
    const region = requireRegion(sketch, profile.regionId);
    return buildRegionProfileFace(
      context.oc,
      { plane: sketch.plane, sketch: sketch.sketch },
      region,
    ).face;
  }

  if (profile.kind === "face") {
    const body = requireBody(context, profile.bodyId);
    const face = requireFace(body, profile.faceId);
    getExtrusionNormalForPlanarFace(context.oc, face, "positive");
    return face;
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC sweep profiles must be region or planar face targets.",
  );
}

function buildSweepPathWire(
  context: OccFeatureExecutionContext,
  path: DurableRef,
) {
  if (path.kind === "sketchEntity") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep does not support sketch-entity paths yet.",
    );
  }

  if (path.kind !== "edge") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep path must be a durable edge target.",
    );
  }

  const body = requireBody(context, path.bodyId);
  const edge = requireEdge(body, path.edgeId);
  const wireBuilder = new context.oc.BRepBuilderAPI_MakeWire_1();
  wireBuilder.Add_1(edge);

  if (!wireBuilder.IsDone()) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep failed to build a path wire from the selected edge.",
    );
  }

  return wireBuilder.Wire();
}

function getSweepOptionLiteral(value: unknown) {
  return getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>);
}

function getSweepProfileControl(
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
): SweepProfileControl {
  const profileControl = getSweepOptionLiteral(
    definition.parameters.options?.profileControl,
  );
  if (
    profileControl === undefined ||
    profileControl === null ||
    profileControl === "none"
  ) {
    return "none";
  }

  if (
    profileControl === "keepProfileOrientation" ||
    profileControl === "lockProfileFaces" ||
    profileControl === "lockProfileDirection"
  ) {
    return profileControl;
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC sweep profile control option is invalid.",
  );
}

function getSweepEndScale(
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
) {
  const endScale = getSweepOptionLiteral(
    definition.parameters.options?.endScale,
  );
  if (endScale === undefined || endScale === null) {
    return 1;
  }

  if (
    typeof endScale === "number" &&
    Number.isFinite(endScale) &&
    endScale > 0
  ) {
    return endScale;
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC sweep end scale must be a positive number.",
  );
}

function getSweepTwist(
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
): SweepTwistOption {
  const twist = definition.parameters.options?.twist;
  if (!twist) {
    return { type: "none" };
  }

  if (typeof twist !== "object" || Array.isArray(twist)) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep twist option must be a discriminated option.",
    );
  }

  const twistRecord = twist as Record<string, unknown>;
  switch (twistRecord.type) {
    case "none":
      return { type: "none" };
    case "turns": {
      const turns = getSweepOptionLiteral(twistRecord.turns);
      if (typeof turns === "number" && Number.isFinite(turns) && turns > 0) {
        return { type: "turns", turns };
      }
      break;
    }
    case "angle": {
      const angle = getSweepOptionLiteral(twistRecord.angle);
      if (typeof angle === "number" && Number.isFinite(angle)) {
        return { type: "angle", angle };
      }
      break;
    }
    case "pitch": {
      const pitch = getSweepOptionLiteral(twistRecord.pitch);
      if (typeof pitch === "number" && Number.isFinite(pitch) && pitch > 0) {
        return { type: "pitch", pitch };
      }
      break;
    }
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC sweep twist option is invalid.",
  );
}

export function getSweepLinearPathData(
  context: OccFeatureExecutionContext,
  path: DurableRef,
) {
  if (path.kind !== "edge") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: Advanced OCC sweep controls require a durable linear edge path.",
    );
  }

  const body = requireBody(context, path.bodyId);
  const edge = requireEdge(body, path.edgeId);
  buildAxisFromLineEdge(context.oc, edge);
  const curve = new context.oc.BRepAdaptor_Curve_2(edge);
  const start = toVec3FromGpPoint(curve.Value(curve.FirstParameter()));
  const end = toVec3FromGpPoint(curve.Value(curve.LastParameter()));
  const delta = subtract(end, start);
  const length = magnitude(delta);

  if (length <= context.modelingTolerance) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: Advanced OCC sweep controls require a non-zero path length.",
    );
  }

  return {
    axis: new context.oc.gp_Ax1_2(
      toGpPnt(context.oc, start),
      toGpDir(context.oc, normalize(delta)),
    ),
    start,
    delta,
    length,
  };
}

function resolveSweepTwistAngle(twist: SweepTwistOption, pathLength: number) {
  switch (twist.type) {
    case "turns":
      return twist.turns * Math.PI * 2;
    case "angle":
      return twist.angle;
    case "pitch":
      return (pathLength / twist.pitch) * Math.PI * 2;
    default:
      return 0;
  }
}

function transformSweepSectionShape(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  transform: InstanceType<OpenCascadeInstance["gp_Trsf"]>,
) {
  const builder = new context.oc.BRepBuilderAPI_Transform_2(
    shape,
    transform,
    true,
  );
  builder.Build(new context.oc.Message_ProgressRange_1());

  if (!builder.IsDone()) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep section transform failed.",
    );
  }

  return builder.Shape();
}

function buildTransformedSweepEndWire(input: {
  context: OccFeatureExecutionContext;
  profileWire: InstanceType<OpenCascadeInstance["TopoDS_Wire"]>;
  path: ReturnType<typeof getSweepLinearPathData>;
  twistAngle: number;
  endScale: number;
}) {
  const { context, path } = input;
  let shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]> =
    input.profileWire;

  if (Math.abs(input.endScale - 1) > context.modelingTolerance) {
    const scaleTransform = new context.oc.gp_Trsf_1();
    scaleTransform.SetScale(toGpPnt(context.oc, path.start), input.endScale);
    shape = transformSweepSectionShape(context, shape, scaleTransform);
  }

  if (Math.abs(input.twistAngle) > context.modelingTolerance) {
    const rotation = new context.oc.gp_Trsf_1();
    rotation.SetRotation_1(path.axis, input.twistAngle);
    shape = transformSweepSectionShape(context, shape, rotation);
  }

  const translation = new context.oc.gp_Trsf_1();
  translation.SetTranslation_1(toGpVec(context.oc, path.delta));
  shape = transformSweepSectionShape(context, shape, translation);

  return context.oc.TopoDS.Wire_1(shape);
}

function buildAdvancedSweepLoftShape(input: {
  context: OccFeatureExecutionContext;
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
  path: ReturnType<typeof getSweepLinearPathData>;
  twistAngle: number;
  endScale: number;
}) {
  const profileWire = input.context.oc.BRepTools.OuterWire(input.profileShape);
  const endWire = buildTransformedSweepEndWire({
    context: input.context,
    profileWire,
    path: input.path,
    twistAngle: input.twistAngle,
    endScale: input.endScale,
  });
  const loftBuilder = new input.context.oc.BRepOffsetAPI_ThruSections(
    true,
    false,
    input.context.modelingTolerance,
  );
  loftBuilder.CheckCompatibility(true);
  loftBuilder.AddWire(profileWire);
  loftBuilder.AddWire(endWire);
  loftBuilder.Build(new input.context.oc.Message_ProgressRange_1());

  if (!loftBuilder.IsDone()) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC advanced sweep loft build failed.",
    );
  }

  return loftBuilder.Shape();
}

function buildLockProfileDirectionSweepPipe(input: {
  context: OccFeatureExecutionContext;
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Face"]>;
  pathWire: InstanceType<OpenCascadeInstance["TopoDS_Wire"]>;
  direction: Vec3;
}) {
  const pipe = new input.context.oc.BRepOffsetAPI_MakePipeShell(input.pathWire);
  pipe.SetMode_3(toGpDir(input.context.oc, normalize(input.direction)));
  pipe.Add_1(
    input.context.oc.BRepTools.OuterWire(input.profileShape),
    false,
    false,
  );
  pipe.Build(new input.context.oc.Message_ProgressRange_1());

  if (!pipe.IsDone() || !pipe.MakeSolid()) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC lock-profile-direction sweep pipe build failed.",
    );
  }

  return pipe.Shape();
}

function resolveSweepLockDirection(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
) {
  const targets =
    getAdvancedParticipant(definition, "lockProfileDirection")?.targets ?? [];
  if (targets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep lock profile direction requires exactly one reference.",
    );
  }

  const target = targets[0]!;
  if (target.kind === "edge") {
    const axis = buildAxisFromLineEdge(
      context.oc,
      requireEdge(requireBody(context, target.bodyId), target.edgeId),
    );
    return normalize(toVec3FromGpPoint(axis.Direction()));
  }

  if (target.kind === "construction") {
    return normalize(
      requireConstructionPlaneDefinition(context, target.constructionId).frame
        .normal,
    );
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC sweep lock profile direction must be an edge or construction reference.",
  );
}

function resolveSweepLockProfileFaceDirection(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
) {
  const targets =
    getAdvancedParticipant(definition, "lockProfileFace")?.targets ?? [];
  if (targets.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep lock profile faces requires at least one face reference.",
    );
  }

  let direction: Vec3 | null = null;

  for (const target of targets) {
    if (target.kind !== "face") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC sweep lock profile faces only accepts face references.",
      );
    }

    const normal = getExtrusionNormalForPlanarFace(
      context.oc,
      requireFace(requireBody(context, target.bodyId), target.faceId),
      "positive",
    );
    direction ??= normal;
  }

  return normalize(direction!);
}

function buildSweepFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
) {
  const profileTargets =
    getAdvancedParticipant(definition, "profile")?.targets ?? [];
  const pathTargets = getAdvancedParticipant(definition, "path")?.targets ?? [];
  const guideCurveTargets =
    getAdvancedParticipant(definition, "guideCurve")?.targets ?? [];

  if (profileTargets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep requires exactly one profile target in the initial implementation.",
    );
  }

  if (pathTargets.length !== 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep requires exactly one path target.",
    );
  }

  if (guideCurveTargets.length > 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC sweep does not support guide curves yet.",
    );
  }

  const profileShape = context.oc.TopoDS.Face_1(
    buildSweepProfileShape(context, profileTargets[0]!),
  );
  const pathWire = buildSweepPathWire(context, pathTargets[0]!);
  const profileControl = getSweepProfileControl(definition);
  const twist = getSweepTwist(definition);
  const endScale = getSweepEndScale(definition);
  const pathData =
    twist.type === "none" && Math.abs(endScale - 1) <= context.modelingTolerance
      ? null
      : getSweepLinearPathData(context, pathTargets[0]!);
  const twistAngle = pathData
    ? resolveSweepTwistAngle(twist, pathData.length)
    : 0;
  const hasTwistOrScale =
    pathData !== null &&
    (Math.abs(twistAngle) > context.modelingTolerance ||
      Math.abs(endScale - 1) > context.modelingTolerance);

  if (profileControl === "lockProfileFaces") {
    const direction = resolveSweepLockProfileFaceDirection(context, definition);
    if (!hasTwistOrScale) {
      return buildLockProfileDirectionSweepPipe({
        context,
        profileShape,
        pathWire,
        direction,
      });
    }
  }

  if (profileControl === "lockProfileDirection") {
    const direction = resolveSweepLockDirection(context, definition);
    if (!hasTwistOrScale) {
      return buildLockProfileDirectionSweepPipe({
        context,
        profileShape,
        pathWire,
        direction,
      });
    }
  }

  if (hasTwistOrScale) {
    if (profileControl !== "none") {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC sweep does not support combining profile control with twist or scale yet.",
      );
    }

    return buildAdvancedSweepLoftShape({
      context,
      profileShape,
      path: pathData,
      twistAngle,
      endScale,
    });
  }

  const pipe =
    profileControl === "keepProfileOrientation" ||
    profileControl === "lockProfileFaces"
      ? new context.oc.BRepOffsetAPI_MakePipe_2(
          pathWire,
          profileShape,
          context.oc.GeomFill_Trihedron.GeomFill_IsFixed as never,
          false,
        )
      : new context.oc.BRepOffsetAPI_MakePipe_1(pathWire, profileShape);
  pipe.Build(new context.oc.Message_ProgressRange_1());

  if (!pipe.IsDone()) {
    throw new Error("OCC sweep pipe build failed.");
  }

  return pipe.Shape();
}

function getSweepBooleanPolicy(
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
): {
  operation: FeatureBooleanOperation;
  booleanScope: FeatureBooleanScope;
} {
  const intent = definition.parameters.operationIntent ?? "create";

  if (intent === "create") {
    return {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    };
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC sweep does not support boolean composition yet.",
  );
}

export function executeSweepFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "sweep" },
): OccFeatureExecutionResult {
  const featureShape = buildSweepFeatureShape(context, definition);
  const policy = getSweepBooleanPolicy(definition);
  const result = applyBooleanPolicy(
    context,
    ownerFeatureId,
    policy.operation,
    policy.booleanScope,
    featureShape,
  );

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  };
}
