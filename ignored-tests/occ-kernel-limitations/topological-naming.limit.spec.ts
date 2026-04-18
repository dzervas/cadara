import { test } from 'bun:test'
import type {
  FeatureDefinition,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type {
  BodyId,
  ConstructionId,
  EdgeId,
  FaceId,
  FeatureId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import {
  SKETCH_SCHEMA_VERSION,
  SOLVED_SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from '@/contracts/sketch/schema'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  type OccAuthoringFeatureRecord,
  type OccAuthoringState,
} from '@/domain/modeling/occ/authoring-state'
import { extractPlanarFaceData } from '@/domain/modeling/occ/planes'
import { getDefaultOpenCascadeInstance, type OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { buildAxisFromLineEdge } from '@/domain/modeling/occ/sketch-profile'
import { resolveOccReference, type OccTrackedBody } from '@/domain/modeling/occ/topology'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function pointId(name: string) {
  return `sketch_point_${name}` as SketchPointId
}

function entityId(name: string) {
  return `sketch_entity_${name}` as SketchEntityId
}

function featureId(name: string) {
  return `feature_occ_limit_${name}` as FeatureId
}

function bodyIdForFeature(id: FeatureId) {
  return `body_${id}` as BodyId
}

function createOffsetPlane(
  constructionId: ConstructionId,
  origin: readonly [number, number, number],
): SketchPlaneDefinition {
  return {
    support: { kind: 'construction', constructionId },
    frame: {
      origin,
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      linearUnit: 'documentLength',
      handedness: 'rightHanded',
    },
    key: null,
  }
}

function createSketchDefinition(
  sketchId: SketchId,
  points: Array<{ id: SketchPointId; position: readonly [number, number] }>,
  entities: SketchDefinition['entities'],
): SketchDefinition {
  return {
    schemaVersion: SKETCH_SCHEMA_VERSION,
    referenceIds: [],
    references: [],
    pointIds: points.map((point) => point.id),
    points: points.map((point) => ({
      pointId: point.id,
      label: point.id,
      target: { kind: 'sketchPoint', sketchId, pointId: point.id },
      position: point.position,
      isConstruction: false,
    })),
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  }
}

function createSketchRecord(
  sketchId: SketchId,
  plane: SketchPlaneDefinition,
  definition: SketchDefinition,
  solvedEntities: SketchRecord['solvedSnapshot']['solvedEntities'],
  regions: RegionRecord[],
): SketchSnapshotRecord {
  const sketch: SketchRecord = {
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
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
        solveState: 'solved',
        constraintState: 'wellConstrained',
      },
      solvedEntities,
      solvedPoints: [],
      constraintStatuses: [],
      dimensionStatuses: [],
      diagnostics: [],
    },
    regions,
  }

  return {
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    sketchId,
    label: sketchId,
    plane,
    planeTarget: plane.support,
    planeKey: plane.key,
    sketch,
  }
}

function createRectangleSketch(
  sketchId: SketchId,
  plane: SketchPlaneDefinition,
  options: {
    origin?: readonly [number, number]
    width?: number
    height?: number
  } = {},
) {
  const origin = options.origin ?? [0, 0]
  const width = options.width ?? 4
  const height = options.height ?? 3
  const points = [
    { id: pointId(`${sketchId}_bottom_left`), position: [origin[0], origin[1]] as const },
    { id: pointId(`${sketchId}_bottom_right`), position: [origin[0] + width, origin[1]] as const },
    { id: pointId(`${sketchId}_top_right`), position: [origin[0] + width, origin[1] + height] as const },
    { id: pointId(`${sketchId}_top_left`), position: [origin[0], origin[1] + height] as const },
  ]
  const entities = [
    {
      kind: 'lineSegment' as const,
      entityId: entityId(`${sketchId}_bottom`),
      label: 'bottom',
      target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_bottom`) },
      isConstruction: false,
      startPointId: points[0]!.id,
      endPointId: points[1]!.id,
    },
    {
      kind: 'lineSegment' as const,
      entityId: entityId(`${sketchId}_right`),
      label: 'right',
      target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_right`) },
      isConstruction: false,
      startPointId: points[1]!.id,
      endPointId: points[2]!.id,
    },
    {
      kind: 'lineSegment' as const,
      entityId: entityId(`${sketchId}_top`),
      label: 'top',
      target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_top`) },
      isConstruction: false,
      startPointId: points[2]!.id,
      endPointId: points[3]!.id,
    },
    {
      kind: 'lineSegment' as const,
      entityId: entityId(`${sketchId}_left`),
      label: 'left',
      target: { kind: 'sketchEntity' as const, sketchId, entityId: entityId(`${sketchId}_left`) },
      isConstruction: false,
      startPointId: points[3]!.id,
      endPointId: points[0]!.id,
    },
  ]
  const definition = createSketchDefinition(sketchId, points, entities)
  const regionId = `region_${sketchId}_outer` as const
  const region: RegionRecord = {
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
    regionId,
    label: regionId,
    target: { kind: 'region', sketchId, regionId },
    sourceSketch: { kind: 'sketch', sketchId },
    loops: [
      {
        loopId: `region_loop_${sketchId}_outer` as const,
        role: 'outer',
        orientation: 'counterClockwise',
        segments: entities.map((entity, index) => ({
          source: { kind: 'entity' as const, entityId: entity.entityId },
          startPointId: points[index]!.id,
          endPointId: points[(index + 1) % points.length]!.id,
        })),
        boundaryPointIds: points.map((point) => point.id),
        isClosed: true,
      },
    ],
    isClosed: true,
  }
  const sketch = createSketchRecord(sketchId, plane, definition, [
    {
      kind: 'lineSegment',
      entityId: entities[0]!.entityId,
      startPosition: [origin[0], origin[1]],
      endPosition: [origin[0] + width, origin[1]],
    },
    {
      kind: 'lineSegment',
      entityId: entities[1]!.entityId,
      startPosition: [origin[0] + width, origin[1]],
      endPosition: [origin[0] + width, origin[1] + height],
    },
    {
      kind: 'lineSegment',
      entityId: entities[2]!.entityId,
      startPosition: [origin[0] + width, origin[1] + height],
      endPosition: [origin[0], origin[1] + height],
    },
    {
      kind: 'lineSegment',
      entityId: entities[3]!.entityId,
      startPosition: [origin[0], origin[1] + height],
      endPosition: [origin[0], origin[1]],
    },
  ], [region])

  return { sketch, region }
}

function createExtrudeDefinition(
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
  distance: number,
  boolean: {
    operation: 'newBody'
    booleanScope: { kind: 'standalone' }
  } | {
    operation: 'join'
    booleanScope: { kind: 'targetBody'; bodyId: BodyId }
  },
): FeatureDefinition {
  return {
    kind: 'extrude',
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
      startExtent: { kind: 'profilePlane' },
      endExtent: { kind: 'blind', direction: 'positive', distance },
      operation: boolean.operation,
      booleanScope: boolean.booleanScope,
    },
  }
}

function createPlaneDefinition(bodyId: BodyId, faceId: FaceId): FeatureDefinition {
  return {
    kind: 'plane',
    featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
    parameters: {
      mode: 'coplanar',
      reference: {
        target: { kind: 'face', bodyId, faceId },
      },
    },
  }
}

function createFilletDefinition(bodyId: BodyId, edgeId: EdgeId): FeatureDefinition {
  return {
    kind: 'fillet',
    featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
    parameters: {
      radius: 0.25,
      edgeTargets: [{ kind: 'edge', bodyId, edgeId }],
    },
  }
}

function applyFeature(state: OccAuthoringState, feature: OccAuthoringFeatureRecord) {
  return applyOccFeatureToAuthoringState(state, feature)
}

function requireBody(state: OccAuthoringState, bodyId: BodyId) {
  const body = state.bodies.find((entry) => entry.bodyId === bodyId)
  assert(body, `Expected body ${bodyId} to exist.`)
  return body
}

function dot(left: readonly [number, number, number], right: readonly [number, number, number]) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function findPlanarFaceAtZ(
  oc: OpenCascadeInstance,
  body: OccTrackedBody,
  z: number,
) {
  const faceId = body.topology.faceIds.find((candidate) => {
    const face = body.facesById.get(candidate)
    if (!face) {
      return false
    }

    const plane = extractPlanarFaceData(oc, face)
    return Math.abs(Math.abs(plane.frame.normal[2]) - 1) < 0.001
      && Math.abs(plane.frame.origin[2] - z) < 0.001
  })

  assert(faceId, `Expected body ${body.bodyId} to expose a horizontal planar face at z=${z}.`)
  return faceId
}

function findLinearEdgeByDirection(
  oc: OpenCascadeInstance,
  body: OccTrackedBody,
  direction: readonly [number, number, number],
) {
  const edgeId = body.topology.edgeIds.find((candidate) => {
    const edge = body.edgesById.get(candidate)
    if (!edge) {
      return false
    }

    const axis = buildAxisFromLineEdge(oc, edge)
    const edgeDirection = [
      axis.Direction().X(),
      axis.Direction().Y(),
      axis.Direction().Z(),
    ] as const

    return Math.abs(dot(edgeDirection, direction)) > 0.999
  })

  assert(edgeId, `Expected body ${body.bodyId} to expose a linear edge in direction ${direction.join(',')}.`)
  return edgeId
}

async function createBossAndRibFixture() {
  const oc = await getDefaultOpenCascadeInstance()
  const baseFeatureId = featureId('base_block')
  const bodyId = bodyIdForFeature(baseFeatureId)
  const xy = createStandardPlaneDefinition('xy')
  const topPlane = createOffsetPlane('construction_occ_limit_top_face' as ConstructionId, [0, 0, 4])
  const base = createRectangleSketch('sketch_occ_limit_base' as SketchId, xy, {
    width: 10,
    height: 8,
  })
  const boss = createRectangleSketch('sketch_occ_limit_boss' as SketchId, topPlane, {
    origin: [2, 2],
    width: 3,
    height: 3,
  })
  const rib = createRectangleSketch('sketch_occ_limit_rib' as SketchId, topPlane, {
    origin: [0.5, 3.4],
    width: 9,
    height: 1.2,
  })
  const initial = createOccAuthoringState(oc, {
    sketches: [base.sketch, boss.sketch, rib.sketch],
  })
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 4, {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }),
  })
  const baseBody = requireBody(afterBase, bodyId)
  const bottomFaceId = findPlanarFaceAtZ(oc, baseBody, 0)
  const afterBoss = applyFeature(afterBase, {
    featureId: featureId('joined_boss'),
    definition: createExtrudeDefinition(boss.sketch, boss.region, 2, {
      operation: 'join',
      booleanScope: { kind: 'targetBody', bodyId },
    }),
  })
  const afterRib = applyFeature(afterBoss, {
    featureId: featureId('joined_rib'),
    definition: createExtrudeDefinition(rib.sketch, rib.region, 1.25, {
      operation: 'join',
      booleanScope: { kind: 'targetBody', bodyId },
    }),
  })

  return {
    bodyId,
    bottomFaceId,
    afterBase,
    afterRib,
  }
}

async function createSameDomainExtensionFixture() {
  const oc = await getDefaultOpenCascadeInstance()
  const baseFeatureId = featureId('same_domain_base')
  const bodyId = bodyIdForFeature(baseFeatureId)
  const xy = createStandardPlaneDefinition('xy')
  const base = createRectangleSketch('sketch_occ_limit_same_domain' as SketchId, xy, {
    width: 4,
    height: 3,
  })
  const initial = createOccAuthoringState(oc, { sketches: [base.sketch] })
  const afterBase = applyFeature(initial, {
    featureId: baseFeatureId,
    definition: createExtrudeDefinition(base.sketch, base.region, 5, {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }),
  })
  const baseBody = requireBody(afterBase, bodyId)
  const verticalEdgeId = findLinearEdgeByDirection(oc, baseBody, [0, 0, 1])
  const afterSameDomainJoin = applyFeature(afterBase, {
    featureId: featureId('same_domain_join'),
    definition: createExtrudeDefinition(base.sketch, base.region, 8, {
      operation: 'join',
      booleanScope: { kind: 'targetBody', bodyId },
    }),
  })

  return {
    bodyId,
    verticalEdgeId,
    afterSameDomainJoin,
  }
}

function formatInvalidation(state: OccAuthoringState, target: { kind: 'face'; bodyId: BodyId; faceId: FaceId }) {
  const resolved = resolveOccReference({
    documentId: state.documentId,
    revisionId: state.revisionId,
    referenceState: state.referenceState,
  }, target)

  return resolved.resolution.invalidation === null
    ? 'live'
    : `${resolved.resolution.invalidation.reason} for ${resolved.resolution.invalidation.target.kind}`
}

test('proper naming should keep an untouched bottom face live after joined boss and rib booleans', async () => {
  const fixture = await createBossAndRibFixture()
  const resolved = resolveOccReference({
    documentId: fixture.afterRib.documentId,
    revisionId: fixture.afterRib.revisionId,
    referenceState: fixture.afterRib.referenceState,
  }, {
    kind: 'face',
    bodyId: fixture.bodyId,
    faceId: fixture.bottomFaceId,
  })

  assert(
    resolved.resolution.invalidation === null,
    `Expected the untouched bottom face to stay live after top-side joins; current result is ${formatInvalidation(fixture.afterRib, {
      kind: 'face',
      bodyId: fixture.bodyId,
      faceId: fixture.bottomFaceId,
    })}.`,
  )
})

test('proper naming should allow a downstream plane to reference a pre-join unaffected face', async () => {
  const fixture = await createBossAndRibFixture()
  let thrownMessage: string | null = null

  try {
    applyFeature(fixture.afterRib, {
      featureId: featureId('plane_from_old_bottom_face'),
      definition: createPlaneDefinition(fixture.bodyId, fixture.bottomFaceId),
    })
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : String(error)
  }

  assert(
    thrownMessage === null,
    `Expected a face-backed plane to resolve through boolean history, but the current adapter rejected it: ${thrownMessage}.`,
  )
})

test('proper naming should carry a selected vertical edge through same-domain simplification', async () => {
  const fixture = await createSameDomainExtensionFixture()
  let thrownMessage: string | null = null

  try {
    applyFeature(fixture.afterSameDomainJoin, {
      featureId: featureId('fillet_old_simplified_edge'),
      definition: createFilletDefinition(fixture.bodyId, fixture.verticalEdgeId),
    })
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : String(error)
  }

  assert(
    thrownMessage === null,
    `Expected the selected vertical edge to survive the simplified join for downstream fillet selection, but the current adapter rejected it: ${thrownMessage}.`,
  )
})
