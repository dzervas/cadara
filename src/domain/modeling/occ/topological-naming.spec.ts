import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
import type {
  FeatureDefinition,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import type {
  BodyId,
  ConstructionId,
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
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  rebuildOccAuthoringState,
  type OccAuthoringFeatureRecord,
  type OccAuthoringState,
} from "@/domain/modeling/occ/authoring-state";
import { extractPlanarFaceData } from "@/domain/modeling/occ/planes";
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
  expectTrue(body, `Expected body ${bodyId} to exist.`);
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

  expectTrue(
    faceId,
    `Expected body ${body.bodyId} to expose a horizontal planar face at z=${z}.`,
  );
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

  expectTrue(
    edgeId,
    `Expected body ${body.bodyId} to expose a linear edge in direction ${direction.join(",")}.`,
  );
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

  expectTrue(
    edgeId,
    `Expected body ${body.bodyId} to expose an edge from ${first.join(",")} to ${second.join(",")}.`,
  );
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

  expectTrue(
    vertexId,
    `Expected body ${body.bodyId} to expose a vertex at ${position.join(",")}.`,
  );
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

  expectTrue(
    resolved.resolution.invalidation === null,
    `Expected the untouched bottom face to stay live after top-side joins; current result is ${formatInvalidation(
      fixture.afterRib,
      {
        kind: "face",
        bodyId: fixture.bodyId,
        faceId: fixture.bottomFaceId,
      },
    )}.`,
  );
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

  expectTrue(
    thrownMessage === null,
    `Expected a face-backed plane to resolve through boolean history, but the current adapter rejected it: ${thrownMessage}.`,
  );
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

  expectTrue(
    thrownMessage === null,
    `Expected the selected vertical edge to survive the simplified join for downstream fillet selection, but the current adapter rejected it: ${thrownMessage}.`,
  );
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

  expectTrue(
    edgeResolved.resolution.invalidation === null,
    `Expected untouched edge to stay live through chained fillet/chamfer operations, got ${edgeResolved.resolution.invalidation?.reason}.`,
  );
  expectTrue(
    vertexResolved.resolution.invalidation === null,
    `Expected untouched vertex to stay live through chained fillet/chamfer operations, got ${vertexResolved.resolution.invalidation?.reason}.`,
  );
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

  expectTrue(
    thrownMessage === null,
    `Expected old edge id to resolve for downstream fillet after chained fillet/chamfer operations, got ${thrownMessage}.`,
  );
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

  expectTrue(
    edgeResolved.resolution.invalidation === null,
    `Expected untouched edge to stay live through shell replacement, got ${edgeResolved.resolution.invalidation?.reason}.`,
  );
  expectTrue(
    vertexResolved.resolution.invalidation === null,
    `Expected untouched vertex to stay live through shell replacement, got ${vertexResolved.resolution.invalidation?.reason}.`,
  );
});

test("proper naming should carry thicken-produced topology through chained fillet and chamfer operations", async () => {
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
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 6, {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    }),
  });
  const sourceTopFaceId = findPlanarFaceAtZ(
    oc,
    requireBody(afterBase, sourceBodyId),
    6,
  );
  const afterThicken = applyFeature(afterBase, {
    featureId: thickenFeatureId,
    definition: createThickenDefinition(sourceBodyId, sourceTopFaceId),
  });
  const thickenedBody = requireBody(afterThicken, thickenedBodyId);
  const stableEdgeId = findEdgeByEndpoints(
    oc,
    thickenedBody,
    [10, 8, 6],
    [10, 8, 6.5],
  );
  const stableVertexId = findVertexAt(oc, thickenedBody, [10, 8, 6.5]);
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

  expectTrue(
    edgeResolved.resolution.invalidation === null,
    `Expected thicken-produced edge to stay live through chained edits, got ${edgeResolved.resolution.invalidation?.reason}.`,
  );
  expectTrue(
    vertexResolved.resolution.invalidation === null,
    `Expected thicken-produced vertex to stay live through chained edits, got ${vertexResolved.resolution.invalidation?.reason}.`,
  );
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

  expectTrue(
    resolved.resolution.invalidation === null,
    `Expected rebuilt authored history to preserve the bottom face reference, got ${resolved.resolution.invalidation?.reason}.`,
  );
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

  expectTrue(
    resolved.resolution.invalidation?.reason ===
      OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
    `Expected cut-away face to be invalidated as deleted topology, got ${resolved.resolution.invalidation?.reason}.`,
  );
  expectTrue(
    resolved.diagnostics[0]?.detail?.kind === "invalidReference",
    "Deleted topology must surface a structured invalid-reference diagnostic.",
  );
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

  expectTrue(
    resolved.resolution.invalidation?.reason ===
      OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous,
    `Expected split face reference to be invalidated as ambiguous topology, got ${resolved.resolution.invalidation?.reason}.`,
  );
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
  expectTrue(toolFaceId, "Tool body must expose a face before Combine.");
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

  expectTrue(
    resolved.resolution.invalidation?.reason ===
      OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
    `Expected consumed tool-body face to be invalidated as deleted topology, got ${resolved.resolution.invalidation?.reason}.`,
  );
  expectTrue(
    !afterCombine.bodies.some((body) => body.bodyId === toolBodyId),
    "Consumed Combine tool body must not remain live after add.",
  );
});
