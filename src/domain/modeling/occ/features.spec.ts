import { test } from 'bun:test'
import type {
  ConstructionSnapshotRecord,
  ExtrudeFeatureParameters,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import {
  createConstructionPresentationArtifacts,
  executeOccFeature,
  type OccFeatureExecutionContext,
} from '@/domain/modeling/occ/features'
import {
  createOccAuthoringState,
  rebuildOccAuthoringState,
} from '@/domain/modeling/occ/authoring-state'
import { buildConstructionPlaneFromPlanarFace } from '@/domain/modeling/occ/sketch-profile'
import { getDefaultOpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { trackNewSolidBody } from '@/domain/modeling/occ/topology'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  createStandardPlaneDefinition,
} from '@/domain/modeling/opencascade-kernel-seed'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from '@/contracts/modeling/advanced-solid'
import type {
  BodyId,
  ConstructionId,
  EdgeId,
  FeatureId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from '@/contracts/sketch/schema'
import { extractPlanarFaceData, toGpPnt } from '@/domain/modeling/occ/planes'
import { buildAxisFromLineEdge } from '@/domain/modeling/occ/sketch-profile'

test('src/domain/modeling/occ/features.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function assertClose(actual: number, expected: number, tolerance: number, message: string) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}: expected ${expected}, got ${actual}.`)
    }
  }

  function dot(
    left: readonly [number, number, number],
    right: readonly [number, number, number],
  ) {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
  }

  function pointId(name: string) {
    return `sketch_point_${name}` as SketchPointId
  }

  function entityId(name: string) {
    return `sketch_entity_${name}` as SketchEntityId
  }

  function createConstructionSnapshot(constructionId: ConstructionId, ownerFeatureId: FeatureId | null = null): ConstructionSnapshotRecord {
    const standardKey =
      constructionId === 'construction_plane-xy'
        ? 'xy'
        : constructionId === 'construction_plane-yz'
          ? 'yz'
          : 'xz'

    return {
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: null,
      constructionId,
      label: constructionId,
      constructionType: 'plane',
      plane: createStandardPlaneDefinition(standardKey),
      target: { kind: 'construction', constructionId },
    }
  }

  function requireConstructionSupport(plane: SketchPlaneDefinition) {
    if (plane.support.kind !== 'construction') {
      throw new Error('Expected a construction-backed sketch plane in the phase 4 test harness.')
    }

    return plane.support
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
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
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
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
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
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
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

  async function makeBoxBody(
    oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>,
    bodyId: BodyId,
    dx: number,
    dy: number,
    dz: number,
    ownerFeatureId: FeatureId,
    origin: readonly [number, number, number] = [0, 0, 0],
  ) {
    const box = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, origin),
      dx,
      dy,
      dz,
    )
    box.Build(new oc.Message_ProgressRange_1())
    assert(box.IsDone(), 'Expected test box to build successfully.')

    return trackNewSolidBody(oc, {
      bodyId,
      label: bodyId,
      ownerFeatureId,
      shape: box.Shape(),
    })
  }

  function createContext(input?: Partial<Omit<OccFeatureExecutionContext, 'oc' | 'documentId' | 'revisionId' | 'modelingTolerance'>>) {
    return async () => {
      const oc = await getDefaultOpenCascadeInstance()
      const xyPlane = createStandardPlaneDefinition('xy')
      const yzPlane = createStandardPlaneDefinition('yz')
      const xzPlane = createStandardPlaneDefinition('xz')

      const constructions = [
        createConstructionSnapshot(requireConstructionSupport(xyPlane).constructionId),
        createConstructionSnapshot(requireConstructionSupport(yzPlane).constructionId),
        createConstructionSnapshot(requireConstructionSupport(xzPlane).constructionId),
        ...(input?.constructions ?? []),
      ]

      return {
        oc,
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
        modelingTolerance: 0.001,
        sketches: input?.sketches ?? [],
        constructions,
        constructionPlanes: new Map<ConstructionId, SketchPlaneDefinition>([
          [requireConstructionSupport(xyPlane).constructionId, xyPlane],
          [requireConstructionSupport(yzPlane).constructionId, yzPlane],
          [requireConstructionSupport(xzPlane).constructionId, xzPlane],
          ...Array.from(input?.constructionPlanes ?? new Map()),
        ]),
        bodies: input?.bodies ?? [],
      } satisfies OccFeatureExecutionContext
    }
  }

  async function bodyVolume(
    oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>,
    shape: object,
  ) {
    const props = new oc.GProp_GProps_1()
    oc.BRepGProp.VolumeProperties_1(shape as InstanceType<typeof oc.TopoDS_Shape>, props, false, false, false)
    return props.Mass()
  }

  function findFaceIdByDirection(
    oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>,
    body: Awaited<ReturnType<typeof makeBoxBody>>,
    direction: readonly [number, number, number],
  ) {
    return body.topology.faceIds.find((faceId) => {
      const face = body.facesById.get(faceId)

      if (!face) {
        return false
      }

      const plane = extractPlanarFaceData(oc, face)
      return Math.abs(dot(plane.frame.normal, direction)) >= 0.999999
    }) ?? null
  }

  function findEdgeIdByDirection(
    oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>,
    body: Awaited<ReturnType<typeof makeBoxBody>>,
    direction: readonly [number, number, number],
  ) {
    return body.topology.edgeIds.find((edgeId) => {
      const edge = body.edgesById.get(edgeId)

      if (!edge) {
        return false
      }

      const axis = buildAxisFromLineEdge(oc, edge)
      const edgeDirection = [
        axis.Direction().X(),
        axis.Direction().Y(),
        axis.Direction().Z(),
      ] as const
      return Math.abs(dot(edgeDirection, direction)) >= 0.999999
    }) ?? null
  }

  async function testPlaneFeatureDuplicatesConstructionGeometryAndProducesPresentationArtifacts() {
    const makeContext = createContext()
    const context = await makeContext()
    const featureId = 'feature_phase4_plane_construction' as FeatureId
    const result = executeOccFeature(context, featureId, {
      kind: 'plane',
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: 'coplanar',
        reference: {
          target: {
            kind: 'construction',
            constructionId: 'construction_plane-xy' as ConstructionId,
          },
        },
      },
    })

    assert(result.producedTargets.length === 1, 'Plane feature should produce one construction target.')
    const target = result.producedTargets[0]
    assert(target?.kind === 'construction', 'Plane feature must produce a construction durable ref.')
    const duplicatedPlane = result.constructionPlanes.get(target.constructionId)
    assert(duplicatedPlane != null, 'Plane feature must store an internal construction plane definition.')
    assertClose(duplicatedPlane.frame.origin[2], 0, 1e-9, 'Copied XY plane should preserve origin.')
    assert(result.entities.length === 1, 'Plane feature should emit one construction entity row.')
    assert(result.renderRecords.length === 1, 'Plane feature should emit one construction render record.')

    const construction = result.constructions.find((entry) => entry.constructionId === target.constructionId)
    assert(construction != null, 'Plane feature must append a public construction snapshot row.')
    const artifacts = createConstructionPresentationArtifacts(context, construction, duplicatedPlane)
    assert(artifacts.entities[0]?.selectionSemantics.includes('constructionPlane'), 'Construction entity should advertise construction-plane semantics.')
    assert(artifacts.renderRecords[0]?.binding.semanticClass === 'construction', 'Construction render record should bind as construction geometry.')
  }

  async function testPlaneFeatureBuildsFaceBackedConstructionPlane() {
    const oc = await getDefaultOpenCascadeInstance()
    const sourceBody = await makeBoxBody(
      oc,
      'body_phase4_plane_face_source' as BodyId,
      2,
      3,
      4,
      'feature_phase4_source' as FeatureId,
    )
    const faceId = findFaceIdByDirection(oc, sourceBody, [1, 0, 0])
    assert(faceId != null, 'Expected tracked solid body to expose a YZ-aligned planar face.')

    const makeContext = createContext({ bodies: [sourceBody] })
    const context = await makeContext()
    const featureId = 'feature_phase4_plane_face' as FeatureId
    const result = executeOccFeature(context, featureId, {
      kind: 'plane',
      featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
      parameters: {
        mode: 'coplanar',
        reference: {
          target: {
            kind: 'face',
            bodyId: sourceBody.bodyId,
            faceId,
          },
        },
      },
    })
    const target = result.producedTargets[0]
    assert(target?.kind === 'construction', 'Face-backed plane feature must produce a construction target.')
    const plane = result.constructionPlanes.get(target.constructionId)
    assert(plane != null, 'Face-backed plane should expose internal plane geometry.')
    assertClose(Math.abs(plane.frame.normal[0]), 1, 1e-9, 'YZ-backed plane should preserve the face normal.')
  }

  async function testExtrudeFeatureCreatesStandaloneBodyFromRegion() {
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_extrude' as SketchId, plane)
    const makeContext = createContext({ sketches: [sketch] })
    const context = await makeContext()
    const featureId = 'feature_phase4_extrude_new_body' as FeatureId
    const parameters: ExtrudeFeatureParameters = {
      profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
      startExtent: { kind: 'profilePlane' },
      endExtent: { kind: 'blind', direction: 'positive', distance: 5 },
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }

    const result = executeOccFeature(context, featureId, {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters,
    })
    const bodyTarget = result.producedTargets[0]
    assert(bodyTarget?.kind === 'body', 'Standalone extrude must produce a new body target.')
    const producedBody = result.bodies.find((entry) => entry.bodyId === bodyTarget.bodyId)
    assert(producedBody != null, 'Standalone extrude must append the produced body.')
    assertClose(await bodyVolume(context.oc, producedBody.shape), 60, 1e-6, '4x3 rectangle extruded by 5 should produce the expected prism volume.')
  }

  async function testExtrudeJoinAcrossOrderedTargetBodiesFollowsSequentialPolicy() {
    const oc = await getDefaultOpenCascadeInstance()
    const bodyA = await makeBoxBody(oc, 'body_phase4_join_a' as BodyId, 1, 1, 1, 'feature_box_a' as FeatureId, [0, 0, 0])
    const bodyB = await makeBoxBody(oc, 'body_phase4_join_b' as BodyId, 1, 1, 1, 'feature_box_b' as FeatureId, [4, 0, 0])
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_join' as SketchId, plane)
    const context = await createContext({ sketches: [sketch], bodies: [bodyA, bodyB] })()

    const result = executeOccFeature(context, 'feature_phase4_join' as FeatureId, {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
        operation: 'join',
        booleanScope: { kind: 'targetBodies', bodyIds: [bodyA.bodyId, bodyB.bodyId] },
      },
    })

    assert(result.bodies.length === 1, 'Sequential join should collapse ordered target bodies into the first target body.')
    assert(result.bodies[0]?.bodyId === bodyA.bodyId, 'Sequential join should preserve the first target body id.')
  }

  async function testExtrudeJoinRejectsMultiSolidResultShapes() {
    const oc = await getDefaultOpenCascadeInstance()
    const bodyA = await makeBoxBody(oc, 'body_phase4_join_multi_a' as BodyId, 1, 1, 1, 'feature_box_multi_a' as FeatureId, [20, 0, 0])
    const bodyB = await makeBoxBody(oc, 'body_phase4_join_multi_b' as BodyId, 1, 1, 1, 'feature_box_multi_b' as FeatureId, [40, 0, 0])
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_join_multi' as SketchId, plane)
    const context = await createContext({ sketches: [sketch], bodies: [bodyA, bodyB] })()

    let thrownMessage: string | null = null

    try {
      executeOccFeature(context, 'feature_phase4_join_multi' as FeatureId, {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
          operation: 'join',
          booleanScope: { kind: 'targetBodies', bodyIds: [bodyA.bodyId, bodyB.bodyId] },
        },
      })
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }

    assert(
      thrownMessage?.includes('Phase 4') === true && thrownMessage.includes('single-body replacement'),
      'Disjoint sequential joins should reject multi-solid replacement results explicitly.',
    )
  }

  async function testExtrudeRejectsInvalidExtentAndBooleanScope() {
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_extrude_invalid' as SketchId, plane)
    const context = await createContext({ sketches: [sketch] })()

    let invalidDistance: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_extrude_invalid_distance' as FeatureId, {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 0 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      })
    } catch (error) {
      invalidDistance = error instanceof Error ? error.message : String(error)
    }

    let invalidScope: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_extrude_invalid_scope' as FeatureId, {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
          operation: 'join',
          booleanScope: { kind: 'standalone' },
        },
      })
    } catch (error) {
      invalidScope = error instanceof Error ? error.message : String(error)
    }

    let invalidNewBodyScope: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_extrude_invalid_new_body_scope' as FeatureId, {
        kind: 'extrude',
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
          startExtent: { kind: 'profilePlane' },
          endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
          operation: 'newBody',
          booleanScope: { kind: 'targetBody', bodyId: 'body_invalid_scope' as BodyId },
        },
      })
    } catch (error) {
      invalidNewBodyScope = error instanceof Error ? error.message : String(error)
    }

    assert(invalidDistance === 'Extrude endExtent.distance must be positive.', 'Extrude should reject non-positive blind distances.')
    assert(invalidScope === 'Boolean operation join requires explicit target bodies.', 'Extrude should reject standalone scope for boolean operations that need explicit participants.')
    assert(invalidNewBodyScope === 'Boolean operation newBody requires standalone scope.', 'Extrude should reject non-standalone scope for new-body operations.')
  }

  async function testCutAndIntersectApplyPerTargetPolicy() {
    const oc = await getDefaultOpenCascadeInstance()
    const bodyA = await makeBoxBody(oc, 'body_phase4_cut_a' as BodyId, 2, 2, 1, 'feature_phase4_cut_seed_a' as FeatureId, [0, 0, 0])
    const bodyB = await makeBoxBody(oc, 'body_phase4_cut_b' as BodyId, 2, 2, 1, 'feature_phase4_cut_seed_b' as FeatureId, [10, 0, 0])
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_cut' as SketchId, plane, {
      origin: [0.5, 0.5],
      width: 1,
      height: 1,
    })
    const context = await createContext({ sketches: [sketch], bodies: [bodyA, bodyB] })()

    const cutResult = executeOccFeature(context, 'feature_phase4_cut' as FeatureId, {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
        operation: 'cut',
        booleanScope: { kind: 'targetBodies', bodyIds: [bodyA.bodyId, bodyB.bodyId] },
      },
    })

    assert(cutResult.bodies.length === 2, 'Per-target cut should preserve each target body row independently.')
    assert(cutResult.bodies.some((body) => body.bodyId === bodyA.bodyId), 'Per-target cut should preserve the first target body id.')
    assert(cutResult.bodies.some((body) => body.bodyId === bodyB.bodyId), 'Per-target cut should preserve unaffected target bodies.')

    const intersectResult = executeOccFeature(context, 'feature_phase4_intersect' as FeatureId, {
      kind: 'extrude',
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
        startExtent: { kind: 'profilePlane' },
        endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
        operation: 'intersect',
        booleanScope: { kind: 'targetBodies', bodyIds: [bodyA.bodyId, bodyB.bodyId] },
      },
    })

    assert(intersectResult.bodies.length === 1, 'Per-target intersect should drop target bodies whose solid result is empty.')
    assert(intersectResult.bodies[0]?.bodyId === bodyA.bodyId, 'Per-target intersect should preserve the remaining target body id when only one body overlaps.')
  }

  async function testRevolveRejectsConstructionAxisAndBuildsEdgeBackedSolid() {
    const oc = await getDefaultOpenCascadeInstance()
    const profilePlane = createStandardPlaneDefinition('xz')
    const axisBody = await makeBoxBody(
      oc,
      'body_phase4_revolve_axis' as BodyId,
      1,
      1,
      4,
      'feature_phase4_axis_seed' as FeatureId,
      [0, 0, 0],
    )
    const axisFaceId = findFaceIdByDirection(oc, axisBody, [1, 0, 0])
    assert(axisFaceId != null, 'Expected tracked axis body to expose a planar face id.')
    const axisFace = axisBody.facesById.get(axisFaceId)
    assert(axisFace != null, 'Expected tracked axis body to expose a planar face shape.')
    const axisPlane = buildConstructionPlaneFromPlanarFace(oc, axisFace, axisFaceId, {
      kind: 'construction',
      constructionId: 'construction_axis_seed' as ConstructionId,
    })
    const axisEdgeId = findEdgeIdByDirection(oc, axisBody, [0, 0, 1])
    assert(axisEdgeId != null, 'Expected tracked axis body to expose a linear Z-axis edge.')
    const { sketch, region } = createRectangleSketch('sketch_phase4_revolve' as SketchId, profilePlane)
    const axisConstruction = requireConstructionSupport(axisPlane)
    const context = await createContext({ sketches: [sketch], bodies: [axisBody], constructionPlanes: new Map([[axisConstruction.constructionId, axisPlane]]) })()

    let constructionAxisError: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_revolve_construction_axis' as FeatureId, {
        kind: 'revolve',
        featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
          axis: { kind: 'construction', constructionId: axisConstruction.constructionId },
          startAngle: 0,
          extent: { kind: 'angle', direction: 'counterClockwise', radians: Math.PI },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      })
    } catch (error) {
      constructionAxisError = error instanceof Error ? error.message : String(error)
    }

    const result = executeOccFeature(context, 'feature_phase4_revolve_edge_axis' as FeatureId, {
      kind: 'revolve',
      featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
      parameters: {
        profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
        axis: { kind: 'edge', bodyId: axisBody.bodyId, edgeId: axisEdgeId as EdgeId },
        startAngle: Math.PI / 4,
        extent: { kind: 'angle', direction: 'counterClockwise', radians: Math.PI },
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    })

    assert(constructionAxisError?.includes('occ-contract-gap-revolve-construction-axis') === true, 'Construction-backed revolve axes must reject explicitly with the contract-gap code.')
    assert(result.producedTargets[0]?.kind === 'body', 'Edge-backed revolve should produce a solid body.')
  }

  async function testRevolveRejectsNonPlanarFaceProfilesExplicitly() {
    const oc = await getDefaultOpenCascadeInstance()
    const cylinder = new oc.BRepPrimAPI_MakeCylinder_1(2, 5)
    cylinder.Build(new oc.Message_ProgressRange_1())
    assert(cylinder.IsDone(), 'Expected cylindrical body seed to build successfully.')
    const body = trackNewSolidBody(oc, {
      bodyId: 'body_phase4_revolve_non_planar' as BodyId,
      label: 'non-planar',
      ownerFeatureId: 'feature_phase4_non_planar_seed' as FeatureId,
      shape: cylinder.Shape(),
    })
    const nonPlanarFaceId = body.topology.faceIds.find((candidate) => {
      const face = body.facesById.get(candidate)
      if (!face) {
        return false
      }

      try {
        buildConstructionPlaneFromPlanarFace(oc, face, candidate, {
          kind: 'construction',
          constructionId: 'construction_should_fail' as ConstructionId,
        })
        return false
      } catch {
        return true
      }
    })
    assert(nonPlanarFaceId != null, 'Expected cylindrical body to expose a non-planar face.')
    const axisBody = await makeBoxBody(oc, 'body_phase4_revolve_axis_planar_check' as BodyId, 1, 1, 4, 'feature_phase4_axis_planar_check' as FeatureId)
    const axisEdgeId = findEdgeIdByDirection(oc, axisBody, [0, 0, 1])
    assert(axisEdgeId != null, 'Expected axis body to expose a linear edge for revolve.')
    const context = await createContext({ bodies: [body, axisBody] })()

    let thrownMessage: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_revolve_non_planar' as FeatureId, {
        kind: 'revolve',
        featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
        parameters: {
          profiles: [{ kind: 'face', bodyId: body.bodyId, faceId: nonPlanarFaceId }],
          axis: { kind: 'edge', bodyId: axisBody.bodyId, edgeId: axisEdgeId as EdgeId },
          startAngle: 0,
          extent: { kind: 'angle', direction: 'counterClockwise', radians: Math.PI / 2 },
          operation: 'newBody',
          booleanScope: { kind: 'standalone' },
        },
      })
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }

    assert(
      thrownMessage === 'Face-backed profile requires a planar face.',
      'Face-backed revolve profiles should reject non-planar faces before invoking OCC revolve.',
    )
  }

  async function testSweepBuildsStandaloneBodyFromRegionAndDurableEdgePath() {
    const oc = await getDefaultOpenCascadeInstance()
    const pathBody = await makeBoxBody(
      oc,
      'body_phase4_sweep_path' as BodyId,
      1,
      1,
      4,
      'feature_phase4_sweep_path_seed' as FeatureId,
      [0, 0, 0],
    )
    const pathEdgeId = findEdgeIdByDirection(oc, pathBody, [0, 0, 1])
    assert(pathEdgeId != null, 'Expected path body to expose a linear Z edge for sweep.')
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_sweep' as SketchId, plane, {
      origin: [-0.2, -0.2],
      width: 0.4,
      height: 0.4,
    })
    const context = await createContext({ sketches: [sketch], bodies: [pathBody] })()

    const result = executeOccFeature(context, 'feature_phase4_sweep' as FeatureId, {
      kind: 'sweep',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          { role: 'profile', targets: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }] },
          { role: 'path', targets: [{ kind: 'edge', bodyId: pathBody.bodyId, edgeId: pathEdgeId as EdgeId }] },
        ],
      },
    })
    const bodyTarget = result.producedTargets[0]
    assert(bodyTarget?.kind === 'body', 'Standalone sweep must produce a new body target.')
    const producedBody = result.bodies.find((body) => body.bodyId === bodyTarget.bodyId)
    assert(producedBody != null, 'Standalone sweep must append the produced body.')
    assert(await bodyVolume(context.oc, producedBody.shape) > 0, 'Standalone sweep should produce non-empty solid geometry.')
  }

  async function testSweepRejectsUnsupportedGuideCurvesAndBooleanComposition() {
    const oc = await getDefaultOpenCascadeInstance()
    const pathBody = await makeBoxBody(
      oc,
      'body_phase4_sweep_reject_path' as BodyId,
      1,
      1,
      4,
      'feature_phase4_sweep_reject_path_seed' as FeatureId,
    )
    const pathEdgeId = findEdgeIdByDirection(oc, pathBody, [0, 0, 1])
    assert(pathEdgeId != null, 'Expected path body to expose a linear Z edge for sweep rejection coverage.')
    const guideEdgeId = pathBody.topology.edgeIds.find((edgeId) => edgeId !== pathEdgeId)
    assert(guideEdgeId != null, 'Expected path body to expose a second edge for guide curve coverage.')
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_sweep_reject' as SketchId, plane, {
      origin: [-0.2, -0.2],
      width: 0.4,
      height: 0.4,
    })
    const context = await createContext({ sketches: [sketch], bodies: [pathBody] })()
    const baseParticipants = [
      { role: 'profile' as const, targets: [{ kind: 'region' as const, sketchId: sketch.sketchId, regionId: region.regionId }] },
      { role: 'path' as const, targets: [{ kind: 'edge' as const, bodyId: pathBody.bodyId, edgeId: pathEdgeId as EdgeId }] },
    ]

    let guideError: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_sweep_guide_reject' as FeatureId, {
        kind: 'sweep',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'create',
          participants: [
            ...baseParticipants,
            { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: pathBody.bodyId, edgeId: guideEdgeId }] },
          ],
        },
      })
    } catch (error) {
      guideError = error instanceof Error ? error.message : String(error)
    }

    let booleanError: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_sweep_boolean_reject' as FeatureId, {
        kind: 'sweep',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'subtract',
          participants: [
            ...baseParticipants,
            { role: 'targetBody', targets: [{ kind: 'body', bodyId: pathBody.bodyId }] },
          ],
        },
      })
    } catch (error) {
      booleanError = error instanceof Error ? error.message : String(error)
    }

    assert(guideError?.includes('advanced-feature-unsupported-kernel-case') === true, 'Guide-curve sweeps must reject with an explicit unsupported-case code.')
    assert(booleanError?.includes('advanced-feature-unsupported-kernel-case') === true, 'Boolean sweeps must reject with an explicit unsupported-case code.')
  }

  async function testLoftBuildsStandaloneBodyFromOrderedProfiles() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_loft' as SketchId, plane, {
      origin: [-0.5, -0.5],
      width: 1,
      height: 1,
    })
    const faceBody = await makeBoxBody(
      oc,
      'body_phase4_loft_face' as BodyId,
      0.7,
      0.7,
      1,
      'feature_phase4_loft_face_seed' as FeatureId,
      [0.15, 0.15, 4],
    )
    const topFaceId = findFaceIdByDirection(oc, faceBody, [0, 0, 1])
    assert(topFaceId != null, 'Expected loft support body to expose an upward planar face.')
    const context = await createContext({ sketches: [sketch], bodies: [faceBody] })()

    const result = executeOccFeature(context, 'feature_phase4_loft' as FeatureId, {
      kind: 'loft',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        operationIntent: 'create',
        participants: [
          {
            role: 'profile',
            targets: [
              { kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId },
              { kind: 'face', bodyId: faceBody.bodyId, faceId: topFaceId },
            ],
          },
        ],
      },
    })
    const bodyTarget = result.producedTargets[0]
    assert(bodyTarget?.kind === 'body', 'Standalone loft must produce a new body target.')
    const producedBody = result.bodies.find((body) => body.bodyId === bodyTarget.bodyId)
    assert(producedBody != null, 'Standalone loft must append the produced body.')
    assert(await bodyVolume(context.oc, producedBody.shape) > 0, 'Standalone loft should produce non-empty solid geometry.')
  }

  async function testLoftRejectsUnsupportedGuideCurvesAndBooleanComposition() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_loft_reject' as SketchId, plane, {
      origin: [-0.5, -0.5],
      width: 1,
      height: 1,
    })
    const faceBody = await makeBoxBody(
      oc,
      'body_phase4_loft_reject_face' as BodyId,
      0.7,
      0.7,
      1,
      'feature_phase4_loft_reject_seed' as FeatureId,
      [0.15, 0.15, 4],
    )
    const topFaceId = findFaceIdByDirection(oc, faceBody, [0, 0, 1])
    const guideEdgeId = findEdgeIdByDirection(oc, faceBody, [1, 0, 0]) ?? faceBody.topology.edgeIds[0]
    assert(topFaceId != null, 'Expected loft support body to expose an upward planar face.')
    assert(guideEdgeId != null, 'Expected loft support body to expose a durable guide edge.')
    const context = await createContext({ sketches: [sketch], bodies: [faceBody] })()

    let guideError: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_loft_guide_reject' as FeatureId, {
        kind: 'loft',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'create',
          participants: [
            {
              role: 'profile',
              targets: [
                { kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId },
                { kind: 'face', bodyId: faceBody.bodyId, faceId: topFaceId },
              ],
            },
            { role: 'guideCurve', targets: [{ kind: 'edge', bodyId: faceBody.bodyId, edgeId: guideEdgeId }] },
          ],
        },
      })
    } catch (error) {
      guideError = error instanceof Error ? error.message : String(error)
    }

    let booleanError: string | null = null
    try {
      executeOccFeature(context, 'feature_phase4_loft_boolean_reject' as FeatureId, {
        kind: 'loft',
        featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
        parameters: {
          operationIntent: 'subtract',
          participants: [
            {
              role: 'profile',
              targets: [
                { kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId },
                { kind: 'face', bodyId: faceBody.bodyId, faceId: topFaceId },
              ],
            },
            { role: 'targetBody', targets: [{ kind: 'body', bodyId: faceBody.bodyId }] },
          ],
        },
      })
    } catch (error) {
      booleanError = error instanceof Error ? error.message : String(error)
    }

    assert(guideError?.includes('advanced-feature-unsupported-kernel-case') === true, 'Guide-curve lofts must reject with an explicit unsupported-case code.')
    assert(booleanError?.includes('advanced-feature-unsupported-kernel-case') === true, 'Boolean lofts must reject with an explicit unsupported-case code.')
  }

  async function testFilletReplacesAffectedBody() {
    const oc = await getDefaultOpenCascadeInstance()
    const boxBody = await makeBoxBody(oc, 'body_phase4_fillet' as BodyId, 2, 2, 2, 'feature_phase4_box' as FeatureId)
    const edgeId = boxBody.topology.edgeIds[0]
    assert(edgeId != null, 'Expected tracked box body to expose edge ids for fillet targets.')
    const context = await createContext({ bodies: [boxBody] })()

    const result = executeOccFeature(context, 'feature_phase4_fillet' as FeatureId, {
      kind: 'fillet',
      featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
      parameters: {
        radius: 0.2,
        edgeTargets: [{ kind: 'edge', bodyId: boxBody.bodyId, edgeId }],
      },
    })

    assert(result.bodies.length === 1, 'Fillet should replace the affected body in place.')
    assert(result.bodies[0]?.bodyId === boxBody.bodyId, 'Fillet should preserve the owning body id when replacing the body result.')
    assert(result.producedTargets[0]?.kind === 'body', 'Fillet should report the mutated body as its produced target.')
  }

  async function testFilletRejectsEmptyEdgeTargetList() {
    const context = await createContext()()
    let thrownMessage: string | null = null

    try {
      executeOccFeature(context, 'feature_phase4_fillet_empty' as FeatureId, {
        kind: 'fillet',
        featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
        parameters: {
          radius: 0.2,
          edgeTargets: [],
        },
      })
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }

    assert(thrownMessage === 'Fillet requires at least one target edge.', 'Fillet should reject empty target-edge lists explicitly.')
  }

  async function testSplitReplacesTargetBodyWithExplicitResultBodies() {
    const oc = await getDefaultOpenCascadeInstance()
    const targetBody = await makeBoxBody(oc, 'body_phase4_split_target' as BodyId, 6, 4, 4, 'feature_phase4_split_seed_target' as FeatureId)
    const toolBody = await makeBoxBody(oc, 'body_phase4_split_tool' as BodyId, 3, 4, 4, 'feature_phase4_split_seed_tool' as FeatureId, [2, 0, 0])
    const context = await createContext({ bodies: [targetBody, toolBody] })()

    const result = executeOccFeature(context, 'feature_phase4_split' as FeatureId, {
      kind: 'split',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'targetBody', targets: [{ kind: 'body', bodyId: targetBody.bodyId }] },
          { role: 'toolBody', targets: [{ kind: 'body', bodyId: toolBody.bodyId }] },
        ],
      },
    })

    assert(result.bodies.every((body) => body.bodyId !== targetBody.bodyId), 'Split should remove the original target body from the next state.')
    assert(result.bodies.some((body) => body.bodyId === toolBody.bodyId), 'Split should preserve the tool body in the next state.')
    assert(result.producedTargets.length >= 2, 'Split should report the produced replacement body targets.')
    assert(
      result.bodies.filter((body) => body.bodyId.startsWith('body_feature_phase4_split_')).length >= 2,
      'Split should append replacement split result bodies.',
    )
  }

  async function testDeleteSolidRemovesSelectedBodiesAndKeepsInvalidationHistory() {
    const oc = await getDefaultOpenCascadeInstance()
    const bodyA = await makeBoxBody(oc, 'body_phase4_delete_a' as BodyId, 4, 4, 4, 'feature_phase4_delete_seed_a' as FeatureId)
    const bodyB = await makeBoxBody(oc, 'body_phase4_delete_b' as BodyId, 4, 4, 4, 'feature_phase4_delete_seed_b' as FeatureId, [10, 0, 0])
    const context = await createContext({ bodies: [bodyA, bodyB] })()

    const result = executeOccFeature(context, 'feature_phase4_delete_solid' as FeatureId, {
      kind: 'deleteSolid',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'body', bodyId: bodyA.bodyId }] },
        ],
      },
    })

    assert(result.producedTargets.length === 0, 'Delete-solid should not report new produced bodies.')
    assert(result.bodies.every((body) => body.bodyId !== bodyA.bodyId), 'Delete-solid should remove the selected body from the next state.')
    assert(result.bodies.some((body) => body.bodyId === bodyB.bodyId), 'Delete-solid should preserve unselected bodies.')
    assert(result.historyInvalidations.size > 0, 'Delete-solid should preserve invalidation history for removed body topology.')
  }

  async function testMirrorCopiesBodiesAcrossExplicitPlanarReferences() {
    const oc = await getDefaultOpenCascadeInstance()
    const body = await makeBoxBody(oc, 'body_phase4_mirror' as BodyId, 4, 4, 4, 'feature_phase4_mirror_seed' as FeatureId, [4, 0, 0])
    const context = await createContext({ bodies: [body] })()

    const result = executeOccFeature(context, 'feature_phase4_mirror' as FeatureId, {
      kind: 'mirror',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'body', bodyId: body.bodyId }] },
          { role: 'plane', targets: [{ kind: 'construction', constructionId: 'construction_plane-yz' }] },
        ],
        options: { copy: true },
      },
    })

    assert(result.bodies.length === 2, 'Mirror copy should preserve the source body and append one mirrored result body.')
    assert(result.bodies.some((entry) => entry.bodyId === body.bodyId), 'Mirror copy should preserve the source body id.')
    assert(result.bodies.some((entry) => entry.bodyId !== body.bodyId), 'Mirror copy should append at least one new mirrored body.')
    assert(result.producedTargets.length === 1 && result.producedTargets[0]?.kind === 'body', 'Mirror copy should report the new mirrored body as its produced target.')
  }

  async function testTransformReplacesBodyWithTranslatedResult() {
    const oc = await getDefaultOpenCascadeInstance()
    const body = await makeBoxBody(oc, 'body_phase4_transform' as BodyId, 4, 4, 4, 'feature_phase4_transform_seed' as FeatureId)
    const context = await createContext({ bodies: [body] })()

    const result = executeOccFeature(context, 'feature_phase4_transform' as FeatureId, {
      kind: 'transform',
      featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
      parameters: {
        participants: [
          { role: 'body', targets: [{ kind: 'body', bodyId: body.bodyId }] },
          { role: 'transformReference', targets: [{ kind: 'construction', constructionId: 'construction_plane-xy' }] },
        ],
        options: { distance: 3 },
      },
    })

    assert(result.bodies.length === 1, 'Transform should replace the selected body in place.')
    assert(result.bodies[0]?.bodyId === body.bodyId, 'Transform should preserve the selected body id when replacing the translated result.')
    assert(result.producedTargets.length === 1 && result.producedTargets[0]?.kind === 'body' && result.producedTargets[0].bodyId === body.bodyId, 'Transform should report the replaced body target.')
    assert(result.historyInvalidations.size > 0, 'Transform should preserve topology invalidation history for the replaced body.')
  }

  async function testShellBuildsPreviewableSolidFromExplicitBodyAndFaces() {
    const oc = await getDefaultOpenCascadeInstance()
    const boxBody = await makeBoxBody(oc, 'body_phase4_shell' as BodyId, 4, 4, 4, 'feature_phase4_shell_seed' as FeatureId)
    const removableFaceId = findFaceIdByDirection(oc, boxBody, [0, 0, 1])
    assert(removableFaceId != null, 'Expected box body to expose a removable top face for shell.')
    const context = await createContext({ bodies: [boxBody] })()

    const result = executeOccFeature(context, 'feature_phase4_shell' as FeatureId, {
      kind: 'shell',
      featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
      parameters: {
        bodyTarget: { kind: 'body', bodyId: boxBody.bodyId },
        faceTargets: [{ kind: 'face', bodyId: boxBody.bodyId, faceId: removableFaceId }],
        thickness: 0.4,
        operation: 'newBody',
        booleanScope: { kind: 'standalone' },
      },
    })

    assert(result.producedTargets[0]?.kind === 'body', 'Shell should report its produced body target.')
    assert(result.bodies.length === 2, 'Standalone shell should preserve the source body and append the shelled result body.')
  }

  async function testOccAuthoringStateRebuildUsesFeatureExecutionFlow() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_rebuild' as SketchId, plane)
    const initialState = createOccAuthoringState(oc, { sketches: [sketch] })

    const rebuilt = rebuildOccAuthoringState(initialState, [
      {
        featureId: 'feature_phase4_rebuild_plane' as FeatureId,
        definition: {
          kind: 'plane',
          featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
          parameters: {
            mode: 'coplanar',
            reference: {
              target: {
                kind: 'construction',
                constructionId: 'construction_plane-xy' as ConstructionId,
              },
            },
          },
        },
      },
      {
        featureId: 'feature_phase4_rebuild_extrude' as FeatureId,
        definition: {
          kind: 'extrude',
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
            startExtent: { kind: 'profilePlane' },
            endExtent: { kind: 'blind', direction: 'positive', distance: 2 },
            operation: 'newBody',
            booleanScope: { kind: 'standalone' },
          },
        },
      },
    ])

    assert(rebuilt.features.length === 2, 'Authoring-state rebuild should append every applied feature to the live OCC state.')
    assert(rebuilt.constructions.some((construction) => construction.constructionId === 'construction_feature_phase4_rebuild_plane'), 'Authoring-state rebuild should persist plane-feature construction state.')
    assert(rebuilt.bodies.some((body) => body.bodyId === 'body_feature_phase4_rebuild_extrude'), 'Authoring-state rebuild should persist feature-produced bodies.')
    assert(rebuilt.entities.length === 1, 'Authoring-state rebuild should accumulate construction entity artifacts from executed features.')
    assert(rebuilt.renderRecords.length === 1, 'Authoring-state rebuild should accumulate construction render artifacts from executed features.')
  }

  async function testOccAuthoringStateRebuildIsDeterministicAcrossRepeatedRuns() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase4_rebuild_repeat' as SketchId, plane)
    const initialState = createOccAuthoringState(oc, { sketches: [sketch] })
    const features = [
      {
        featureId: 'feature_phase4_rebuild_repeat_plane' as FeatureId,
        definition: {
          kind: 'plane',
          featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
          parameters: {
            mode: 'coplanar',
            reference: {
              target: {
                kind: 'construction',
                constructionId: 'construction_plane-xy' as ConstructionId,
              },
            },
          },
        },
      },
      {
        featureId: 'feature_phase4_rebuild_repeat_extrude' as FeatureId,
        definition: {
          kind: 'extrude',
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: [{ kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId }],
            startExtent: { kind: 'profilePlane' },
            endExtent: { kind: 'blind', direction: 'positive', distance: 1 },
            operation: 'newBody',
            booleanScope: { kind: 'standalone' },
          },
        },
      },
    ] as const

    const first = rebuildOccAuthoringState(initialState, features)
    const second = rebuildOccAuthoringState(first, features)

    assert(first.features.length === second.features.length, 'Repeated rebuilds with the same feature list should not duplicate feature rows.')
    assert(first.bodies.length === second.bodies.length, 'Repeated rebuilds with the same feature list should produce the same body count.')
    assert(first.constructions.length === second.constructions.length, 'Repeated rebuilds with the same feature list should not duplicate construction rows.')
    assert(first.entities.length === second.entities.length, 'Repeated rebuilds with the same feature list should not duplicate entity artifacts.')
    assert(first.renderRecords.length === second.renderRecords.length, 'Repeated rebuilds with the same feature list should not duplicate render artifacts.')
  }

  await testPlaneFeatureDuplicatesConstructionGeometryAndProducesPresentationArtifacts()
  await testPlaneFeatureBuildsFaceBackedConstructionPlane()
  await testExtrudeFeatureCreatesStandaloneBodyFromRegion()
  await testExtrudeJoinAcrossOrderedTargetBodiesFollowsSequentialPolicy()
  await testExtrudeJoinRejectsMultiSolidResultShapes()
  await testExtrudeRejectsInvalidExtentAndBooleanScope()
  await testCutAndIntersectApplyPerTargetPolicy()
  await testRevolveRejectsConstructionAxisAndBuildsEdgeBackedSolid()
  await testRevolveRejectsNonPlanarFaceProfilesExplicitly()
  await testSweepBuildsStandaloneBodyFromRegionAndDurableEdgePath()
  await testSweepRejectsUnsupportedGuideCurvesAndBooleanComposition()
  await testLoftBuildsStandaloneBodyFromOrderedProfiles()
  await testLoftRejectsUnsupportedGuideCurvesAndBooleanComposition()
  await testFilletReplacesAffectedBody()
  await testFilletRejectsEmptyEdgeTargetList()
  await testSplitReplacesTargetBodyWithExplicitResultBodies()
  await testDeleteSolidRemovesSelectedBodiesAndKeepsInvalidationHistory()
  await testMirrorCopiesBodiesAcrossExplicitPlanarReferences()
  await testTransformReplacesBodyWithTranslatedResult()
  await testShellBuildsPreviewableSolidFromExplicitBodyAndFaces()
  await testOccAuthoringStateRebuildUsesFeatureExecutionFlow()
  await testOccAuthoringStateRebuildIsDeterministicAcrossRepeatedRuns()

  console.log('OCC phase 4 feature execution tests passed.')
})
