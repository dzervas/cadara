import type {
  RevolveEndCondition,
  RevolveFeatureParameters,
} from "@/contracts/modeling/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import { getRevolveFeatureExtent } from "@/contracts/modeling/feature-extents";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import {
  getConstructionBackedRevolveAxisRejectionReason,
  OCC_CONTRACT_GAP_CODES,
} from "@/domain/modeling/occ/implementation-policy";
import type { Vec3 } from "@/domain/modeling/occ/math";
import {
  buildAxisFromLineEdge,
  buildOpenSketchCurveWire,
  buildRegionProfileFace,
  buildRegionProfileWire,
  getExtrusionNormalForPlanarFace,
  type BuiltSketchProfileWire,
} from "@/domain/modeling/occ/sketch-profile";
import {
  cross,
  dot,
  magnitude,
  mapSketchPointToWorld,
  normalize,
  scale,
  subtract,
  toGpDir,
  toGpPnt,
  toVec3FromGpPoint,
} from "@/domain/modeling/occ/geometry";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  requireSketchSnapshot,
  requireRegion,
  requireBody,
  requireFace,
  requireEdge,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  applyBooleanPolicy,
  trackSurfaceFeatureResult,
} from "@/domain/modeling/occ/features/boolean-operations";
import { getShapeVertexPoints } from "@/domain/modeling/occ/features/extrude";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import { getOccDurableRefKey } from "@/domain/modeling/occ/topology";
import type {
  OccTopologySourceKey,
  OccTopologyStageOutput,
} from "@/domain/modeling/occ/topology-stage";

interface BuiltRevolveProfile {
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  sketchId: string | null;
  sketchProvenance:
    | ReturnType<typeof buildRegionProfileFace>["provenance"]
    | BuiltSketchProfileWire["provenance"]
    | null;
  faceProfileKey: string | null;
}

interface BuiltRevolveShape {
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  sourceShapes: Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >;
  unsupportedSourceKeys: Set<OccTopologySourceKey>;
}

function appendUniqueShape(
  shapes: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[],
  candidate: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  if (!candidate.IsNull() && !shapes.some((shape) => shape.IsSame(candidate))) {
    shapes.push(candidate);
  }
}

function registerSourceShape(
  sourceShapes: BuiltRevolveShape["sourceShapes"],
  sourceKey: OccTopologySourceKey,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const shapes = sourceShapes.get(sourceKey) ?? [];
  appendUniqueShape(shapes, shape);
  sourceShapes.set(sourceKey, shapes);
}

function registerSourceShapes(
  sourceShapes: BuiltRevolveShape["sourceShapes"],
  sourceKey: OccTopologySourceKey,
  shapes: readonly InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[],
) {
  for (const shape of shapes) {
    registerSourceShape(sourceShapes, sourceKey, shape);
  }
}

function listOccShapes(
  oc: OpenCascadeInstance,
  list: InstanceType<OpenCascadeInstance["TopTools_ListOfShape"]>,
) {
  const shapes: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[] = [];
  const copy = new oc.TopTools_ListOfShape_3(list);

  try {
    while (copy.Size() > 0) {
      appendUniqueShape(shapes, copy.First_1());
      copy.RemoveFirst();
    }
  } finally {
    deleteOccObject(copy);
    deleteOccObject(list);
  }

  return shapes;
}

export function buildAxisFromSketchLine(
  context: OccFeatureExecutionContext,
  sketchId: import("@/contracts/shared/ids").SketchId,
  entityId: import("@/contracts/shared/ids").SketchEntityId,
) {
  const sketch = requireSketchSnapshot(context, sketchId);
  const entity = sketch.sketch.solvedSnapshot.solvedEntities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (!entity || entity.kind !== "lineSegment") {
    throw new Error(
      "Revolve sketch axis must reference a solved line segment.",
    );
  }
  const start = mapSketchPointToWorld(sketch.plane, entity.startPosition);
  const end = mapSketchPointToWorld(sketch.plane, entity.endPosition);
  const delta = subtract(end, start);
  if (magnitude(delta) <= context.modelingTolerance) {
    throw new Error("Revolve sketch axis line must have non-zero length.");
  }
  return new context.oc.gp_Ax1_2(
    toGpPnt(context.oc, start),
    toGpDir(context.oc, normalize(delta)),
  );
}

