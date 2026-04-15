import { test } from 'bun:test'
import type { ConstructionSnapshotRecord, FeatureDefinition, SketchSnapshotRecord } from '@/contracts/modeling/schema'
import type { ConstructionId, SketchEntityId, SketchId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import { PLANE_FEATURE_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition as AuthoredSketchDefinition,
  type SketchRecord,
} from '@/contracts/sketch/schema'
import { getDefaultOpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  advanceTopologyToken,
  createBodySnapshotRecord,
  createInitialTopologyToken,
  createOccReferenceState,
  resolveOccReference,
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  trackReplacementSolidBody,
} from '@/domain/modeling/occ/topology'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  createStandardPlaneDefinition,
} from '@/domain/modeling/opencascade-kernel-seed'
import { toGpPnt } from '@/domain/modeling/occ/planes'

test('src/domain/modeling/occ/topology.spec.ts', async () => {
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

  function createConstruction(constructionId: ConstructionId): ConstructionSnapshotRecord {
    const standardKey =
      constructionId === 'construction_plane-xy'
        ? 'xy'
        : constructionId === 'construction_plane-yz'
          ? 'yz'
          : 'xz'

    return {
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      ownerFeatureId: null,
      ownerSketchId: null,
      ownerBodyId: null,
      constructionId,
      label: constructionId,
      constructionType: 'plane',
      plane: createStandardPlaneDefinition(standardKey),
      target: { kind: 'construction', constructionId },
    }
  }

  function createSketchDefinition(sketchId: SketchId): AuthoredSketchDefinition {
    const bottomLeft = pointId(`${sketchId}_bottom_left`)
    const bottomRight = pointId(`${sketchId}_bottom_right`)
    const topRight = pointId(`${sketchId}_top_right`)
    const topLeft = pointId(`${sketchId}_top_left`)
    const bottom = entityId(`${sketchId}_bottom`)

    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: [bottomLeft, bottomRight, topRight, topLeft],
      points: [
        {
          pointId: bottomLeft,
          label: bottomLeft,
          target: { kind: 'sketchPoint', sketchId, pointId: bottomLeft },
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: bottomRight,
          label: bottomRight,
          target: { kind: 'sketchPoint', sketchId, pointId: bottomRight },
          position: [4, 0],
          isConstruction: false,
        },
        {
          pointId: topRight,
          label: topRight,
          target: { kind: 'sketchPoint', sketchId, pointId: topRight },
          position: [4, 2],
          isConstruction: false,
        },
        {
          pointId: topLeft,
          label: topLeft,
          target: { kind: 'sketchPoint', sketchId, pointId: topLeft },
          position: [0, 2],
          isConstruction: false,
        },
      ],
      entityIds: [bottom],
      entities: [
        {
          kind: 'lineSegment',
          entityId: bottom,
          label: bottom,
          target: { kind: 'sketchEntity', sketchId, entityId: bottom },
          isConstruction: false,
          startPointId: bottomLeft,
          endPointId: bottomRight,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
  }

  function createSketchSnapshot(sketchId: SketchId, plane: SketchPlaneDefinition): SketchSnapshotRecord {
    const definition = createSketchDefinition(sketchId)
    const regionId = `region_${sketchId}_profile` as const
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
      loops: [],
      isClosed: true,
    }
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
          constraintState: 'underConstrained',
        },
        solvedEntities: [],
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      regions: [region],
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

  async function makeBoxBody(token: string) {
    const oc = await getDefaultOpenCascadeInstance()
    const builder = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 10, 8, 6)
    builder.Build(new oc.Message_ProgressRange_1())
    assert(builder.IsDone(), 'Expected OCC box builder to succeed in topology test.')

    let body = trackNewSolidBody(oc, {
      bodyId: 'body_seed',
      label: 'Seed Body',
      ownerFeatureId: 'feature_seed',
      shape: builder.Shape(),
    })

    while (body.topologyToken !== token) {
      body = trackReplacementSolidBody(oc, {
        previous: body,
        ownerFeatureId: body.ownerFeatureId,
        shape: builder.Shape(),
      })
    }

    return body
  }

  function testTopologyTokensAdvanceForReplacementBodies() {
    const initial = createInitialTopologyToken()
    const next = advanceTopologyToken(initial)

    assert(initial === 't0001', 'Initial topology token must start at t0001 for the first body state.')
    assert(next === 't0002', 'Topology token advancement must produce a stable incremented token.')
  }

  async function testBodySnapshotsAndReferenceStateExposeLiveTopology() {
    const body = await makeBoxBody(createInitialTopologyToken())
    const xyPlane = createStandardPlaneDefinition('xy')
    const sketch = createSketchSnapshot('sketch_topology', xyPlane)
    const feature: { featureId: `feature_${string}`; definition: FeatureDefinition } = {
      featureId: 'feature_probe',
      definition: {
        kind: 'plane',
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: 'coplanar',
          reference: {
            target: {
              kind: 'construction',
              constructionId: (xyPlane.support.kind === 'construction'
                ? xyPlane.support.constructionId
                : 'construction_plane-xy') as ConstructionId,
            },
          },
        },
      },
    }
    const referenceState = createOccReferenceState({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      bodies: [body],
      constructions: [createConstruction('construction_plane-xy')],
      sketches: [sketch],
      features: [feature],
    })
    const snapshot = createBodySnapshotRecord({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    }, body)
    const faceId = body.topology.faceIds[0]
    const edgeId = body.topology.edgeIds[0]
    const point = sketch.sketch.definition.points[0]
    const entity = sketch.sketch.definition.entities[0]
    const region = sketch.sketch.regions[0]

    assert(snapshot.topology.faceIds[0] === faceId, 'Body snapshot must preserve enumerated face ids.')
    assert(snapshot.topology.edgeIds[0] === edgeId, 'Body snapshot must preserve enumerated edge ids.')
    assert(faceId.includes('_t0001_'), 'Face ids must encode the current body topology token.')
    assert(edgeId.includes('_t0001_'), 'Edge ids must encode the current body topology token.')

    const liveFaceResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      referenceState,
    }, { kind: 'face', bodyId: body.bodyId, faceId })

    assert(liveFaceResolution.resolution.invalidation === null, 'Live topology references must resolve without invalidation.')
    assert(liveFaceResolution.resolution.ownerBodyId === body.bodyId, 'Live topology references must retain owning body metadata.')

    const liveSketchPointResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      referenceState,
    }, { kind: 'sketchPoint', sketchId: sketch.sketchId, pointId: point.pointId })

    assert(liveSketchPointResolution.resolution.invalidation === null, 'Live sketch points must resolve without invalidation.')
    assert(liveSketchPointResolution.resolution.ownerSketchId === sketch.sketchId, 'Live sketch-point references must retain owning sketch metadata.')

    const liveSketchEntityResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      referenceState,
    }, { kind: 'sketchEntity', sketchId: sketch.sketchId, entityId: entity.entityId })

    assert(liveSketchEntityResolution.resolution.invalidation === null, 'Live sketch entities must resolve without invalidation.')

    const liveRegionResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      referenceState,
    }, { kind: 'region', sketchId: sketch.sketchId, regionId: region.regionId })

    assert(liveRegionResolution.resolution.invalidation === null, 'Live region references must resolve without invalidation.')

    const liveFeatureResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      referenceState,
    }, { kind: 'feature', featureId: feature.featureId })

    assert(liveFeatureResolution.resolution.invalidation === null, 'Live feature references must resolve without invalidation.')
  }

  async function testMissingTopologyReferencesInvalidateAgainstPriorState() {
    const original = await makeBoxBody(createInitialTopologyToken())
    const replaced = await makeBoxBody(advanceTopologyToken(original.topologyToken))
    const staleFaceId = original.topology.faceIds[0]
    const staleEdgeId = original.topology.edgeIds[0]
    const staleVertexId = original.topology.vertexIds[0]
    const previous = createOccReferenceState({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      bodies: [original],
      constructions: [createConstruction('construction_plane-xy')],
      sketches: [],
      features: [],
    })
    const nextRevisionId = 'rev_0002' as const
    const current = createOccReferenceState({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: nextRevisionId,
      bodies: [replaced],
      constructions: [createConstruction('construction_plane-xy')],
      sketches: [],
      features: [],
      previous,
      historyInvalidations: new Map([
        [
          `face:${original.bodyId}:${staleFaceId}`,
          {
            target: { kind: 'face', bodyId: original.bodyId, faceId: staleFaceId },
            reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
            sourceTarget: { kind: 'body', bodyId: original.bodyId },
          },
        ],
        [
          `edge:${original.bodyId}:${staleEdgeId}`,
          {
            target: { kind: 'edge', bodyId: original.bodyId, edgeId: staleEdgeId },
            reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
            sourceTarget: { kind: 'body', bodyId: original.bodyId },
          },
        ],
      ]),
    })

    const missingFaceResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: nextRevisionId,
      referenceState: current,
    }, { kind: 'face', bodyId: original.bodyId, faceId: staleFaceId })

    assert(
      missingFaceResolution.resolution.invalidation?.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
      'Modified topology references must preserve the history-driven invalidation reason.',
    )
    assert(
      missingFaceResolution.resolution.invalidation?.sourceTarget?.kind === 'body',
      'Missing topology references must point back to the owning body as the invalidation source.',
    )
    assert(
      missingFaceResolution.resolution.ownerRevisionId === nextRevisionId,
      'Invalidated references must be restamped to the revision that observed the invalidation.',
    )
    assert(
      missingFaceResolution.diagnostics[0]?.detail?.kind === 'invalidReference',
      'Missing topology references must surface a structured invalidReference diagnostic.',
    )

    const missingEdgeResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: nextRevisionId,
      referenceState: current,
    }, { kind: 'edge', bodyId: original.bodyId, edgeId: staleEdgeId })

    assert(
      missingEdgeResolution.resolution.invalidation?.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
      'Deleted edge references must preserve the history-driven invalidation reason.',
    )

    const missingVertexResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: nextRevisionId,
      referenceState: current,
    }, { kind: 'vertex', bodyId: original.bodyId, vertexId: staleVertexId })

    assert(
      missingVertexResolution.resolution.invalidation?.sourceTarget?.kind === 'body',
      'Missing vertex references must point back to the owning body as the invalidation source.',
    )

    const neverExistedResolution = resolveOccReference({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: nextRevisionId,
      referenceState: current,
    }, { kind: 'face', bodyId: original.bodyId, faceId: 'face_body_seed_t9999_1' })

    assert(
      neverExistedResolution.resolution.invalidation?.sourceTarget === null,
      'Never-seen references must not fabricate an owning source target.',
    )
  }

  await testTopologyTokensAdvanceForReplacementBodies()
  await testBodySnapshotsAndReferenceStateExposeLiveTopology()
  await testMissingTopologyReferencesInvalidateAgainstPriorState()

  console.log('OCC phase 5 topology/reference tests passed.')
})
