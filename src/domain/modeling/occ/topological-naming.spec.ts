import { test, expect } from "vitest";
import type {
  FeatureDefinition,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type {
  BodyId,
  ConstructionId,
  DimensionId,
  EdgeId,
  FaceId,
  FeatureId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import {
  SKETCH_SCHEMA_VERSION,
  SOLVED_SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from "@/contracts/sketch/schema";
import {
  OCC_KERNEL_CAPABILITIES,
  createStandardPlaneDefinition,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  rebuildOccAuthoringState,
  type OccAuthoringFeatureRecord,
  type OccAuthoringState,
} from "@/domain/modeling/occ/authoring-state";
import { extractPlanarFaceData } from "@/domain/modeling/occ/planes";
import { classifySemanticStageTopology } from "@/domain/modeling/occ/topology-naming";
import {
  getDefaultOpenCascadeInstance,
  type OpenCascadeInstance,
} from "@/domain/modeling/occ/runtime";
import { buildAxisFromLineEdge } from "@/domain/modeling/occ/sketch-profile";
import {
  OCC_REFERENCE_INVALIDATION_REASONS,
  resolveOccReference,
  type OccTrackedBody,
} from "@/domain/modeling/occ/topology";
import {
  createOccFeatureTopologyLineageMap,
  serializeOccFeatureTopologyLineage,
} from "@/domain/modeling/occ/topology-stage";
import { formatExtrudeProfileCapSourceKey } from "@/domain/modeling/occ/features/extrude";

function pointId(name: string) {
  return `sketch_point_${name}` as SketchPointId;
}

function entityId(name: string) {
  return `sketch_entity_${name}` as SketchEntityId;
}

function featureId(name: string) {
  return `feature_occ_limit_${name}` as FeatureId;
}

function bodyIdForFeature(id: FeatureId) {
  return `body_${id}` as BodyId;
}

function createOffsetPlane(
  constructionId: ConstructionId,
  origin: readonly [number, number, number],
): SketchPlaneDefinition {
  return {
    support: { kind: "construction", constructionId },
    frame: {
      origin,
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
    key: null,
  };
}

function createSketchDefinition(
  sketchId: SketchId,
  points: Array<{ id: SketchPointId; position: readonly [number, number] }>,
  entities: SketchDefinition["entities"],
): SketchDefinition {
  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: points.map((point) => point.id),
    points: points.map((point) => ({
      pointId: point.id,
      label: point.id,
      target: { kind: "sketchPoint", sketchId, pointId: point.id },
      position: point.position,
      isConstruction: false,
    })),
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };
}

function createSketchRecord(
  sketchId: SketchId,
  plane: SketchPlaneDefinition,
  definition: SketchDefinition,
  solvedEntities: SketchRecord["solvedSnapshot"]["solvedEntities"],
  regions: RegionRecord[],
): SketchSnapshotRecord {
  const sketch: SketchRecord = {
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: sketchId,
    planeSupport: plane.support,
    definition,
    solvedSnapshot: {
      schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
      status: {
        solveState: "solved",
        constraintState: "wellConstrained",
      },
      solvedEntities,
      solvedPoints: [],
      constraintStatuses: [],
      dimensionStatuses: [],
      diagnostics: [],
    },
    regions,
  };

  return {
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: sketchId,
    plane,
    planeTarget: plane.support,
    planeKey: plane.key,
    sketch,
  };
}

function createRectangleSketch(
  sketchId: SketchId,
  plane: SketchPlaneDefinition,
  options: {
    origin?: readonly [number, number];
    width?: number;
    height?: number;
  } = {},
) {
  const origin = options.origin ?? [0, 0];
  const width = options.width ?? 4;
  const height = options.height ?? 3;
  const points = [
    {
      id: pointId(`${sketchId}_bottom_left`),
      position: [origin[0], origin[1]] as const,
    },
    {
      id: pointId(`${sketchId}_bottom_right`),
      position: [origin[0] + width, origin[1]] as const,
    },
    {
      id: pointId(`${sketchId}_top_right`),
      position: [origin[0] + width, origin[1] + height] as const,
    },
    {
      id: pointId(`${sketchId}_top_left`),
      position: [origin[0], origin[1] + height] as const,
    },
  ];
  const entities = [
    {
      kind: "lineSegment" as const,
      entityId: entityId(`${sketchId}_bottom`),
      label: "bottom",
      target: {
        kind: "sketchEntity" as const,
        sketchId,
        entityId: entityId(`${sketchId}_bottom`),
      },
      isConstruction: false,
      startPointId: points[0]!.id,
      endPointId: points[1]!.id,
    },
    {
      kind: "lineSegment" as const,
      entityId: entityId(`${sketchId}_right`),
      label: "right",
      target: {
        kind: "sketchEntity" as const,
        sketchId,
        entityId: entityId(`${sketchId}_right`),
      },
      isConstruction: false,
      startPointId: points[1]!.id,
      endPointId: points[2]!.id,
    },
    {
      kind: "lineSegment" as const,
      entityId: entityId(`${sketchId}_top`),
      label: "top",
      target: {
        kind: "sketchEntity" as const,
        sketchId,
        entityId: entityId(`${sketchId}_top`),
      },
      isConstruction: false,
      startPointId: points[2]!.id,
      endPointId: points[3]!.id,
    },
    {
      kind: "lineSegment" as const,
      entityId: entityId(`${sketchId}_left`),
      label: "left",
      target: {
        kind: "sketchEntity" as const,
        sketchId,
        entityId: entityId(`${sketchId}_left`),
      },
      isConstruction: false,
      startPointId: points[3]!.id,
      endPointId: points[0]!.id,
    },
  ];
  const definition = createSketchDefinition(sketchId, points, entities);
  const regionId = `region_${sketchId}_outer` as const;
  const region: RegionRecord = {
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    regionId,
    label: regionId,
    target: { kind: "region", sketchId, regionId },
    sourceSketch: { kind: "sketch", sketchId },
    loops: [
      {
        loopId: `region_loop_${sketchId}_outer` as const,
        role: "outer",
        orientation: "counterClockwise",
        segments: entities.map((entity, index) => ({
          source: { kind: "entity" as const, entityId: entity.entityId },
          startPointId: points[index]!.id,
          endPointId: points[(index + 1) % points.length]!.id,
        })),
        boundaryPointIds: points.map((point) => point.id),
        isClosed: true,
      },
    ],
    isClosed: true,
  };
  const sketch = createSketchRecord(
    sketchId,
    plane,
    definition,
    [
      {
        kind: "lineSegment",
        entityId: entities[0]!.entityId,
        startPosition: [origin[0], origin[1]],
        endPosition: [origin[0] + width, origin[1]],
      },
      {
        kind: "lineSegment",
        entityId: entities[1]!.entityId,
        startPosition: [origin[0] + width, origin[1]],
        endPosition: [origin[0] + width, origin[1] + height],
      },
      {
        kind: "lineSegment",
        entityId: entities[2]!.entityId,
        startPosition: [origin[0] + width, origin[1] + height],
        endPosition: [origin[0], origin[1] + height],
      },
      {
        kind: "lineSegment",
        entityId: entities[3]!.entityId,
        startPosition: [origin[0], origin[1] + height],
        endPosition: [origin[0], origin[1]],
      },
    ],
    [region],
  );

  return { sketch, region };
}

function createDimensionedRectangleSketch(
  sketchId: SketchId,
  plane: SketchPlaneDefinition,
  width: number,
  height = 8,
) {
  const rectangle = createRectangleSketch(sketchId, plane, { width, height });
  const dimensionId = `dimension_${sketchId}_width` as DimensionId;
  const definition: SketchDefinition = {
    ...rectangle.sketch.sketch.definition,
    dimensionIds: [dimensionId],
    dimensions: [
      {
        dimensionId,
        kind: "distance",
        label: "Width",
        axis: "horizontal",
        pointIds: [
          pointId(`${sketchId}_bottom_left`),
          pointId(`${sketchId}_bottom_right`),
        ],
        value: width,
      },
    ],
  };

  return {
    ...rectangle,
    sketch: {
      ...rectangle.sketch,
      sketch: {
        ...rectangle.sketch.sketch,
        definition,
      },
    },
  };
}

function createTriangleTopologyEdit(
  sketchId: SketchId,
  plane: SketchPlaneDefinition,
) {
  const points = [
    { id: pointId(`${sketchId}_bottom_left`), position: [0, 0] as const },
    { id: pointId(`${sketchId}_top_right`), position: [10, 8] as const },
    { id: pointId(`${sketchId}_top_left`), position: [0, 8] as const },
  ];
  const entities = [
    {
      kind: "lineSegment" as const,
      entityId: entityId(`${sketchId}_diagonal`),
      label: "diagonal",
      target: {
        kind: "sketchEntity" as const,
        sketchId,
        entityId: entityId(`${sketchId}_diagonal`),
      },
      isConstruction: false,
      startPointId: points[0]!.id,
      endPointId: points[1]!.id,
    },
    {
      kind: "lineSegment" as const,
      entityId: entityId(`${sketchId}_top`),
      label: "top",
      target: {
        kind: "sketchEntity" as const,
        sketchId,
        entityId: entityId(`${sketchId}_top`),
      },
      isConstruction: false,
      startPointId: points[1]!.id,
      endPointId: points[2]!.id,
    },
    {
      kind: "lineSegment" as const,
      entityId: entityId(`${sketchId}_left`),
      label: "left",
      target: {
        kind: "sketchEntity" as const,
        sketchId,
        entityId: entityId(`${sketchId}_left`),
      },
      isConstruction: false,
      startPointId: points[2]!.id,
      endPointId: points[0]!.id,
    },
  ];
  const definition = createSketchDefinition(sketchId, points, entities);
  const regionId = `region_${sketchId}_outer` as const;
  const region: RegionRecord = {
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_0001",
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    regionId,
    label: regionId,
    target: { kind: "region", sketchId, regionId },
    sourceSketch: { kind: "sketch", sketchId },
    loops: [
      {
        loopId: `region_loop_${sketchId}_outer` as const,
        role: "outer",
        orientation: "counterClockwise",
        segments: entities.map((entity, index) => ({
          source: { kind: "entity" as const, entityId: entity.entityId },
          startPointId: points[index]!.id,
          endPointId: points[(index + 1) % points.length]!.id,
        })),
        boundaryPointIds: points.map((point) => point.id),
        isClosed: true,
      },
    ],
    isClosed: true,
  };

  return {
    sketch: createSketchRecord(
      sketchId,
      plane,
      definition,
      entities.map((entity, index) => ({
        kind: "lineSegment" as const,
        entityId: entity.entityId,
        startPosition: points[index]!.position,
        endPosition: points[(index + 1) % points.length]!.position,
      })),
      [region],
    ),
    region,
  };
}

async function rebuildAfterDimensionEdit(
  consumer: "fillet" | "chamfer" | "shell",
) {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId(`dimension_${consumer}_base`);
  const sketchId = `sketch_occ_dimension_${consumer}` as SketchId;
  const bodyId = bodyIdForFeature(baseFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const original = createDimensionedRectangleSketch(sketchId, plane, 10);
  const edited = createDimensionedRectangleSketch(sketchId, plane, 12);
  const initial = createOccAuthoringState(oc, { sketches: [original.sketch] });
  const baseFeature = {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(original.sketch, original.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const afterBase = applyFeature(initial, baseFeature);
  const baseBody = requireBody(afterBase, bodyId);
  const selectedTarget =
    consumer === "shell"
      ? ({
          kind: "face",
          bodyId,
          faceId: findPlanarFaceAtZ(oc, baseBody, 6),
        } as const)
      : ({
          kind: "edge",
          bodyId,
          edgeId: findEdgeByEndpoints(oc, baseBody, [10, 0, 0], [10, 0, 6]),
        } as const);
  const consumerFeature =
    selectedTarget.kind === "face"
      ? ({
          featureId: featureId("dimension_shell_consumer"),
          definition: createShellJoinDefinition(bodyId, selectedTarget.faceId),
          suppressed: false,
        } satisfies OccAuthoringFeatureRecord)
      : ({
          featureId: featureId(`dimension_${consumer}_consumer`),
          definition:
            consumer === "fillet"
              ? createFilletDefinition(bodyId, selectedTarget.edgeId)
              : createChamferDefinition(bodyId, selectedTarget.edgeId),
          suppressed: false,
        } satisfies OccAuthoringFeatureRecord);
  const afterConsumer = applyFeature(afterBase, consumerFeature);
  const editedState = {
    ...afterConsumer,
    sketches: [edited.sketch],
  };

  expect(
    original.sketch.sketch.definition.dimensions[0]?.dimensionId,
    "A dimension edit must retain the authored dimension identity.",
  ).toBe(edited.sketch.sketch.definition.dimensions[0]?.dimensionId);

  const rebuiltPrefix = rebuildOccAuthoringState(editedState, [baseFeature]);
  const editedBody = requireBody(rebuiltPrefix, bodyId);
  const semanticTargetId =
    selectedTarget.kind === "edge"
      ? findEdgeByEndpoints(oc, editedBody, [12, 0, 0], [12, 0, 6])
      : findPlanarFaceAtZ(oc, editedBody, 6);
  expect(
    semanticTargetId,
    "The old durable id must follow the same moving semantic target, not another surviving subshape.",
  ).toBe(
    selectedTarget.kind === "edge"
      ? selectedTarget.edgeId
      : selectedTarget.faceId,
  );
  const resolution = resolveOccReference(
    {
      documentId: rebuiltPrefix.documentId,
      revisionId: rebuiltPrefix.revisionId,
      referenceState: rebuiltPrefix.referenceState,
    },
    selectedTarget,
  );
  expect(
    resolution.resolution.invalidation,
    "The edited prefix must expose the authored subtopology reference as live.",
  ).toBe(null);

  return rebuildOccAuthoringState(editedState, [baseFeature, consumerFeature]);
}

function createExtrudeDefinition(
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
  distance: number,
  boolean:
    | {
        operation: "newBody";
        booleanScope: { kind: "standalone" };
      }
    | {
        operation: "join" | "cut";
        booleanScope: { kind: "targetBody"; bodyId: BodyId };
      },
): FeatureDefinition {
  return {
    kind: "extrude",
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "solid",
      profiles: [
        {
          kind: "region",
          sketchId: sketch.sketchId,
          regionId: region.regionId,
        },
      ],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: { kind: "blind", direction: "positive", distance },
      },
      operation: boolean.operation,
      booleanScope: boolean.booleanScope,
    },
  };
}

function createPlaneDefinition(
  bodyId: BodyId,
  faceId: FaceId,
): FeatureDefinition {
  return {
    kind: "plane",
    featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
    parameters: {
      mode: "coplanar",
      reference: {
        target: { kind: "face", bodyId, faceId },
      },
    },
  };
}

function createFilletDefinition(
  bodyId: BodyId,
  edgeId: EdgeId,
): FeatureDefinition {
  return {
    kind: "fillet",
    featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
    parameters: {
      radius: 0.25,
      edgeTargets: [{ kind: "edge", bodyId, edgeId }],
    },
  };
}

function createChamferDefinition(
  bodyId: BodyId,
  edgeId: EdgeId,
): FeatureDefinition {
  return {
    kind: "chamfer",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        { role: "edge", targets: [{ kind: "edge", bodyId, edgeId }] },
      ],
      options: {
        distance: 0.2,
      },
    },
  };
}

function createRotateTransformDefinition(
  bodyId: BodyId,
  angle: number,
): FeatureDefinition {
  return {
    kind: "transform",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        { role: "body", targets: [{ kind: "body", bodyId }] },
        {
          role: "axis",
          targets: [{ kind: "construction", constructionId: "construction_plane-xy" }],
        },
      ],
      options: { transformType: "rotation", angle },
    },
  };
}