function buildSurfaceRevolveProfile(
  context: OccFeatureExecutionContext,
  parameters: Extract<RevolveFeatureParameters, { resultBodyType: "surface" }>,
): BuiltRevolveProfile {
  const openProfiles = parameters.profiles.filter(
    (profile): profile is Extract<typeof profile, { kind: "sketchEntity" }> =>
      profile.kind === "sketchEntity",
  );

  if (openProfiles.length > 0) {
    if (openProfiles.length !== parameters.profiles.length) {
      throw new Error(
        "unsupported-profile-group: OCC surface revolve cannot combine open sketch curves with region or face profile wires without sewing.",
      );
    }
    const sketchId = openProfiles[0]!.sketchId;
    if (openProfiles.some((profile) => profile.sketchId !== sketchId)) {
      throw new Error(
        "unsupported-profile-group: OCC surface revolve open sketch curves must belong to one sketch.",
      );
    }
    const sketch = requireSketchSnapshot(context, sketchId);
    const built = buildOpenSketchCurveWire(
      context.oc,
      { plane: sketch.plane, sketch: sketch.sketch },
      openProfiles.map((profile) => profile.entityId),
    );
    return {
      shape: built.wire,
      sketchId,
      sketchProvenance: built.provenance,
      faceProfileKey: null,
    };
  }

  if (parameters.profiles.length !== 1) {
    throw new Error(
      "unsupported-profile-group: OCC surface revolve requires one region/face wire or one connected open sketch-curve chain.",
    );
  }

  const profile = parameters.profiles[0]!;
  if (profile.kind === "region") {
    const sketch = requireSketchSnapshot(context, profile.sketchId);
    const region = requireRegion(sketch, profile.regionId);
    const built = buildRegionProfileWire(
      context.oc,
      { plane: sketch.plane, sketch: sketch.sketch },
      region,
    );
    return {
      shape: built.wire,
      sketchId: profile.sketchId,
      sketchProvenance: built.provenance,
      faceProfileKey: null,
    };
  }

  if (profile.kind === "sketchEntity") {
    throw new Error(
      "unsupported-profile-group: OCC surface revolve could not group the open sketch-curve profile.",
    );
  }

  const body = requireBody(context, profile.bodyId);
  const face = requireFace(context, body, profile.faceId);
  getExtrusionNormalForPlanarFace(context.oc, face, "positive");
  return {
    shape: context.oc.BRepTools.OuterWire(face),
    sketchId: null,
    sketchProvenance: null,
    faceProfileKey: getOccDurableRefKey(profile),
  };
}

function buildRevolveFeatureShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: RevolveFeatureParameters,
): BuiltRevolveShape {
  if (parameters.axis.kind === "construction") {
    throw new Error(
      `${OCC_CONTRACT_GAP_CODES.constructionRevolveAxisUnsupported}: ${getConstructionBackedRevolveAxisRejectionReason()}`,
    );
  }

  let builtProfile: BuiltRevolveProfile;

  if (parameters.resultBodyType === "surface") {
    builtProfile = buildSurfaceRevolveProfile(context, parameters);
  } else {
    if (parameters.profiles.length > 1) {
      throw new Error(
        "unsupported-profile-group: OCC revolve does not support multi-profile groups yet.",
      );
    }

    const profile = parameters.profiles[0];
    if (profile.kind === "region") {
      const sketch = requireSketchSnapshot(context, profile.sketchId);
      const region = requireRegion(sketch, profile.regionId);
      const profileFace = buildRegionProfileFace(
        context.oc,
        { plane: sketch.plane, sketch: sketch.sketch },
        region,
      );
      builtProfile = {
        shape: profileFace.face,
        sketchId: profile.sketchId,
        sketchProvenance: profileFace.provenance,
        faceProfileKey: null,
      };
    } else {
      const body = requireBody(context, profile.bodyId);
      const face = requireFace(context, body, profile.faceId);
      getExtrusionNormalForPlanarFace(context.oc, face, "positive");
      builtProfile = {
        shape: face,
        sketchId: null,
        sketchProvenance: null,
        faceProfileKey: getOccDurableRefKey(profile),
      };
    }
  }

  const axis =
    parameters.axis.kind === "sketchEntity"
      ? buildAxisFromSketchLine(
          context,
          parameters.axis.sketchId,
          parameters.axis.entityId,
        )
      : buildAxisFromLineEdge(
          context.oc,
          requireEdge(
            context,
            requireBody(context, parameters.axis.bodyId),
            parameters.axis.edgeId,
          ),
        );

  const resolvedStartAngle =
    getAuthoredLiteralValue(parameters.startAngle) ?? 0;
  if (resolvedStartAngle !== 0) {
    const rotation = new context.oc.gp_Trsf_1();
    rotation.SetRotation_1(axis, resolvedStartAngle);
    const transform = new context.oc.BRepBuilderAPI_Transform_2(
      builtProfile.shape,
      rotation,
      true,
    );
    transform.Build(new context.oc.Message_ProgressRange_1());

    if (!transform.IsDone()) {
      deleteOccObject(transform);
      throw new Error("OCC revolve pre-rotation transform failed.");
    }

    if (builtProfile.sketchProvenance) {
      const edges = new Map(
        [...builtProfile.sketchProvenance.edges].map(([sourceKey, shape]) => [
          sourceKey,
          context.oc.TopoDS.Edge_1(transform.ModifiedShape(shape)),
        ]),
      );
      const vertices = new Map(
        [...builtProfile.sketchProvenance.vertices].map(
          ([sourceKey, shape]) => [
            sourceKey,
            context.oc.TopoDS.Vertex_1(transform.ModifiedShape(shape)),
          ],
        ),
      );
      builtProfile = {
        ...builtProfile,
        shape: transform.Shape(),
        sketchProvenance: {
          ...builtProfile.sketchProvenance,
          edges,
          vertices,
        },
      };
    } else {
      builtProfile = { ...builtProfile, shape: transform.Shape() };
    }
    deleteOccObject(transform);
  }

  const extent = getRevolveFeatureExtent(parameters);
  const ends: Array<{ end: RevolveEndCondition; role: string }> =
    extent.mode === "twoSide"
      ? [
          { end: extent.firstEnd, role: "first-end" },
          { end: extent.secondEnd, role: "second-end" },
        ]
      : extent.mode === "symmetric"
        ? [
            { end: extent.end, role: "symmetric-first-end" },
            {
              end: {
                ...extent.end,
                direction:
                  extent.end.direction === "counterClockwise"
                    ? "clockwise"
                    : "counterClockwise",
              },
              role: "symmetric-second-end",
            },
          ]
        : [{ end: extent.end, role: "one-side-end" }];
  if (parameters.resultBodyType === "surface") {
    return buildSurfaceRevolveShape(
      context,
      ownerFeatureId,
      builtProfile,
      axis,
      ends,
    );
  }

  const shapes = ends.map(({ end, role }) =>
    buildRevolveEndShape(
      context,
      ownerFeatureId,
      builtProfile,
      axis,
      end,
      role,
    ),
  );

  if (shapes.length === 1) {
    return shapes[0]!;
  }

  const builder = new context.oc.BRep_Builder();
  const compound = new context.oc.TopoDS_Compound();
  const sourceShapes = new Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();
  const unsupportedSourceKeys = new Set<OccTopologySourceKey>();
  builder.MakeCompound(compound);
  for (const built of shapes) {
    builder.Add(compound, built.shape);
    for (const [sourceKey, source] of built.sourceShapes) {
      registerSourceShapes(sourceShapes, sourceKey, source);
    }
    for (const sourceKey of built.unsupportedSourceKeys) {
      unsupportedSourceKeys.add(sourceKey);
    }
  }
  deleteOccObject(builder);

  return { shape: compound, sourceShapes, unsupportedSourceKeys };
}

function getAxisOriginAndDirection(
  axis: InstanceType<OpenCascadeInstance["gp_Ax1_2"]>,
) {
  return {
    origin: toVec3FromGpPoint(axis.Location()),
    direction: normalize(toVec3FromGpPoint(axis.Direction())),
  };
}

function getPerpendicularAxisVector(
  point: Vec3,
  axisOrigin: Vec3,
  axisDirection: Vec3,
) {
  const relative = subtract(point, axisOrigin);
  const axial = scale(axisDirection, dot(relative, axisDirection));
  return subtract(relative, axial);
}

