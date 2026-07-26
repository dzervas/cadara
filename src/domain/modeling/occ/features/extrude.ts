import type {
  ExtrudeEndCondition,
  ExtrudeFeatureParameters,
  ExtrudeStartExtent,
} from "@/contracts/modeling/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import { getExtrudeFeatureExtent } from "@/contracts/modeling/feature-extents";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { mapSketchPointToWorld, type Vec3 } from "@/domain/modeling/occ/math";
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
  runInRebuildSlot,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  applyBooleanPolicy,
  projectFeatureSourceShapes,
  runBoolean,
  type OccFeatureSourceShapeMap,
} from "@/domain/modeling/occ/features/boolean-operations";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import type {
  OccTopologySourceKey,
  OccTopologyStageOutput,
} from "@/domain/modeling/occ/topology-stage";

interface BuiltExtrudeShape {
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
  sourceShapes: Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >,
  sourceKey: OccTopologySourceKey,
  shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
) {
  const shapes = sourceShapes.get(sourceKey) ?? [];
  appendUniqueShape(shapes, shape);
  sourceShapes.set(sourceKey, shapes);
}

function registerSourceShapes(
  sourceShapes: Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >,
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

function projectSourceShapesThroughHistory(
  oc: OpenCascadeInstance,
  sourceShapes: OccFeatureSourceShapeMap,
  historySource: {
    Modified(
      shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
    ): InstanceType<OpenCascadeInstance["TopTools_ListOfShape"]>;
    Generated(
      shape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
    ): InstanceType<OpenCascadeInstance["TopTools_ListOfShape"]>;
  },
) {
  const projected = new Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();

  for (const [sourceKey, candidates] of sourceShapes) {
    for (const candidate of candidates) {
      const evolved = [
        ...listOccShapes(oc, historySource.Modified(candidate)),
        ...listOccShapes(oc, historySource.Generated(candidate)),
      ];
      registerSourceShapes(
        projected,
        sourceKey,
        evolved.length > 0 ? evolved : [candidate],
      );
    }
    if (!projected.has(sourceKey)) {
      projected.set(sourceKey, []);
    }
  }

  return projected;
}

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
) {
  const sortedCandidates = [...candidates].sort(
    (left, right) => left.projection - right.projection,
  );
  const nearest = sortedCandidates[0];

  if (!nearest) {
    return null;
  }

  // Every candidate within `tolerance` of the nearest defines the same
  // termination plane, so terminating at `nearest.projection` is deterministic
  // even when several bodies contribute coincident faces there. "Up to next"
  // stops at the next face's plane; coincident faces from different bodies land
  // on that same plane and produce identical geometry, so this is not an
  // ambiguous selection (no nearest-geometry scoring or tolerance relaxation is
  // involved — the tolerance only identifies which candidates are coincident).
  return nearest.projection;
}

/**
 * Exact world position of an authored sketch point used as an up-to-vertex
 * terminator. The solved position wins when the solver produced one; otherwise
 * the authored position is already exact. No geometry is searched or
 * approximated.
 */