function createShellJoinDefinition(
  bodyId: BodyId,
  removableFaceId: FaceId,
): FeatureDefinition {
  return {
    kind: "shell",
    featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
    parameters: {
      bodyTarget: { kind: "body", bodyId },
      faceTargets: [{ kind: "face", bodyId, faceId: removableFaceId }],
      thickness: 0.4,
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId },
    },
  };
}

function createThickenDefinition(
  bodyId: BodyId,
  faceId: FaceId,
): FeatureDefinition {
  return {
    kind: "thicken",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: "create",
      participants: [
        { role: "face", targets: [{ kind: "face", bodyId, faceId }] },
      ],
      options: { thickness: 0.5, side: "oneSide", direction: "positive" },
    },
  };
}

function applyFeature(
  state: OccAuthoringState,
  feature: OccAuthoringFeatureRecord,
) {
  return applyOccFeatureToAuthoringState(state, feature);
}

function requireBody(state: OccAuthoringState, bodyId: BodyId) {
  const body = state.bodies.find((entry) => entry.bodyId === bodyId);
  expect(body, `Expected body ${bodyId} to exist.`).toBeTruthy();
  return body;
}

function dot(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function findPlanarFaceAtZ(
  oc: OpenCascadeInstance,
  body: OccTrackedBody,
  z: number,
) {
  const faceId = body.topology.faceIds.find((candidate) => {
    const face = body.facesById.get(candidate);
    if (!face) {
      return false;
    }

    const plane = extractPlanarFaceData(oc, face);
    return (
      Math.abs(Math.abs(plane.frame.normal[2]) - 1) < 0.001 &&
      Math.abs(plane.frame.origin[2] - z) < 0.001
    );
  });

  expect(
    faceId,
    `Expected body ${body.bodyId} to expose a horizontal planar face at z=${z}.`,
  ).toBeTruthy();
  return faceId;
}

function findLinearEdgeByDirection(
  oc: OpenCascadeInstance,
  body: OccTrackedBody,
  direction: readonly [number, number, number],
) {
  const edgeId = body.topology.edgeIds.find((candidate) => {
    const edge = body.edgesById.get(candidate);
    if (!edge) {
      return false;
    }

    const axis = buildAxisFromLineEdge(oc, edge);
    const edgeDirection = [
      axis.Direction().X(),
      axis.Direction().Y(),
      axis.Direction().Z(),
    ] as const;

    return Math.abs(dot(edgeDirection, direction)) > 0.999;
  });

  expect(
    edgeId,
    `Expected body ${body.bodyId} to expose a linear edge in direction ${direction.join(",")}.`,
  ).toBeTruthy();
  return edgeId;
}

function pointCoordinates(point: { X(): number; Y(): number; Z(): number }) {
  return [point.X(), point.Y(), point.Z()] as const;
}

function distanceSquared(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return (
    (left[0] - right[0]) ** 2 +
    (left[1] - right[1]) ** 2 +
    (left[2] - right[2]) ** 2
  );
}

function pointNear(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return distanceSquared(left, right) < 0.000001;
}

function edgeHasEndpoints(
  oc: OpenCascadeInstance,
  edge: InstanceType<OpenCascadeInstance["TopoDS_Edge"]>,
  first: readonly [number, number, number],
  second: readonly [number, number, number],
) {
  const start = pointCoordinates(
    oc.BRep_Tool.Pnt(oc.TopExp.FirstVertex(edge, true)),
  );
  const end = pointCoordinates(
    oc.BRep_Tool.Pnt(oc.TopExp.LastVertex(edge, true)),
  );

  return (
    (pointNear(start, first) && pointNear(end, second)) ||
    (pointNear(start, second) && pointNear(end, first))
  );
}

function findEdgeByEndpoints(
  oc: OpenCascadeInstance,
  body: OccTrackedBody,
  first: readonly [number, number, number],
  second: readonly [number, number, number],
) {
  const edgeId = body.topology.edgeIds.find((candidate) => {
    const edge = body.edgesById.get(candidate);
    return edge ? edgeHasEndpoints(oc, edge, first, second) : false;
  });

  expect(
    edgeId,
    `Expected body ${body.bodyId} to expose an edge from ${first.join(",")} to ${second.join(",")}.`,
  ).toBeTruthy();
  return edgeId;
}

function findVertexAt(
  oc: OpenCascadeInstance,
  body: OccTrackedBody,
  position: readonly [number, number, number],
) {
  const vertexId = body.topology.vertexIds.find((candidate) => {
    const vertex = body.verticesById.get(candidate);
    return vertex
      ? pointNear(pointCoordinates(oc.BRep_Tool.Pnt(vertex)), position)
      : false;
  });

  expect(
    vertexId,
    `Expected body ${body.bodyId} to expose a vertex at ${position.join(",")}.`,
  ).toBeTruthy();
  return vertexId;
}

async function createBossAndRibFixture() {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("base_block");
  const bodyId = bodyIdForFeature(baseFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const topPlane = createOffsetPlane(
    "construction_occ_limit_top_face" as ConstructionId,
    [0, 0, 4],
  );
  const base = createRectangleSketch("sketch_occ_limit_base" as SketchId, xy, {
    width: 10,
    height: 8,
  });
  const boss = createRectangleSketch(
    "sketch_occ_limit_boss" as SketchId,
    topPlane,
    {
      origin: [2, 2],
      width: 3,
      height: 3,
    },
  );
  const rib = createRectangleSketch(
    "sketch_occ_limit_rib" as SketchId,
    topPlane,
    {
      origin: [0.5, 3.4],
      width: 9,
      height: 1.2,
    },
  );
  const initial = createOccAuthoringState(oc, {
    sketches: [base.sketch, boss.sketch, rib.sketch],
  });
  const baseFeature = {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 4, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  } satisfies OccAuthoringFeatureRecord;
  const bossFeature = {
    featureId: featureId("joined_boss"),
    definition: createExtrudeDefinition(boss.sketch, boss.region, 2, {
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId },
    }),
  } satisfies OccAuthoringFeatureRecord;
  const ribFeature = {
    featureId: featureId("joined_rib"),
    definition: createExtrudeDefinition(rib.sketch, rib.region, 1.25, {
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId },
    }),
  } satisfies OccAuthoringFeatureRecord;
  const afterBase = applyFeature(initial, baseFeature);
  const baseBody = requireBody(afterBase, bodyId);
  const bottomFaceId = findPlanarFaceAtZ(oc, baseBody, 0);
  const afterBoss = applyFeature(afterBase, bossFeature);
  const afterRib = applyFeature(afterBoss, ribFeature);

  return {
    bodyId,
    bottomFaceId,
    initial,
    features: [baseFeature, bossFeature, ribFeature],
    afterBase,
    afterRib,
  };
}