function getRevolveReferenceVector(
  oc: OpenCascadeInstance,
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  axisOrigin: Vec3,
  axisDirection: Vec3,
  tolerance: number,
) {
  const points = getShapeVertexPoints(oc, profileShape);

  if (points.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC revolve profile has no vertices for angular target resolution.",
    );
  }

  const centroid = scale(
    points.reduce(
      (sum, point) =>
        [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]] as Vec3,
      [0, 0, 0],
    ),
    1 / points.length,
  );
  const centroidVector = getPerpendicularAxisVector(
    centroid,
    axisOrigin,
    axisDirection,
  );

  if (magnitude(centroidVector) > tolerance) {
    return normalize(centroidVector);
  }

  const radialPoint = points.find(
    (point) =>
      magnitude(getPerpendicularAxisVector(point, axisOrigin, axisDirection)) >
      tolerance,
  );

  if (!radialPoint) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC revolve profile is coincident with the axis.",
    );
  }

  return normalize(
    getPerpendicularAxisVector(radialPoint, axisOrigin, axisDirection),
  );
}

function getAngleAroundAxis(
  startVector: Vec3,
  targetVector: Vec3,
  axisDirection: Vec3,
  direction: Exclude<RevolveEndCondition, { kind: "full" }>["direction"],
) {
  const start = normalize(startVector);
  const target = normalize(targetVector);
  const cosine = Math.max(-1, Math.min(1, dot(start, target)));
  let angle = Math.acos(cosine);
  const orientation = dot(cross(start, target), axisDirection);

  if (direction === "counterClockwise") {
    if (orientation < 0) {
      angle = Math.PI * 2 - angle;
    }
  } else if (orientation > 0) {
    angle = Math.PI * 2 - angle;
  }

  return angle;
}

function getRevolveTargetPointCandidates(
  context: OccFeatureExecutionContext,
  end: Exclude<RevolveEndCondition, { kind: "blind" | "full" }>,
) {
  if (end.kind === "upToNext") {
    return context.bodies.flatMap((body) =>
      getShapeVertexPoints(context.oc, body.shape).map((point) => ({
        point,
        source: body.bodyId,
      })),
    );
  }

  if (end.kind === "upToFace") {
    const body = requireBody(context, end.target.bodyId);
    const face = requireFace(context, body, end.target.faceId);
    return getShapeVertexPoints(context.oc, face).map((point) => ({
      point,
      source: `${end.target.bodyId}:${end.target.faceId}`,
    }));
  }

  if (end.kind === "upToPart") {
    const body = requireBody(context, end.target.bodyId);
    return getShapeVertexPoints(context.oc, body.shape).map((point) => ({
      point,
      source: body.bodyId,
    }));
  }

  const body = requireBody(context, end.target.bodyId);
  const vertex = body.verticesById.get(end.target.vertexId);
  if (!vertex) {
    throw new Error(
      `Vertex ${end.target.vertexId} does not resolve on body ${end.target.bodyId}.`,
    );
  }

  return [
    {
      point: toVec3FromGpPoint(context.oc.BRep_Tool.Pnt(vertex)),
      source: `${end.target.bodyId}:${end.target.vertexId}`,
    },
  ];
}

