import type {
  ExtrudeEndCondition,
  ExtrudeFeatureParameters,
} from "@/contracts/modeling/schema";
import { getExtrudeFeatureExtent } from "@/contracts/modeling/feature-extents";
import type { FeatureId } from "@/contracts/shared/ids";
import type { Vec3 } from "@/domain/modeling/occ/math";
import {
  buildRegionProfileFace,
  getExtrusionNormalForPlanarFace,
  getExtrusionNormalForSketchProfile,
} from "@/domain/modeling/occ/sketch-profile";
import {
  cross,
  dot,
  normalize,
  scale,
  toGpDir,
  toGpPlane,
  toGpVec,
  toVec3FromGpPoint,
} from "@/domain/modeling/occ/geometry";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { getOccDurableRefKey } from "@/domain/modeling/occ/topology";
import {
  requireSketchSnapshot,
  requireRegion,
  requireBody,
  requireFace,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import { applyBooleanPolicy } from "@/domain/modeling/occ/features/boolean-operations";

function getShapeProjectionRange(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  direction: Vec3,
) {
  const points = getShapeVertexPoints(oc, shape);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const projection = dot(point, direction);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC could not resolve target projection extents.",
    );
  }

  return { min, max };
}

export function getShapeVertexPoints(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const vertexMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
    vertexMap,
  );
  const points: Vec3[] = [];

  for (let index = 1; index <= vertexMap.Size(); index += 1) {
    const vertex = oc.TopoDS.Vertex_1(vertexMap.FindKey(index));
    points.push(toVec3FromGpPoint(oc.BRep_Tool.Pnt(vertex)));
  }

  vertexMap.delete();
  return points;
}