async function createSameDomainExtensionFixture() {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("same_domain_base");
  const bodyId = bodyIdForFeature(baseFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const base = createRectangleSketch(
    "sketch_occ_limit_same_domain" as SketchId,
    xy,
    {
      width: 4,
      height: 3,
    },
  );
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] });
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 5, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const baseBody = requireBody(afterBase, bodyId);
  const verticalEdgeId = findLinearEdgeByDirection(oc, baseBody, [0, 0, 1]);
  const afterSameDomainJoin = applyFeature(afterBase, {
    featureId: featureId("same_domain_join"),
    definition: createExtrudeDefinition(base.sketch, base.region, 8, {
      operation: "join",
      booleanScope: { kind: "targetBody", bodyId },
    }),
  });

  return {
    bodyId,
    verticalEdgeId,
    afterSameDomainJoin,
  };
}

function formatInvalidation(
  state: OccAuthoringState,
  target: { kind: "face"; bodyId: BodyId; faceId: FaceId },
) {
  const resolved = resolveOccReference(
    {
      documentId: state.documentId,
      revisionId: state.revisionId,
      referenceState: state.referenceState,
    },
    target,
  );

  return resolved.resolution.invalidation === null
    ? "live"
    : `${resolved.resolution.invalidation.reason} for ${resolved.resolution.invalidation.target.kind}`;
}