function resolveSketchPointWorldPosition(
  context: OccFeatureExecutionContext,
  target: { sketchId: string; pointId: string },
): Vec3 {
  const snapshot = requireSketchSnapshot(
    context,
    target.sketchId as Parameters<typeof requireSketchSnapshot>[1],
  );
  const solved = snapshot.sketch.solvedSnapshot.solvedPoints.find(
    (entry) => entry.pointId === target.pointId,
  );
  if (solved) {
    return mapSketchPointToWorld(snapshot.plane.frame, solved.solvedPosition);
  }
  const authored = snapshot.sketch.definition.points.find(
    (entry) => entry.pointId === target.pointId,
  );
  if (!authored) {
    throw new Error(
      `Sketch point ${target.pointId} does not resolve on sketch ${target.sketchId}.`,
    );
  }
  return mapSketchPointToWorld(snapshot.plane.frame, authored.position);
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

    return selectNearestForwardProjection(candidates);
  }

  if (end.kind === "upToFace") {
    const body = requireBody(context, end.target.bodyId);
    const face = requireFace(context, body, end.target.faceId);
    return getShapeProjectionRange(context.oc, face, direction).max;
  }

  if (end.kind === "upToPart") {
    const body = requireBody(context, end.target.bodyId);
    return getShapeProjectionRange(context.oc, body.shape, direction).max;
  }

  if (end.kind === "upToVertex") {
    if (end.target.kind === "sketchPoint") {
      return dot(resolveSketchPointWorldPosition(context, end.target), direction);
    }
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
    const distance = getAuthoredLiteralValue(end.distance) ?? 0;
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
  ownerFeatureId: FeatureId,
  profile: ExtrudeFeatureParameters["profiles"][number],
  profileSlot: number,
  extent: ReturnType<typeof getExtrudeFeatureExtent>,
  startExtent: ExtrudeStartExtent,
) {
  let profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  let baseNormal: Vec3;
  let sketchProvenance:
    | ReturnType<typeof buildRegionProfileFace>["provenance"]
    | null = null;
  let sketchId: string | null = null;

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
    sketchProvenance = profileFace.provenance;
    sketchId = profile.sketchId;
  } else {
    const body = requireBody(context, profile.bodyId);
    const face = requireFace(context, body, profile.faceId);
    profileShape = face;
    baseNormal = getExtrusionNormalForPlanarFace(context.oc, face, "positive");
  }

  const ends: Array<{ end: ExtrudeEndCondition; role: string }> =
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
                  extent.end.direction === "positive" ? "negative" : "positive",
              },
              role: "symmetric-second-end",
            },
          ]
        : [{ end: extent.end, role: "one-side-end" }];

  return ends.map(({ end, role }) =>
    buildExtrudeEndShape(context, {
      ownerFeatureId,
      profileShape,
      baseNormal,
      end,
      startExtent,
      profileSlot,
      endRole: role,
      sketchId,
      sketchProvenance,
      faceProfileKey:
        profile.kind === "face" ? getOccDurableRefKey(profile) : null,
    }),
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
  built: BuiltExtrudeShape,
  direction: Vec3,
  startProjection: number,
  distance: number,
  draftAngle: number | undefined,
): BuiltExtrudeShape {
  if (
    draftAngle === undefined ||
    Math.abs(draftAngle) <= context.modelingTolerance
  ) {
    return built;
  }

  if (!Number.isFinite(draftAngle)) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC extrude draft angle must be finite.",
    );
  }

  const draftFaces = collectExtrudeDraftFaces(
    context.oc,
    built.shape,
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
  draft.Init(built.shape);

  for (const face of draftFaces) {
    draft.Add(
      face,
      toGpDir(context.oc, direction),
      draftAngle,
      neutralPlane,
      true,
    );

    if (!draft.AddDone()) {
      deleteOccObject(draft);
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC extrude draft could not add a lateral face.",
      );
    }
  }

  draft.Build(new context.oc.Message_ProgressRange_1());

  if (!draft.IsDone()) {
    deleteOccObject(draft);
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC extrude draft build failed.",
    );
  }

  const shape = draft.Shape();
  const sourceShapes = projectSourceShapesThroughHistory(
    context.oc,
    built.sourceShapes,
    draft,
  );
  // Draft history is incomplete for edge and vertex roles in the current
  // binding. Mark every drafted source conservatively, then clear keys that
  // prove a final target after boolean composition below.
  const unsupportedSourceKeys = new Set([
    ...built.unsupportedSourceKeys,
    ...sourceShapes.keys(),
  ]);
  deleteOccObject(draft);

  return {
    shape,
    sourceShapes,
    unsupportedSourceKeys,
  };
}

/**
 * Signed displacement, along the extrude direction, from the profile plane to
 * the authored start plane. `profilePlane` never displaces. The offset forms
 * express Onshape's `startOffset` bounds exactly: a blind distance, or the plane
 * through an exact authored sketch point. Nothing is inferred from nearby
 * geometry.
 */
function resolveStartExtentOffset(
  context: OccFeatureExecutionContext,
  startExtent: ExtrudeStartExtent,
  profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>,
  direction: Vec3,
): number {
  if (startExtent.kind === "profilePlane") return 0;
  if (startExtent.kind === "blindOffset") {
    const distance = getAuthoredLiteralValue(startExtent.distance) ?? 0;
    if (!(distance > 0)) {
      throw new Error("Extrude start offset distance must be positive.");
    }
    return startExtent.direction === "positive" ? distance : -distance;
  }
  const point = resolveSketchPointWorldPosition(context, startExtent.target);
  const profileRange = getShapeProjectionRange(context.oc, profileShape, direction);
  return dot(point, direction) - profileRange.max;
}