function selectNearestForwardProjection(
  candidates: Array<{ projection: number; source: string }>,
  tolerance: number,
  label: string,
) {
  const sortedCandidates = [...candidates].sort(
    (left, right) => left.projection - right.projection,
  );
  const nearest = sortedCandidates[0];

  if (!nearest) {
    return null;
  }

  const matchingSources = new Set(
    sortedCandidates
      .filter(
        (candidate) =>
          Math.abs(candidate.projection - nearest.projection) <= tolerance,
      )
      .map((candidate) => candidate.source),
  );

  if (matchingSources.size > 1) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: OCC ${label} termination is ambiguous between multiple bodies.`,
    );
  }

  return nearest.projection;
}

function getExtrudeTargetProjection(
  context: OccFeatureExecutionContext,
  end: ExtrudeEndCondition,
  direction: Vec3,
  startProjection: number,
) {
  if (end.kind === "upToNext") {
    const candidates = context.bodies
      .flatMap((body) => {
        const range = getShapeProjectionRange(
          context.oc,
          body.shape,
          direction,
        );
        return [
          { projection: range.min, source: body.bodyId },
          { projection: range.max, source: body.bodyId },
        ];
      })
      .filter(
        (candidate) =>
          candidate.projection > startProjection + context.modelingTolerance,
      );

    return selectNearestForwardProjection(
      candidates,
      context.modelingTolerance,
      "extrude up-to-next",
    );
  }

  if (end.kind === "upToFace") {
    const body = requireBody(context, end.target.bodyId);
    const face = requireFace(body, end.target.faceId);
    return getShapeProjectionRange(context.oc, face, direction).max;
  }

  if (end.kind === "upToPart") {
    const body = requireBody(context, end.target.bodyId);
    return getShapeProjectionRange(context.oc, body.shape, direction).max;
  }

  if (end.kind === "upToVertex") {
    const body = requireBody(context, end.target.bodyId);
    const vertex = body.verticesById.get(end.target.vertexId);
    if (!vertex) {
      throw new Error(
        `Vertex ${end.target.vertexId} does not resolve on body ${end.target.bodyId}.`,
      );
    }
    return dot(toVec3FromGpPoint(context.oc.BRep_Tool.Pnt(vertex)), direction);
  }

  return null;
}

function getThroughAllDistance(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  direction: Vec3,
) {
  const profileRange = getShapeProjectionRange(
    context.oc,
    profileShape,
    direction,
  );
  const targetMax = context.bodies.reduce((max, body) => {
    const range = getShapeProjectionRange(context.oc, body.shape, direction);
    return Math.max(max, range.max);
  }, profileRange.max);
  return Math.max(targetMax - profileRange.min + 10, 100);
}

function resolveExtrudeDistance(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  direction: Vec3,
  end: ExtrudeEndCondition,
) {
  if (end.kind === "blind") {
    const distance = end.distance as number;
    if (distance <= 0) {
      throw new Error("Extrude blind distance must be positive.");
    }
    return distance;
  }

  if (end.kind === "throughAll") {
    return getThroughAllDistance(context, profileShape, direction);
  }

  const profileRange = getShapeProjectionRange(
    context.oc,
    profileShape,
    direction,
  );
  const targetProjection = getExtrudeTargetProjection(
    context,
    end,
    direction,
    profileRange.max,
  );
  if (targetProjection === null) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC extrude up-to-next found no terminating geometry.",
    );
  }

  const offset = (end.offset?.distance ?? 0) as number;
  const signedOffset = end.offset?.direction === "extend" ? offset : -offset;
  const distance = targetProjection - profileRange.max + signedOffset;

  if (distance <= context.modelingTolerance) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC extrude termination is behind, coincident, or bypassed by offset.",
    );
  }

  return distance;
}

function buildExtrudeProfileShapes(
  context: OccFeatureExecutionContext,
  profile: ExtrudeFeatureParameters["profiles"][number],
  extent: ReturnType<typeof getExtrudeFeatureExtent>,
) {
  let profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  let baseNormal: Vec3;

  if (profile.kind === "region") {
    const sketch = requireSketchSnapshot(context, profile.sketchId);
    const region = requireRegion(sketch, profile.regionId);
    const profileFace = buildRegionProfileFace(
      context.oc,
      { plane: sketch.plane, sketch: sketch.sketch },
      region,
    );
    profileShape = profileFace.face;
    baseNormal = getExtrusionNormalForSketchProfile(
      profileFace.plane,
      "positive",
    );
  } else {
    const body = requireBody(context, profile.bodyId);
    const face = requireFace(body, profile.faceId);
    profileShape = face;
    baseNormal = getExtrusionNormalForPlanarFace(context.oc, face, "positive");
  }

  const ends: ExtrudeEndCondition[] =
    extent.mode === "twoSide"
      ? [extent.firstEnd, extent.secondEnd]
      : extent.mode === "symmetric"
        ? [
            extent.end,
            {
              ...extent.end,
              direction:
                extent.end.direction === "positive" ? "negative" : "positive",
            },
          ]
        : [extent.end];

  return ends.map((end) =>
    buildExtrudeEndShape(context, profileShape, baseNormal, end),
  );
}

function createPlaneFrameForNormal(origin: Vec3, normal: Vec3) {
  const unitNormal = normalize(normal);
  const seed: Vec3 = Math.abs(unitNormal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const xAxis = normalize(cross(seed, unitNormal));
  const yAxis = normalize(cross(unitNormal, xAxis));

  return {
    origin,
    xAxis,
    yAxis,
    normal: unitNormal,
    linearUnit: "documentLength" as const,
    handedness: "rightHanded" as const,
  };
}

function collectExtrudeDraftFaces(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  direction: Vec3,
  startProjection: number,
  distance: number,
  tolerance: number,
) {
  const faceMap = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    faceMap,
  );
  const faces: Array<InstanceType<OpenCascadeInstance["TopoDS_Face"]>> = [];
  const minSpan = Math.max(distance * 0.5, tolerance);

  for (let index = 1; index <= faceMap.Size(); index += 1) {
    const face = oc.TopoDS.Face_1(faceMap.FindKey(index));
    const range = getShapeProjectionRange(oc, face, direction);
    const spansExtrusion =
      range.max - range.min >= minSpan &&
      range.min <= startProjection + tolerance &&
      range.max >= startProjection + distance - tolerance;

    if (spansExtrusion) {
      faces.push(face);
    }
  }

  faceMap.delete();
  return faces;
}

function applyExtrudeDraft(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  direction: Vec3,
  startProjection: number,
  distance: number,
  draftAngle: number | undefined,
) {
  if (
    draftAngle === undefined ||
    Math.abs(draftAngle) <= context.modelingTolerance
  ) {
    return shape;
  }

  if (!Number.isFinite(draftAngle)) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC extrude draft angle must be finite.",
    );
  }

  const draftFaces = collectExtrudeDraftFaces(
    context.oc,
    shape,
    direction,
    startProjection,
    distance,
    context.modelingTolerance,
  );

  if (draftFaces.length === 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC extrude draft found no lateral faces to draft.",
    );
  }

  const neutralPlane = toGpPlane(
    context.oc,
    createPlaneFrameForNormal(scale(direction, startProjection), direction),
  );
  const draft = new context.oc.BRepOffsetAPI_DraftAngle_1();
  draft.Init(shape);

  for (const face of draftFaces) {
    draft.Add(
      face,
      toGpDir(context.oc, direction),
      draftAngle,
      neutralPlane,
      true,
    );

    if (!draft.AddDone()) {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC extrude draft could not add a lateral face.",
      );
    }
  }

  draft.Build(new context.oc.Message_ProgressRange_1());

  if (!draft.IsDone()) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC extrude draft build failed.",
    );
  }

  return draft.Shape();
}

function buildExtrudeEndShape(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  baseNormal: Vec3,
  end: ExtrudeEndCondition,
) {
  const extrusionDirection = normalize(
    end.direction === "positive" ? baseNormal : scale(baseNormal, -1),
  );
  const distance = resolveExtrudeDistance(
    context,
    profileShape,
    extrusionDirection,
    end,
  );
  const profileRange = getShapeProjectionRange(
    context.oc,
    profileShape,
    extrusionDirection,
  );

  const prism = new context.oc.BRepPrimAPI_MakePrism_1(
    profileShape,
    toGpVec(context.oc, scale(extrusionDirection, distance)),
    false,
    true,
  );

  prism.Build(new context.oc.Message_ProgressRange_1());

  if (!prism.IsDone()) {
    throw new Error("OCC extrude prism build failed.");
  }

  return applyExtrudeDraft(
    context,
    prism.Shape(),
    extrusionDirection,
    profileRange.max,
    distance,
    end.draftAngle as number | undefined,
  );
}

function buildExtrudeFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ExtrudeFeatureParameters,
) {
  if (parameters.startExtent.kind !== "profilePlane") {
    throw new Error("Extrude startExtent.kind must be profilePlane.");
  }

  const extent = getExtrudeFeatureExtent(parameters);

  const profileKeys = new Set<string>();
  for (const profile of parameters.profiles) {
    const key = getOccDurableRefKey(profile);
    if (profileKeys.has(key)) {
      throw new Error(
        "unsupported-profile-group: OCC extrude does not support duplicate profile references.",
      );
    }
    profileKeys.add(key);
  }

  const extrudedShapes = parameters.profiles.flatMap((profile) =>
    buildExtrudeProfileShapes(context, profile, extent),
  );

  if (extrudedShapes.length === 1) {
    return extrudedShapes[0]!;
  }

  const builder = new context.oc.BRep_Builder();
  const compound = new context.oc.TopoDS_Compound();
  builder.MakeCompound(compound);
  for (const shape of extrudedShapes) {
    builder.Add(compound, shape);
  }

  return compound;
}

export function executeExtrudeFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ExtrudeFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildExtrudeFeatureShape(context, parameters);
  const result = applyBooleanPolicy(
    context,
    ownerFeatureId,
    parameters.operation,
    parameters.booleanScope,
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