function createCombineDefinition(
  targetBodyId: BodyId,
  toolBodyId: BodyId,
): FeatureDefinition {
  return {
    kind: "combine",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      operationIntent: "add",
      participants: [
        {
          role: "targetBody",
          targets: [{ kind: "body", bodyId: targetBodyId }],
        },
        { role: "toolBody", targets: [{ kind: "body", bodyId: toolBodyId }] },
      ],
    },
  };
}

function createSplitDefinition(
  targetBodyId: BodyId,
  toolBodyId: BodyId,
): FeatureDefinition {
  return {
    kind: "split",
    featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
    parameters: {
      participants: [
        {
          role: "targetBody",
          targets: [{ kind: "body", bodyId: targetBodyId }],
        },
        { role: "toolBody", targets: [{ kind: "body", bodyId: toolBodyId }] },
      ],
    },
  };
}

test("proper naming should keep an untouched bottom face live after joined boss and rib booleans", async () => {
  const fixture = await createBossAndRibFixture();
  const resolved = resolveOccReference(
    {
      documentId: fixture.afterRib.documentId,
      revisionId: fixture.afterRib.revisionId,
      referenceState: fixture.afterRib.referenceState,
    },
    {
      kind: "face",
      bodyId: fixture.bodyId,
      faceId: fixture.bottomFaceId,
    },
  );

  expect(
    resolved.resolution.invalidation,
    `Expected the untouched bottom face to stay live after top-side joins; current result is ${formatInvalidation(
      fixture.afterRib,
      {
        kind: "face",
        bodyId: fixture.bodyId,
        faceId: fixture.bottomFaceId,
      },
    )}.`,
  ).toBe(null);
});

test("proper naming should allow a downstream plane to reference a pre-join unaffected face", async () => {
  const fixture = await createBossAndRibFixture();
  let thrownMessage: string | null = null;

  try {
    applyFeature(fixture.afterRib, {
      featureId: featureId("plane_from_old_bottom_face"),
      definition: createPlaneDefinition(fixture.bodyId, fixture.bottomFaceId),
    });
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : String(error);
  }

  expect(
    thrownMessage,
    `Expected a face-backed plane to resolve through boolean history, but the current adapter rejected it: ${thrownMessage}.`,
  ).toBe(null);
});

test("proper naming should carry a selected vertical edge through same-domain simplification", async () => {
  const fixture = await createSameDomainExtensionFixture();
  let thrownMessage: string | null = null;

  try {
    applyFeature(fixture.afterSameDomainJoin, {
      featureId: featureId("fillet_old_simplified_edge"),
      definition: createFilletDefinition(
        fixture.bodyId,
        fixture.verticalEdgeId,
      ),
    });
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : String(error);
  }

  expect(
    thrownMessage,
    `Expected the selected vertical edge to survive the simplified join for downstream fillet selection, but the current adapter rejected it: ${thrownMessage}.`,
  ).toBe(null);
});

test("proper naming should carry untouched edge and vertex references through chained fillet and chamfer operations", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("fillet_chamfer_base");
  const bodyId = bodyIdForFeature(baseFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const base = createRectangleSketch(
    "sketch_occ_limit_fillet_chamfer_base" as SketchId,
    xy,
    {
      width: 10,
      height: 8,
    },
  );
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] });
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const baseBody = requireBody(afterBase, bodyId);
  const stableEdgeId = findEdgeByEndpoints(
    oc,
    baseBody,
    [10, 8, 0],
    [10, 8, 6],
  );
  const stableVertexId = findVertexAt(oc, baseBody, [10, 8, 6]);
  const filletEdgeId = findEdgeByEndpoints(oc, baseBody, [0, 0, 0], [0, 0, 6]);
  const afterFillet = applyFeature(afterBase, {
    featureId: featureId("stress_fillet_first"),
    definition: createFilletDefinition(bodyId, filletEdgeId),
  });
  const chamferEdgeId = findEdgeByEndpoints(
    oc,
    requireBody(afterFillet, bodyId),
    [0, 8, 0],
    [0, 8, 6],
  );
  const afterChamfer = applyFeature(afterFillet, {
    featureId: featureId("stress_chamfer_second"),
    definition: createChamferDefinition(bodyId, chamferEdgeId),
  });
  const edgeResolved = resolveOccReference(
    {
      documentId: afterChamfer.documentId,
      revisionId: afterChamfer.revisionId,
      referenceState: afterChamfer.referenceState,
    },
    {
      kind: "edge",
      bodyId,
      edgeId: stableEdgeId,
    },
  );
  const vertexResolved = resolveOccReference(
    {
      documentId: afterChamfer.documentId,
      revisionId: afterChamfer.revisionId,
      referenceState: afterChamfer.referenceState,
    },
    {
      kind: "vertex",
      bodyId,
      vertexId: stableVertexId,
    },
  );

  expect(
    edgeResolved.resolution.invalidation,
    `Expected untouched edge to stay live through chained fillet/chamfer operations, got ${edgeResolved.resolution.invalidation?.reason}.`,
  ).toBe(null);
  expect(
    vertexResolved.resolution.invalidation,
    `Expected untouched vertex to stay live through chained fillet/chamfer operations, got ${vertexResolved.resolution.invalidation?.reason}.`,
  ).toBe(null);
});

test("proper naming should allow an old edge id to drive a downstream fillet after chained fillet and chamfer operations", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("downstream_old_edge_base");
  const bodyId = bodyIdForFeature(baseFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const base = createRectangleSketch(
    "sketch_occ_limit_downstream_old_edge" as SketchId,
    xy,
    {
      width: 10,
      height: 8,
    },
  );
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] });
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const baseBody = requireBody(afterBase, bodyId);
  const downstreamEdgeId = findEdgeByEndpoints(
    oc,
    baseBody,
    [10, 8, 0],
    [10, 8, 6],
  );
  const firstFilletEdgeId = findEdgeByEndpoints(
    oc,
    baseBody,
    [0, 0, 0],
    [0, 0, 6],
  );
  const afterFillet = applyFeature(afterBase, {
    featureId: featureId("old_edge_first_fillet"),
    definition: createFilletDefinition(bodyId, firstFilletEdgeId),
  });
  const chamferEdgeId = findEdgeByEndpoints(
    oc,
    requireBody(afterFillet, bodyId),
    [0, 8, 0],
    [0, 8, 6],
  );
  const afterChamfer = applyFeature(afterFillet, {
    featureId: featureId("old_edge_second_chamfer"),
    definition: createChamferDefinition(bodyId, chamferEdgeId),
  });
  let thrownMessage: string | null = null;

  try {
    applyFeature(afterChamfer, {
      featureId: featureId("old_edge_downstream_fillet"),
      definition: createFilletDefinition(bodyId, downstreamEdgeId),
    });
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : String(error);
  }

  expect(
    thrownMessage,
    `Expected old edge id to resolve for downstream fillet after chained fillet/chamfer operations, got ${thrownMessage}.`,
  ).toBe(null);
});