/** Translate the profile onto the authored start plane before prismatic sweep. */
function translateProfileToStartPlane(
  context: OccFeatureExecutionContext,
  input: {
    profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    sketchProvenance:
      | ReturnType<typeof buildRegionProfileFace>["provenance"]
      | null;
    direction: Vec3;
    offset: number;
  },
) {
  const translation = new context.oc.gp_Trsf_1();
  translation.SetTranslation_1(
    toGpVec(context.oc, scale(input.direction, input.offset)),
  );
  const transform = new context.oc.BRepBuilderAPI_Transform_2(
    input.profileShape,
    translation,
    true,
  );
  transform.Build(new context.oc.Message_ProgressRange_1());
  if (!transform.IsDone()) {
    deleteOccObject(transform);
    throw new Error("OCC extrude start-plane transform failed.");
  }

  // Carry sketch provenance through the translation so start-offset extrudes
  // keep durable side-face/side-edge lineage exactly like unoffset ones.
  const sketchProvenance = input.sketchProvenance
    ? {
        ...input.sketchProvenance,
        edges: new Map(
          [...input.sketchProvenance.edges].map(([sourceKey, shape]) => [
            sourceKey,
            context.oc.TopoDS.Edge_1(transform.ModifiedShape(shape)),
          ]),
        ),
        vertices: new Map(
          [...input.sketchProvenance.vertices].map(([sourceKey, shape]) => [
            sourceKey,
            context.oc.TopoDS.Vertex_1(transform.ModifiedShape(shape)),
          ]),
        ),
      }
    : null;
  const profileShape = transform.Shape();
  deleteOccObject(transform);
  return { profileShape, sketchProvenance };
}
function buildExtrudeEndShape(
  context: OccFeatureExecutionContext,
  input: {
    ownerFeatureId: FeatureId;
    profileShape: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
    baseNormal: Vec3;
    end: ExtrudeEndCondition;
    startExtent: ExtrudeStartExtent;
    profileSlot: number;
    endRole: string;
    sketchId: string | null;
    sketchProvenance:
      | ReturnType<typeof buildRegionProfileFace>["provenance"]
      | null;
    faceProfileKey: string | null;
  },
): BuiltExtrudeShape {
  const extrusionDirection = normalize(
    input.end.direction === "positive"
      ? input.baseNormal
      : scale(input.baseNormal, -1),
  );
  // The start plane and the end distance are one extent decision: both are
  // resolved inside the same rebuild slot so an upstream edit to either the
  // start sketch point or the terminator rebuilds the prism live.
  const started = runInRebuildSlot("extent", () => {
    const startOffset = resolveStartExtentOffset(
      context,
      input.startExtent,
      input.profileShape,
      extrusionDirection,
    );
    const moved =
      startOffset === 0
        ? { profileShape: input.profileShape, sketchProvenance: input.sketchProvenance }
        : translateProfileToStartPlane(context, {
            profileShape: input.profileShape,
            sketchProvenance: input.sketchProvenance,
            direction: extrusionDirection,
            offset: startOffset,
          });
    return {
      ...moved,
      // Measured from the authored start plane, so an up-to terminator spans
      // start→terminator and a blind depth is the authored depth from start.
      distance: resolveExtrudeDistance(
        context,
        moved.profileShape,
        extrusionDirection,
        input.end,
      ),
    };
  });
  const profileShape = started.profileShape;
  const sketchProvenance = started.sketchProvenance;
  const distance = started.distance;
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
    deleteOccObject(prism);
    throw new Error("OCC extrude prism build failed.");
  }

  const sourceShapes = new Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();
  const unsupportedSourceKeys = new Set<OccTopologySourceKey>();
  const slotPrefix = `extrude:${input.ownerFeatureId}:profile:${input.profileSlot}:end:${input.endRole}`;

  registerSourceShape(
    sourceShapes,
    `${slotPrefix}:profile:first-face`,
    prism.FirstShape_1(),
  );
  registerSourceShape(
    sourceShapes,
    `${slotPrefix}:profile:last-face`,
    prism.LastShape_1(),
  );

  if (input.sketchId && sketchProvenance) {
    for (const [sourceKey, edge] of sketchProvenance.edges) {
      const prefix = `${slotPrefix}:sketch-entity:${input.sketchId}:${sourceKey}`;
      registerSourceShapes(
        sourceShapes,
        `${prefix}:generated-side-face`,
        listOccShapes(context.oc, prism.Generated(edge)),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:first-edge`,
        prism.FirstShape_2(edge),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:last-edge`,
        prism.LastShape_2(edge),
      );
    }

    for (const [sourceKey, vertex] of sketchProvenance.vertices) {
      const prefix = `${slotPrefix}:sketch-point:${input.sketchId}:${sourceKey}`;
      registerSourceShapes(
        sourceShapes,
        `${prefix}:generated-side-edge`,
        listOccShapes(context.oc, prism.Generated(vertex)),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:first-vertex`,
        prism.FirstShape_2(vertex),
      );
      registerSourceShape(
        sourceShapes,
        `${prefix}:last-vertex`,
        prism.LastShape_2(vertex),
      );
    }

    for (const unsupported of sketchProvenance.unsupportedSources) {
      unsupportedSourceKeys.add(
        `${slotPrefix}:sketch-source:${input.sketchId}:${unsupported.sourceKey}:unsupported-profile-history`,
      );
    }
  } else if (input.faceProfileKey) {
    sourceShapes.clear();
    unsupportedSourceKeys.add(
      `${slotPrefix}:face-profile:${input.faceProfileKey}:unsupported-profile-history`,
    );
  }

  try {
    return applyExtrudeDraft(
      context,
      {
        shape: prism.Shape(),
        sourceShapes,
        unsupportedSourceKeys,
      },
      extrusionDirection,
      profileRange.max,
      distance,
      input.end.draftAngle as number | undefined,
    );
  } finally {
    deleteOccObject(prism);
  }
}

export function buildExtrudeFeatureShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ExtrudeFeatureParameters,
): BuiltExtrudeShape {

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

  const extrudedShapes = parameters.profiles.flatMap((profile, profileSlot) =>
    buildExtrudeProfileShapes(
      context,
      ownerFeatureId,
      profile,
      profileSlot,
      extent,
      parameters.startExtent,
    ),
  );

  if (extrudedShapes.length === 1) {
    return extrudedShapes[0]!;
  }

  return fuseExtrudedShapes(context, extrudedShapes);
}

/**
 * Combine the per-profile / per-end prisms of one extrude into a single feature
 * shape.
 *
 * Onshape treats one extrude as one operation: lobes that touch (adjacent
 * regions, or the two halves of a symmetric/two-sided extent) become ONE solid,
 * and only genuinely disjoint lobes stay separate. A raw `TopoDS_Compound` of
 * the prisms cannot express that — it always reports one solid per lobe, which
 * later reads as a severed body. Fusing the lobes reproduces Onshape's
 * semantics exactly: the fuse of disjoint solids is still a compound of those
 * solids, so disjoint regions keep producing one body each.
 *
 * Stage lineage is preserved by projecting every prism source shape (FirstShape
 * / LastShape / Generated) through the fuse history, so profile faces, side
 * faces, and sketch-entity edges stay resolvable on the fused result.
 */
function fuseExtrudedShapes(
  context: OccFeatureExecutionContext,
  extrudedShapes: readonly BuiltExtrudeShape[],
): BuiltExtrudeShape {
  const first = extrudedShapes[0]!;
  let shape = first.shape;
  let sourceShapes = new Map<
    OccTopologySourceKey,
    InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[]
  >();
  for (const [sourceKey, shapes] of first.sourceShapes) {
    registerSourceShapes(sourceShapes, sourceKey, shapes);
  }
  const unsupportedSourceKeys = new Set(first.unsupportedSourceKeys);

  for (const next of extrudedShapes.slice(1)) {
    const result = runBoolean(context.oc, "join", shape, next.shape);
    for (const [sourceKey, shapes] of next.sourceShapes) {
      registerSourceShapes(sourceShapes, sourceKey, shapes);
    }
    sourceShapes = projectFeatureSourceShapes(
      context.oc,
      sourceShapes,
      result.historySources,
    );
    for (const sourceKey of next.unsupportedSourceKeys) {
      unsupportedSourceKeys.add(sourceKey);
    }
    shape = result.shape;
  }

  return { shape, sourceShapes, unsupportedSourceKeys };
}

export function executeExtrudeFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ExtrudeFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = runInRebuildSlot("profile", () =>
    buildExtrudeFeatureShape(context, ownerFeatureId, parameters),
  );
  const resolvedOperation = getAuthoredLiteralValue(parameters.operation);
  if (!resolvedOperation) {
    throw new Error("Extrude operation must be a resolved literal value.");
  }
  const result = runInRebuildSlot("scope", () =>
    applyBooleanPolicy(
      context,
      ownerFeatureId,
      resolvedOperation,
      parameters.booleanScope,
      featureShape.shape,
      { sourceShapes: featureShape.sourceShapes },
    ),
  );
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