function selectNearestForwardAngle(
  candidates: Array<{ angle: number; source: string }>,
  tolerance: number,
  label: string,
) {
  const sortedCandidates = [...candidates].sort(
    (left, right) => left.angle - right.angle,
  );
  const nearest = sortedCandidates[0];

  if (!nearest) {
    return null;
  }

  const matchingSources = new Set(
    sortedCandidates
      .filter(
        (candidate) => Math.abs(candidate.angle - nearest.angle) <= tolerance,
      )
      .map((candidate) => candidate.source),
  );

  if (matchingSources.size > 1) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: OCC ${label} termination is ambiguous between multiple bodies.`,
    );
  }

  return nearest.angle;
}

function resolveRevolveTargetAngle(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  axis: InstanceType<OpenCascadeInstance["gp_Ax1_2"]>,
  end: Exclude<RevolveEndCondition, { kind: "blind" | "full" }>,
) {
  const { origin, direction: axisDirection } = getAxisOriginAndDirection(axis);
  const startVector = getRevolveReferenceVector(
    context.oc,
    profileShape,
    origin,
    axisDirection,
    context.modelingTolerance,
  );
  const angularTolerance = Math.max(context.modelingTolerance * 0.01, 1e-7);
  const candidates = getRevolveTargetPointCandidates(context, end).flatMap(
    (candidate) => {
      const targetVector = getPerpendicularAxisVector(
        candidate.point,
        origin,
        axisDirection,
      );

      if (magnitude(targetVector) <= context.modelingTolerance) {
        return [];
      }

      const angle = getAngleAroundAxis(
        startVector,
        targetVector,
        axisDirection,
        end.direction,
      );
      if (
        angle <= angularTolerance ||
        angle >= Math.PI * 2 - angularTolerance
      ) {
        return [];
      }

      return [{ angle, source: candidate.source }];
    },
  );

  return selectNearestForwardAngle(
    candidates,
    angularTolerance,
    "revolve up-to",
  );
}

function resolveRevolveAngle(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  axis: InstanceType<OpenCascadeInstance["gp_Ax1_2"]>,
  end: RevolveEndCondition,
) {
  if (end.kind === "full") {
    return Math.PI * 2;
  }

  if (end.kind === "blind") {
    const angle = getAuthoredLiteralValue(end.angle) ?? 0;
    if (angle <= 0) {
      throw new Error("Revolve end angle must be positive.");
    }
    return angle;
  }

  const targetAngle = resolveRevolveTargetAngle(
    context,
    profileShape,
    axis,
    end,
  );
  if (targetAngle === null) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: OCC revolve ${end.kind} found no terminating geometry.`,
    );
  }

  const offset = (end.offset?.angle ?? 0) as number;
  const signedOffset = end.offset?.direction === "extend" ? offset : -offset;
  const angle = targetAngle + signedOffset;
  if (
    angle <= context.modelingTolerance ||
    angle > Math.PI * 2 + context.modelingTolerance
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC revolve termination is impossible after offset.",
    );
  }

  return angle;
}

function listRevolveProfileEdges(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    edgeMap,
  );
  const edges = Array.from({ length: edgeMap.Size() }, (_, index) =>
    oc.TopoDS.Edge_1(edgeMap.FindKey(index + 1)),
  );
  edgeMap.delete();
  return edges;
}

function rotateSurfaceRevolveProfile(
  context: OccFeatureExecutionContext,
  profile: BuiltRevolveProfile,
  axis: InstanceType<OpenCascadeInstance["gp_Ax1_2"]>,
  angle: number,
) {
  if (angle === 0) {
    return profile;
  }
  const rotation = new context.oc.gp_Trsf_1();
  rotation.SetRotation_1(axis, angle);
  const transform = new context.oc.BRepBuilderAPI_Transform_2(
    profile.shape,
    rotation,
    true,
  );
  transform.Build(new context.oc.Message_ProgressRange_1());
  if (!transform.IsDone()) {
    deleteOccObject(transform);
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC surface revolve profile rotation failed.",
    );
  }

  const shape = transform.Shape();
  const sketchProvenance = profile.sketchProvenance
    ? {
        ...profile.sketchProvenance,
        edges: new Map(
          [...profile.sketchProvenance.edges].map(([sourceKey, source]) => [
            sourceKey,
            context.oc.TopoDS.Edge_1(transform.ModifiedShape(source)),
          ]),
        ),
        vertices: new Map(
          [...profile.sketchProvenance.vertices].map(([sourceKey, source]) => [
            sourceKey,
            context.oc.TopoDS.Vertex_1(transform.ModifiedShape(source)),
          ]),
        ),
      }
    : null;
  deleteOccObject(transform);
  return { ...profile, shape, sketchProvenance };
}

function buildSurfaceRevolveEndShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  profile: BuiltRevolveProfile,
  axis: InstanceType<OpenCascadeInstance["gp_Ax1_2"]>,
  signedExtent: number,
  endRole: string,
): BuiltRevolveShape {
  const revol = new context.oc.BRepPrimAPI_MakeRevol_1(
    profile.shape,
    axis,
    signedExtent,
    false,
  );
  revol.Build(new context.oc.Message_ProgressRange_1());
  if (!revol.IsDone()) {
    deleteOccObject(revol);
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC surface revolve build failed.",
    );
  }

  const sourceShapes = new Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();
  const unsupportedSourceKeys = new Set<OccTopologySourceKey>();
  const slotPrefix = `revolve:${ownerFeatureId}:profile:0:end:${endRole}`;

  for (const edge of listRevolveProfileEdges(context.oc, profile.shape)) {
    registerSourceShape(
      sourceShapes,
      `${slotPrefix}:profile:first-boundary-edge`,
      revol.FirstShape_2(edge),
    );
    registerSourceShape(
      sourceShapes,
      `${slotPrefix}:profile:last-boundary-edge`,
      revol.LastShape_2(edge),
    );
  }

  if (profile.sketchId && profile.sketchProvenance) {
    for (const [sourceKey, edge] of profile.sketchProvenance.edges) {
      const prefix = `${slotPrefix}:sketch-entity:${profile.sketchId}:${sourceKey}`;
      registerSourceShapes(
        sourceShapes,
        `${prefix}:generated-swept-face`,
        listOccShapes(context.oc, revol.Generated(edge)),
      );
      registerSourceShape(sourceShapes, `${prefix}:first-edge`, revol.FirstShape_2(edge));
      registerSourceShape(sourceShapes, `${prefix}:last-edge`, revol.LastShape_2(edge));
    }
    for (const [sourceKey, vertex] of profile.sketchProvenance.vertices) {
      const prefix = `${slotPrefix}:sketch-point:${profile.sketchId}:${sourceKey}`;
      registerSourceShapes(
        sourceShapes,
        `${prefix}:generated-swept-edge`,
        listOccShapes(context.oc, revol.Generated(vertex)),
      );
      registerSourceShape(sourceShapes, `${prefix}:first-vertex`, revol.FirstShape_2(vertex));
      registerSourceShape(sourceShapes, `${prefix}:last-vertex`, revol.LastShape_2(vertex));
    }
    for (const unsupported of profile.sketchProvenance.unsupportedSources) {
      unsupportedSourceKeys.add(
        `${slotPrefix}:sketch-source:${profile.sketchId}:${unsupported.sourceKey}:unsupported-profile-history`,
      );
    }
  } else if (profile.faceProfileKey) {
    unsupportedSourceKeys.add(
      `${slotPrefix}:face-profile:${profile.faceProfileKey}:unsupported-profile-history`,
    );
  }

  const shape = revol.Shape();
  deleteOccObject(revol);
  return { shape, sourceShapes, unsupportedSourceKeys };
}

function buildSurfaceRevolveShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  profile: BuiltRevolveProfile,
  axis: InstanceType<OpenCascadeInstance["gp_Ax1_2"]>,
  ends: readonly { end: RevolveEndCondition; role: string }[],
): BuiltRevolveShape {
  if (ends.length === 1) {
    const angle = resolveRevolveAngle(context, profile.shape, axis, ends[0]!.end);
    const signedExtent =
      ends[0]!.end.kind !== "full" &&
      ends[0]!.end.direction === "clockwise"
        ? -angle
        : angle;
    return buildSurfaceRevolveEndShape(
      context,
      ownerFeatureId,
      profile,
      axis,
      signedExtent,
      ends[0]!.role,
    );
  }

  const clockwise = ends.find(
    ({ end }) => end.kind !== "full" && end.direction === "clockwise",
  );
  const counterClockwise = ends.find(
    ({ end }) => end.kind !== "full" && end.direction === "counterClockwise",
  );
  if (!clockwise || !counterClockwise) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC two-sided surface revolve ends must use opposite directions to produce one sheet.",
    );
  }

  const clockwiseAngle = resolveRevolveAngle(
    context,
    profile.shape,
    axis,
    clockwise.end,
  );
  const counterClockwiseAngle = resolveRevolveAngle(
    context,
    profile.shape,
    axis,
    counterClockwise.end,
  );
  const totalAngle = clockwiseAngle + counterClockwiseAngle;
  if (totalAngle > Math.PI * 2 + context.modelingTolerance) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC two-sided surface revolve extents overlap beyond one full revolution.",
    );
  }

  const rotated = rotateSurfaceRevolveProfile(
    context,
    profile,
    axis,
    -clockwiseAngle,
  );
  return buildSurfaceRevolveEndShape(
    context,
    ownerFeatureId,
    rotated,
    axis,
    totalAngle,
    "combined-ends",
  );
}

function buildRevolveEndShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  profile: BuiltRevolveProfile,
  axis: InstanceType<OpenCascadeInstance["gp_Ax1_2"]>,
  end: RevolveEndCondition,
  endRole: string,
): BuiltRevolveShape {
  const angle = resolveRevolveAngle(context, profile.shape, axis, end);
  const signedExtent =
    end.kind !== "full" && end.direction === "clockwise" ? -angle : angle;

  const revol = new context.oc.BRepPrimAPI_MakeRevol_1(
    profile.shape,
    axis,
    signedExtent,
    false,
  );
  revol.Build(new context.oc.Message_ProgressRange_1());

  if (!revol.IsDone()) {
    deleteOccObject(revol);
    throw new Error("OCC revolve build failed.");
  }

  const sourceShapes = new Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();
  const unsupportedSourceKeys = new Set<OccTopologySourceKey>();
  const slotPrefix = `revolve:${ownerFeatureId}:profile:0:end:${endRole}`;

  registerSourceShape(
    sourceShapes,
    `${slotPrefix}:profile:first-face`,
    revol.FirstShape_1(),
  );
  registerSourceShape(
    sourceShapes,
    `${slotPrefix}:profile:last-face`,
    revol.LastShape_1(),
  );

  if (profile.sketchId && profile.sketchProvenance) {
    for (const [sourceKey, edge] of profile.sketchProvenance.edges) {
      const prefix = `${slotPrefix}:sketch-entity:${profile.sketchId}:${sourceKey}`;
      registerSourceShapes(
        sourceShapes,
        `${prefix}:generated-swept-face`,
        listOccShapes(context.oc, revol.Generated(edge)),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:first-edge`,
        revol.FirstShape_2(edge),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:last-edge`,
        revol.LastShape_2(edge),
      );
    }

    for (const [sourceKey, vertex] of profile.sketchProvenance.vertices) {
      const prefix = `${slotPrefix}:sketch-point:${profile.sketchId}:${sourceKey}`;
      registerSourceShapes(
        sourceShapes,
        `${prefix}:generated-swept-edge`,
        listOccShapes(context.oc, revol.Generated(vertex)),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:first-vertex`,
        revol.FirstShape_2(vertex),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:last-vertex`,
        revol.LastShape_2(vertex),
      );
    }

    for (const unsupported of profile.sketchProvenance.unsupportedSources) {
      unsupportedSourceKeys.add(
        `${slotPrefix}:sketch-source:${profile.sketchId}:${unsupported.sourceKey}:unsupported-profile-history`,
      );
    }
  } else if (profile.faceProfileKey) {
    sourceShapes.clear();
    unsupportedSourceKeys.add(
      `${slotPrefix}:face-profile:${profile.faceProfileKey}:unsupported-profile-history`,
    );
  }

  const shape = revol.Shape();
  deleteOccObject(revol);
  return { shape, sourceShapes, unsupportedSourceKeys };
}

export function executeRevolveFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: RevolveFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildRevolveFeatureShape(
    context,
    ownerFeatureId,
    parameters,
  );
  const result =
    parameters.resultBodyType === "surface"
      ? trackSurfaceFeatureResult(context, ownerFeatureId, featureShape.shape, {
          sourceShapes: featureShape.sourceShapes,
        })
      : (() => {
          const resolvedOperation = getAuthoredLiteralValue(parameters.operation);
          if (!resolvedOperation) {
            throw new Error("Revolve operation must be a resolved literal value.");
          }
          return applyBooleanPolicy(
            context,
            ownerFeatureId,
            resolvedOperation,
            parameters.booleanScope,
            featureShape.shape,
            { sourceShapes: featureShape.sourceShapes },
          );
        })();
  const producedBodyIds = new Set(
    result.producedTargets
      .filter(
        (target): target is Extract<DurableRef, { kind: "body" }> =>
          target.kind === "body",
      )
      .map((target) => target.bodyId),
  );
  const outputs = new Map<BodyId, OccTopologyStageOutput>();

  for (const body of result.bodies) {
    if (!producedBodyIds.has(body.bodyId)) {
      continue;
    }

    const sourceTargets = new Map<OccTopologySourceKey, DurableRef[]>();
    for (const [sourceKey, targets] of result.featureSourceTargets ?? []) {
      const matching = targets.filter(
        (target) => "bodyId" in target && target.bodyId === body.bodyId,
      );
      if (matching.length > 0) {
        sourceTargets.set(sourceKey, matching);
      }
    }

    outputs.set(body.bodyId, {
      outputSlot: body.bodyId,
      body,
      sourceTargets,
      unsupportedSourceKeys: new Set(
        [...featureShape.unsupportedSourceKeys].filter(
          (sourceKey) => !sourceTargets.has(sourceKey),
        ),
      ),
    });
  }

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
    topologyStage: { featureId: ownerFeatureId, outputs },
  };
}