test("proper naming should keep untouched edge and vertex references live through shell replacement", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("shell_stress_base");
  const bodyId = bodyIdForFeature(baseFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const base = createRectangleSketch(
    "sketch_occ_limit_shell_stress" as SketchId,
    xy,
    {
      width: 10,
      height: 8,
    },
  );
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] });
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const baseBody = requireBody(afterBase, bodyId);
  const stableEdgeId = findEdgeByEndpoints(
    oc,
    baseBody,
    [10, 8, 0],
    [10, 8, 6],
  );
  const stableVertexId = findVertexAt(oc, baseBody, [10, 8, 6]);
  const removableFaceId = findPlanarFaceAtZ(oc, baseBody, 6);
  const afterShell = applyFeature(afterBase, {
    featureId: featureId("shell_join_replacement"),
    definition: createShellJoinDefinition(bodyId, removableFaceId),
  });
  const edgeResolved = resolveOccReference(
    {
      documentId: afterShell.documentId,
      revisionId: afterShell.revisionId,
      referenceState: afterShell.referenceState,
    },
    {
      kind: "edge",
      bodyId,
      edgeId: stableEdgeId,
    },
  );
  const vertexResolved = resolveOccReference(
    {
      documentId: afterShell.documentId,
      revisionId: afterShell.revisionId,
      referenceState: afterShell.referenceState,
    },
    {
      kind: "vertex",
      bodyId,
      vertexId: stableVertexId,
    },
  );

  expect(
    edgeResolved.resolution.invalidation,
    `Expected untouched edge to stay live through shell replacement, got ${edgeResolved.resolution.invalidation?.reason}.`,
  ).toBe(null);
  expect(
    vertexResolved.resolution.invalidation,
    `Expected untouched vertex to stay live through shell replacement, got ${vertexResolved.resolution.invalidation?.reason}.`,
  ).toBe(null);
});

test("durable naming qualification conservatively invalidates rebuilt unsupported thicken topology", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("thicken_seed_base");
  const thickenFeatureId = featureId("thicken_stress");
  const sourceBodyId = bodyIdForFeature(baseFeatureId);
  const thickenedBodyId = bodyIdForFeature(thickenFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const base = createRectangleSketch(
    "sketch_occ_limit_thicken_stress" as SketchId,
    xy,
    {
      width: 10,
      height: 8,
    },
  );
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] });
  const baseFeature = {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  } as const;
  const afterBase = applyFeature(initial, baseFeature);
  const sourceTopFaceId = findPlanarFaceAtZ(
    oc,
    requireBody(afterBase, sourceBodyId),
    6,
  );
  const thickenFeature = {
    featureId: thickenFeatureId,
    definition: createThickenDefinition(sourceBodyId, sourceTopFaceId),
  } as const;
  const afterThicken = applyFeature(afterBase, thickenFeature);
  const thickenedBody = requireBody(afterThicken, thickenedBodyId);
  const stableEdgeId = findEdgeByEndpoints(
    oc,
    thickenedBody,
    [10, 8, 6],
    [10, 8, 6.5],
  );
  const stableVertexId = findVertexAt(oc, thickenedBody, [10, 8, 6.5]);
  expect(
    afterThicken.featureTopologyStages
      .get(thickenFeatureId)
      ?.outputs.get(thickenedBodyId)?.sourceTargets.size,
    "Thicken must publish an explicit conservative stage until complete prism/face lineage is implemented.",
  ).toBe(0);
  const rebuiltThicken = rebuildOccAuthoringState(afterThicken, [
    baseFeature,
    thickenFeature,
  ]);
  const rebuiltThickenEdge = resolveOccReference(
    {
      documentId: rebuiltThicken.documentId,
      revisionId: rebuiltThicken.revisionId,
      referenceState: rebuiltThicken.referenceState,
    },
    { kind: "edge", bodyId: thickenedBodyId, edgeId: stableEdgeId },
  );
  expect(
    rebuiltThickenEdge.resolution.invalidation?.reason,
    "A rebuilt thicken must invalidate prior topology instead of silently re-enumerating it.",
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory);
  const filletEdgeId = findEdgeByEndpoints(
    oc,
    thickenedBody,
    [0, 0, 6],
    [0, 0, 6.5],
  );
  const afterFillet = applyFeature(afterThicken, {
    featureId: featureId("thicken_stress_fillet"),
    definition: createFilletDefinition(thickenedBodyId, filletEdgeId),
  });
  const chamferEdgeId = findEdgeByEndpoints(
    oc,
    requireBody(afterFillet, thickenedBodyId),
    [0, 8, 6],
    [0, 8, 6.5],
  );
  const afterChamfer = applyFeature(afterFillet, {
    featureId: featureId("thicken_stress_chamfer"),
    definition: createChamferDefinition(thickenedBodyId, chamferEdgeId),
  });
  const edgeResolved = resolveOccReference(
    {
      documentId: afterChamfer.documentId,
      revisionId: afterChamfer.revisionId,
      referenceState: afterChamfer.referenceState,
    },
    {
      kind: "edge",
      bodyId: thickenedBodyId,
      edgeId: stableEdgeId,
    },
  );
  const vertexResolved = resolveOccReference(
    {
      documentId: afterChamfer.documentId,
      revisionId: afterChamfer.revisionId,
      referenceState: afterChamfer.referenceState,
    },
    {
      kind: "vertex",
      bodyId: thickenedBodyId,
      vertexId: stableVertexId,
    },
  );

  expect(
    edgeResolved.resolution.invalidation,
    `Expected thicken-produced edge to stay live through chained edits, got ${edgeResolved.resolution.invalidation?.reason}.`,
  ).toBe(null);
  expect(
    vertexResolved.resolution.invalidation,
    `Expected thicken-produced vertex to stay live through chained edits, got ${vertexResolved.resolution.invalidation?.reason}.`,
  ).toBe(null);
});

test("rigid transform rebuild keeps downstream chamfer target live via native aliases", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("transform_chamfer_base");
  const sketchId = "sketch_transform_chamfer" as SketchId;
  const bodyId = bodyIdForFeature(baseFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const rectangle = createRectangleSketch(sketchId, plane, {
    width: 4,
    height: 3,
  });
  const initial = createOccAuthoringState(oc, { sketches: [rectangle.sketch] });
  const baseFeature = {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(rectangle.sketch, rectangle.region, 2, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const afterBase = applyFeature(initial, baseFeature);
  const transformFeature = {
    featureId: featureId("transform_chamfer_rotate"),
    definition: createRotateTransformDefinition(bodyId, 90),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const afterTransform = applyFeature(afterBase, transformFeature);
  const transformOutput = afterTransform.featureTopologyStages
    .get(transformFeature.featureId)
    ?.outputs.get(bodyId);
  const selectedEdgeId = [...(transformOutput?.sourceTargets.values() ?? [])]
    .flat()
    .find((target) => target.kind === "edge")?.edgeId;
  if (!selectedEdgeId) {
    expect(transformOutput?.sourceTargets.size ?? 0).toBe(0);
    return;
  }
  const chamferFeature = {
    featureId: featureId("transform_chamfer_consumer"),
    definition: createChamferDefinition(bodyId, selectedEdgeId!),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const authored = applyFeature(afterTransform, chamferFeature);
  const editedTransform = {
    ...transformFeature,
    definition: createRotateTransformDefinition(bodyId, 45),
  } satisfies OccAuthoringFeatureRecord;
  const rebuiltPrefix = rebuildOccAuthoringState(authored, [
    baseFeature,
    editedTransform,
  ]);
  const rebuiltBody = requireBody(rebuiltPrefix, bodyId);
  expect(rebuiltBody.topology.edgeIds).toContain(selectedEdgeId!);
  expect(
    resolveOccReference(
      {
        documentId: rebuiltPrefix.documentId,
        revisionId: rebuiltPrefix.revisionId,
        referenceState: rebuiltPrefix.referenceState,
      },
      { kind: "edge", bodyId, edgeId: selectedEdgeId! },
    ).resolution.invalidation,
  ).toBe(null);

  const rebuilt = rebuildOccAuthoringState(authored, [
    baseFeature,
    editedTransform,
    chamferFeature,
  ]);
  expect(requireBody(rebuilt, bodyId).topology.edgeIds.length).toBeGreaterThan(0);
});
test("proper naming should keep stable references live after an authored rebuild", async () => {
  const fixture = await createBossAndRibFixture();
  const rebuilt = rebuildOccAuthoringState(fixture.initial, fixture.features);
  const resolved = resolveOccReference(
    {
      documentId: rebuilt.documentId,
      revisionId: rebuilt.revisionId,
      referenceState: rebuilt.referenceState,
    },
    {
      kind: "face",
      bodyId: fixture.bodyId,
      faceId: fixture.bottomFaceId,
    },
  );

  expect(
    resolved.resolution.invalidation,
    `Expected rebuilt authored history to preserve the bottom face reference, got ${resolved.resolution.invalidation?.reason}.`,
  ).toBe(null);
}, 15000);

test("proper naming should report a deleted-topology diagnostic for a cut-away face", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("deleted_cut_base");
  const bodyId = bodyIdForFeature(baseFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const base = createRectangleSketch(
    "sketch_occ_limit_deleted_cut" as SketchId,
    xy,
    {
      width: 4,
      height: 3,
    },
  );
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] });
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 4, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const removedFaceId = findPlanarFaceAtZ(
    oc,
    requireBody(afterBase, bodyId),
    0,
  );
  const afterCut = applyFeature(afterBase, {
    featureId: featureId("deleted_cut"),
    definition: createExtrudeDefinition(base.sketch, base.region, 4, {
      operation: "cut",
      booleanScope: { kind: "targetBody", bodyId },
    }),
  });
  const resolved = resolveOccReference(
    {
      documentId: afterCut.documentId,
      revisionId: afterCut.revisionId,
      referenceState: afterCut.referenceState,
    },
    {
      kind: "face",
      bodyId,
      faceId: removedFaceId,
    },
  );

  expect(
    resolved.resolution.invalidation?.reason,
    `Expected cut-away face to be invalidated as deleted topology, got ${resolved.resolution.invalidation?.reason}.`,
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted);
  expect(
    resolved.diagnostics[0]?.detail?.kind,
    "Deleted topology must surface a structured invalid-reference diagnostic.",
  ).toBe("invalidReference");
});

test("proper naming should report an ambiguous-topology diagnostic for split successors", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const targetFeatureId = featureId("split_target");
  const toolFeatureId = featureId("split_tool");
  const targetBodyId = bodyIdForFeature(targetFeatureId);
  const toolBodyId = bodyIdForFeature(toolFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const target = createRectangleSketch(
    "sketch_occ_limit_split_target" as SketchId,
    xy,
    {
      width: 6,
      height: 4,
    },
  );
  const tool = createRectangleSketch(
    "sketch_occ_limit_split_tool" as SketchId,
    xy,
    {
      origin: [2, 0],
      width: 2,
      height: 4,
    },
  );
  const initial = createOccAuthoringState(oc, {
    sketches: [target.sketch, tool.sketch],
  });
  const afterTarget = applyFeature(initial, {
    featureId: targetFeatureId,
    definition: createExtrudeDefinition(target.sketch, target.region, 4, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const selectedFaceId = findPlanarFaceAtZ(
    oc,
    requireBody(afterTarget, targetBodyId),
    4,
  );
  const afterTool = applyFeature(afterTarget, {
    featureId: toolFeatureId,
    definition: createExtrudeDefinition(tool.sketch, tool.region, 4, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const afterSplit = applyFeature(afterTool, {
    featureId: featureId("split_feature"),
    definition: createSplitDefinition(targetBodyId, toolBodyId),
  });
  const resolved = resolveOccReference(
    {
      documentId: afterSplit.documentId,
      revisionId: afterSplit.revisionId,
      referenceState: afterSplit.referenceState,
    },
    {
      kind: "face",
      bodyId: targetBodyId,
      faceId: selectedFaceId,
    },
  );

  expect(
    resolved.resolution.invalidation?.reason,
    `Expected split face reference to be invalidated as ambiguous topology, got ${resolved.resolution.invalidation?.reason}.`,
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous);
});

test("proper naming should invalidate consumed Combine tool-body topology", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const targetFeatureId = featureId("combine_target");
  const toolFeatureId = featureId("combine_tool");
  const targetBodyId = bodyIdForFeature(targetFeatureId);
  const toolBodyId = bodyIdForFeature(toolFeatureId);
  const xy = createStandardPlaneDefinition("xy");
  const target = createRectangleSketch(
    "sketch_occ_limit_combine_target" as SketchId,
    xy,
    {
      width: 4,
      height: 4,
    },
  );
  const tool = createRectangleSketch(
    "sketch_occ_limit_combine_tool" as SketchId,
    xy,
    {
      origin: [2, 1],
      width: 3,
      height: 2,
    },
  );
  const initial = createOccAuthoringState(oc, {
    sketches: [target.sketch, tool.sketch],
  });
  const afterTarget = applyFeature(initial, {
    featureId: targetFeatureId,
    definition: createExtrudeDefinition(target.sketch, target.region, 3, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const afterTool = applyFeature(afterTarget, {
    featureId: toolFeatureId,
    definition: createExtrudeDefinition(tool.sketch, tool.region, 3, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const toolFaceId = requireBody(afterTool, toolBodyId).topology.faceIds[0];
  expect(
    toolFaceId,
    "Tool body must expose a face before Combine.",
  ).toBeTruthy();
  const afterCombine = applyFeature(afterTool, {
    featureId: featureId("combine_add"),
    definition: createCombineDefinition(targetBodyId, toolBodyId),
  });
  const resolved = resolveOccReference(
    {
      documentId: afterCombine.documentId,
      revisionId: afterCombine.revisionId,
      referenceState: afterCombine.referenceState,
    },
    {
      kind: "face",
      bodyId: toolBodyId,
      faceId: toolFaceId,
    },
  );

  expect(
    resolved.resolution.invalidation?.reason,
    `Expected consumed tool-body face to be invalidated as deleted topology, got ${resolved.resolution.invalidation?.reason}.`,
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted);
  expect(
    afterCombine.bodies.some((body) => body.bodyId === toolBodyId),
    "Consumed Combine tool body must not remain live after add.",
  ).toBeFalsy();
});

test("durable naming qualification preserves a moving fillet edge through a dimension-only sketch edit", async () => {
  const rebuilt = await rebuildAfterDimensionEdit("fillet");
  expect(rebuilt.features.at(-1)?.definition.kind).toBe("fillet");
}, 15000);

test("durable naming qualification preserves a moving chamfer edge through a dimension-only sketch edit", async () => {
  const rebuilt = await rebuildAfterDimensionEdit("chamfer");
  expect(rebuilt.features.at(-1)?.definition.kind).toBe("chamfer");
}, 15000);

test("durable naming qualification pins exact semantic zero, one, and many successor outcomes", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("extrude_stage_semantic_provenance");
  const sketchId = "sketch_occ_extrude_stage_semantic" as SketchId;
  const bodyId = bodyIdForFeature(baseFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const original = createDimensionedRectangleSketch(sketchId, plane, 10);
  const dimensionEdited = createDimensionedRectangleSketch(sketchId, plane, 12);
  const topologyEdited = createTriangleTopologyEdit(sketchId, plane);
  const baseFeature = {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(original.sketch, original.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const authored = applyFeature(
    createOccAuthoringState(oc, { sketches: [original.sketch] }),
    baseFeature,
  );
  const sourceKey = [
    ...authored.featureTopologyStages
      .get(baseFeatureId)!
      .outputs.get(bodyId)!
      .sourceTargets.keys(),
  ].find(
    (key) =>
      key.includes(
        `sketch-point:${sketchId}:${pointId(`${sketchId}_bottom_right`)}`,
      ) && key.endsWith(":generated-side-edge"),
  );
  expect(
    sourceKey,
    "The original rectangle stage should key its vertical edge by the authored bottom-right sketch point.",
  ).toBeTruthy();
  const originalOutput = authored.featureTopologyStages
    .get(baseFeatureId)!
    .outputs.get(bodyId)!;
  const originalTarget = originalOutput.sourceTargets.get(sourceKey!)?.[0];
  expect(originalTarget?.kind).toBe("edge");
  const capSourceKey = formatExtrudeProfileCapSourceKey({
    ownerFeatureId: baseFeatureId,
    regionId: original.region.regionId,
    endRole: "one-side-end",
    cap: "last",
  });
  const originalCapTarget = originalOutput.sourceTargets.get(capSourceKey)?.[0];
  expect(
    originalCapTarget?.kind,
    "The profile cap must be claimed from the persisted authored RegionId.",
  ).toBe("face");

  const dimensionRebuilt = rebuildOccAuthoringState(
    { ...authored, sketches: [dimensionEdited.sketch] },
    [baseFeature],
  );
  const dimensionTargets = dimensionRebuilt.featureTopologyStages
    .get(baseFeatureId)!
    .outputs.get(bodyId)!
    .sourceTargets.get(sourceKey!);
  expect(
    dimensionTargets?.length,
    "A dimension-only edit should retain exactly one successor for the same semantic prism role.",
  ).toBe(1);
  expect(
    dimensionTargets?.[0],
    "A proved one-to-one semantic successor should retain the old public topology ID.",
  ).toEqual(originalTarget);
  const dimensionCapTargets = dimensionRebuilt.featureTopologyStages
    .get(baseFeatureId)!
    .outputs.get(bodyId)!
    .sourceTargets.get(capSourceKey);
  expect(
    dimensionCapTargets?.length,
    "A geometry-changing dimension rebuild must retain one RegionId-owned cap claim.",
  ).toBe(1);
  expect(
    dimensionCapTargets?.[0],
    "A geometry-changing dimension rebuild must retain the cap's public face from its RegionId claim.",
  ).toEqual(originalCapTarget);

  const topologyRebuilt = rebuildOccAuthoringState(
    { ...authored, sketches: [topologyEdited.sketch] },
    [baseFeature],
  );
  const topologyTargets = topologyRebuilt.featureTopologyStages
    .get(baseFeatureId)!
    .outputs.get(bodyId)!
    .sourceTargets.get(sourceKey!);
  expect(
    topologyTargets,
    "Removing the authored bottom-right sketch point should yield zero semantic successors, not a traversal replacement.",
  ).toBeUndefined();
  if (originalTarget?.kind !== "edge") {
    throw new Error(
      "Expected the semantic prism source to resolve to an edge.",
    );
  }
  const deletedResolution = resolveOccReference(
    {
      documentId: topologyRebuilt.documentId,
      revisionId: topologyRebuilt.revisionId,
      referenceState: topologyRebuilt.referenceState,
    },
    originalTarget,
  );
  expect(deletedResolution.resolution.invalidation?.reason).toBe(
    OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
  );
  expect(deletedResolution.diagnostics[0]?.detail?.kind).toBe(
    "invalidReference",
  );

  const freshOutput = dimensionRebuilt.featureTopologyStages
    .get(baseFeatureId)!
    .outputs.get(bodyId)!;
  const twoFreshEdges = freshOutput.body.topology.edgeIds
    .slice(0, 2)
    .map((edgeId) => ({ kind: "edge" as const, bodyId, edgeId }));
  const ambiguous = classifySemanticStageTopology({
    previous: originalOutput,
    current: {
      ...freshOutput,
      sourceTargets: new Map(freshOutput.sourceTargets).set(
        sourceKey!,
        twoFreshEdges,
      ),
    },
  });
  expect(
    ambiguous.invalidations.get(`edge:${bodyId}:${originalTarget.edgeId}`)
      ?.reason,
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous);

  const unsupported = classifySemanticStageTopology({
    previous: originalOutput,
    current: {
      ...freshOutput,
      unsupportedSourceKeys: new Set([sourceKey!]),
    },
  });
  expect(
    unsupported.invalidations.get(`edge:${bodyId}:${originalTarget.edgeId}`)
      ?.reason,
  ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyUnsupportedHistory);
}, 15000);

test("durable naming qualification keeps coincident delete and recreate invalid without stage proof", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("fresh_id_resurrection_base");
  const sketchId = "sketch_occ_fresh_id_resurrection" as SketchId;
  const bodyId = bodyIdForFeature(baseFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const rectangle = createDimensionedRectangleSketch(sketchId, plane, 10);
  const baseFeature = {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(rectangle.sketch, rectangle.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const authored = applyFeature(
    createOccAuthoringState(oc, { sketches: [rectangle.sketch] }),
    baseFeature,
  );
  const deletedEdgeId = requireBody(authored, bodyId).topology.edgeIds[0]!;
  const deleted = rebuildOccAuthoringState(authored, []);
  const recreated = rebuildOccAuthoringState(deleted, [baseFeature]);

  expect(
    requireBody(recreated, bodyId).topology.edgeIds,
    "A recreated body should exercise the exact fresh public-ID collision.",
  ).toContain(deletedEdgeId);

  const target = { kind: "edge" as const, bodyId, edgeId: deletedEdgeId };
  const resolution = resolveOccReference(
    {
      documentId: recreated.documentId,
      revisionId: recreated.revisionId,
      referenceState: recreated.referenceState,
    },
    target,
  );
  expect(resolution.resolution.invalidation?.reason).toBe(
    OCC_REFERENCE_INVALIDATION_REASONS.missing,
  );
  expect(resolution.diagnostics[0]?.detail?.kind).toBe("invalidReference");

  expect(() =>
    applyFeature(recreated, {
      featureId: featureId("fresh_id_resurrection_fillet"),
      definition: createFilletDefinition(bodyId, deletedEdgeId),
      suppressed: false,
    }),
  ).toThrow(/occ-invalid-reference.*occ-missing-reference/);

  const persistedLineage = serializeOccFeatureTopologyLineage(
    authored.featureTopologyStages,
    new Map(),
    new Set([baseFeatureId]),
  );
  const restored = applyFeature(
    createOccAuthoringState(oc, {
      sketches: [rectangle.sketch],
      previousFeatureTopologyLineage:
        createOccFeatureTopologyLineageMap(persistedLineage),
    }),
    baseFeature,
  );
  const restoredDeletedEdgeId = requireBody(restored, bodyId).topology.edgeIds[0]!;
  const restoredRecreated = rebuildOccAuthoringState(
    rebuildOccAuthoringState(restored, []),
    [baseFeature],
  );
  const restoredResolution = resolveOccReference(
    {
      documentId: restoredRecreated.documentId,
      revisionId: restoredRecreated.revisionId,
      referenceState: restoredRecreated.referenceState,
    },
    { kind: "edge", bodyId, edgeId: restoredDeletedEdgeId },
  );
  expect(restoredResolution.resolution.invalidation?.reason).toBe(
    OCC_REFERENCE_INVALIDATION_REASONS.missing,
  );
}, 15000);

test("durable naming qualification invalidates an edge deleted by an upstream sketch topology edit instead of silently remapping", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("qualification_sketch_deleted_edge_base");
  const sketchId = "sketch_occ_qualification_deleted_profile_edge" as SketchId;
  const bodyId = bodyIdForFeature(baseFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const original = createDimensionedRectangleSketch(sketchId, plane, 10);
  const edited = createTriangleTopologyEdit(sketchId, plane);
  const initial = createOccAuthoringState(oc, { sketches: [original.sketch] });
  const baseFeature = {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(original.sketch, original.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const afterBase = applyFeature(initial, baseFeature);
  const deletedEdgeId = findEdgeByEndpoints(
    oc,
    requireBody(afterBase, bodyId),
    [10, 0, 0],
    [10, 0, 6],
  );
  const filletFeature = {
    featureId: featureId("qualification_sketch_deleted_edge_fillet"),
    definition: createFilletDefinition(bodyId, deletedEdgeId),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const authored = applyFeature(afterBase, filletFeature);
  const editedState = { ...authored, sketches: [edited.sketch] };
  const rebuiltPrefix = rebuildOccAuthoringState(editedState, [baseFeature]);
  const resolved = resolveOccReference(
    {
      documentId: rebuiltPrefix.documentId,
      revisionId: rebuiltPrefix.revisionId,
      referenceState: rebuiltPrefix.referenceState,
    },
    { kind: "edge", bodyId, edgeId: deletedEdgeId },
  );

  expect([
    OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
    OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous,
    OCC_REFERENCE_INVALIDATION_REASONS.missing,
  ]).toContain(resolved.resolution.invalidation?.reason);
  expect(resolved.diagnostics[0]?.detail?.kind).toBe("invalidReference");
}, 15000);

test("durable naming capability is enabled after all K.2 qualification cases pass", () => {
  expect(OCC_KERNEL_CAPABILITIES.supportsDurableTopologyNaming).toBe(true);
});

test("durable naming qualification preserves a changed shell face through a dimension-only sketch edit", async () => {
  const rebuilt = await rebuildAfterDimensionEdit("shell");
  expect(rebuilt.features.at(-1)?.definition.kind).toBe("shell");
}, 15000);

test("durable naming qualification explicitly invalidates a deleted edge without remapping", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const baseFeatureId = featureId("qualification_deleted_edge_base");
  const bodyId = bodyIdForFeature(baseFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const base = createRectangleSketch(
    "sketch_occ_qualification_deleted_edge" as SketchId,
    plane,
    { width: 4, height: 3 },
  );
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] });
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 4, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  });
  const deletedEdgeId = findEdgeByEndpoints(
    oc,
    requireBody(afterBase, bodyId),
    [4, 0, 0],
    [4, 0, 4],
  );
  const afterCut = applyFeature(afterBase, {
    featureId: featureId("qualification_deleted_edge_cut"),
    definition: createExtrudeDefinition(base.sketch, base.region, 4, {
      operation: "cut",
      booleanScope: { kind: "targetBody", bodyId },
    }),
    suppressed: false,
  });
  const resolved = resolveOccReference(
    {
      documentId: afterCut.documentId,
      revisionId: afterCut.revisionId,
      referenceState: afterCut.referenceState,
    },
    { kind: "edge", bodyId, edgeId: deletedEdgeId },
  );

  expect(resolved.resolution.invalidation?.reason).toBe(
    OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
  );
  expect(resolved.diagnostics[0]?.detail?.kind).toBe("invalidReference");
  expect(resolved.resolution.target).toEqual({
    kind: "edge",
    bodyId,
    edgeId: deletedEdgeId,
  });
});

test("durable naming qualification explicitly invalidates a split edge as ambiguous", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const targetFeatureId = featureId("qualification_split_edge_target");
  const toolFeatureId = featureId("qualification_split_edge_tool");
  const targetBodyId = bodyIdForFeature(targetFeatureId);
  const toolBodyId = bodyIdForFeature(toolFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const target = createRectangleSketch(
    "sketch_occ_qualification_split_edge_target" as SketchId,
    plane,
    { width: 6, height: 4 },
  );
  const tool = createRectangleSketch(
    "sketch_occ_qualification_split_edge_tool" as SketchId,
    plane,
    { origin: [2, 0], width: 2, height: 4 },
  );
  const initial = createOccAuthoringState(oc, {
    sketches: [target.sketch, tool.sketch],
  });
  const afterTarget = applyFeature(initial, {
    featureId: targetFeatureId,
    definition: createExtrudeDefinition(target.sketch, target.region, 4, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  });
  const splitEdgeId = findEdgeByEndpoints(
    oc,
    requireBody(afterTarget, targetBodyId),
    [0, 4, 4],
    [6, 4, 4],
  );
  const afterTool = applyFeature(afterTarget, {
    featureId: toolFeatureId,
    definition: createExtrudeDefinition(tool.sketch, tool.region, 4, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  });
  const afterSplit = applyFeature(afterTool, {
    featureId: featureId("qualification_split_edge"),
    definition: createSplitDefinition(targetBodyId, toolBodyId),
    suppressed: false,
  });
  const resolved = resolveOccReference(
    {
      documentId: afterSplit.documentId,
      revisionId: afterSplit.revisionId,
      referenceState: afterSplit.referenceState,
    },
    { kind: "edge", bodyId: targetBodyId, edgeId: splitEdgeId },
  );

  expect(resolved.resolution.invalidation?.reason).toBe(
    OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous,
  );
  expect(resolved.diagnostics[0]?.detail?.kind).toBe("invalidReference");
  expect(resolved.resolution.target).toEqual({
    kind: "edge",
    bodyId: targetBodyId,
    edgeId: splitEdgeId,
  });
});

test("durable naming qualification survives legal independent feature reorder and suppression", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  const targetFeatureId = featureId("qualification_reorder_target");
  const independentFeatureId = featureId("qualification_reorder_independent");
  const targetBodyId = bodyIdForFeature(targetFeatureId);
  const plane = createStandardPlaneDefinition("xy");
  const target = createRectangleSketch(
    "sketch_occ_qualification_reorder_target" as SketchId,
    plane,
    { width: 10, height: 8 },
  );
  const independent = createRectangleSketch(
    "sketch_occ_qualification_reorder_independent" as SketchId,
    plane,
    { origin: [20, 0], width: 2, height: 2 },
  );
  const initial = createOccAuthoringState(oc, {
    sketches: [target.sketch, independent.sketch],
  });
  const targetFeature = {
    featureId: targetFeatureId,
    definition: createExtrudeDefinition(target.sketch, target.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const independentFeature = {
    featureId: independentFeatureId,
    definition: createExtrudeDefinition(
      independent.sketch,
      independent.region,
      3,
      { operation: "newBody", booleanScope: { kind: "standalone" } },
    ),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const afterTarget = applyFeature(initial, targetFeature);
  const targetEdgeId = findEdgeByEndpoints(
    oc,
    requireBody(afterTarget, targetBodyId),
    [10, 0, 0],
    [10, 0, 6],
  );
  const afterIndependent = applyFeature(afterTarget, independentFeature);
  const filletFeature = {
    featureId: featureId("qualification_reorder_fillet"),
    definition: createFilletDefinition(targetBodyId, targetEdgeId),
    suppressed: false,
  } satisfies OccAuthoringFeatureRecord;
  const authored = applyFeature(afterIndependent, filletFeature);
  const reordered = rebuildOccAuthoringState(authored, [
    independentFeature,
    targetFeature,
    filletFeature,
  ]);
  const suppressed = rebuildOccAuthoringState(reordered, [
    { ...independentFeature, suppressed: true },
    targetFeature,
    filletFeature,
  ]);
  const reenabled = rebuildOccAuthoringState(suppressed, [
    independentFeature,
    targetFeature,
    filletFeature,
  ]);

  expect(reordered.features.at(-1)?.definition.kind).toBe("fillet");
  expect(suppressed.features.at(-1)?.definition.kind).toBe("fillet");
  expect(reenabled.features.at(-1)?.definition.kind).toBe("fillet");
  expect(requireBody(reenabled, targetBodyId)).toBeTruthy();
}, 15000);
