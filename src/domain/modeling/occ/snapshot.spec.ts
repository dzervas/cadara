import { test } from 'bun:test'
import type { ModelingKernelAdapter } from '@/contracts/modeling/adapter'
import {
  createModelingService,
  type ModelingService,
} from '@/domain/modeling/modeling-service'
import type {
  ConstructionSnapshotRecord,
  FeatureDefinition,
  GetDocumentSnapshotResponse,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type { FeatureId, SketchEntityId, SketchId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from '@/contracts/sketch/schema'
import {
  buildOccWorkspaceSnapshot,
} from '@/domain/modeling/occ/snapshot'
import {
  createOccAuthoringState,
  rebuildOccAuthoringState,
} from '@/domain/modeling/occ/authoring-state'
import { getDefaultOpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import { toGpPnt } from '@/domain/modeling/occ/planes'
import { trackNewSolidBody } from '@/domain/modeling/occ/topology'
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  OCC_KERNEL_SETTINGS,
  createStandardPlaneDefinition,
} from '@/domain/modeling/opencascade-kernel-seed'

test('src/domain/modeling/occ/snapshot.spec.ts', async () => {
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

    return {
      sketch: createSketchRecord(
        sketchId,
        plane,
        definition,
        [
          {
            kind: 'lineSegment',
            entityId: entities[0]!.entityId,
            startPosition: points[0]!.position,
            endPosition: points[1]!.position,
          },
          {
            kind: 'lineSegment',
            entityId: entities[1]!.entityId,
            startPosition: points[1]!.position,
            endPosition: points[2]!.position,
          },
          {
            kind: 'lineSegment',
            entityId: entities[2]!.entityId,
            startPosition: points[2]!.position,
            endPosition: points[3]!.position,
          },
          {
            kind: 'lineSegment',
            entityId: entities[3]!.entityId,
            startPosition: points[3]!.position,
            endPosition: points[0]!.position,
          },
        ],
        [region],
      ),
      region,
    }
  }

  function createConstructionSnapshot(constructionId: ConstructionSnapshotRecord['constructionId']): ConstructionSnapshotRecord {
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

  async function createBoxBody() {
    const oc = await getDefaultOpenCascadeInstance()
    const box = new oc.BRepPrimAPI_MakeBox_3(toGpPnt(oc, [0, 0, 0]), 10, 8, 6)
    box.Build(new oc.Message_ProgressRange_1())
    assert(box.IsDone(), 'Expected OCC box builder to succeed for phase 6 snapshot tests.')

    return trackNewSolidBody(oc, {
      bodyId: 'body_phase6_seed',
      label: 'Seed Body',
      ownerFeatureId: 'feature_seed',
      shape: box.Shape(),
    })
  }

  function createSnapshotAdapter(snapshot: GetDocumentSnapshotResponse['snapshot']): ModelingKernelAdapter {
    return {
      async getDocumentSnapshot() {
        return {
          contractVersion: snapshot.document.contractVersion,
          snapshot,
        }
      },
      async commitSketch() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async createFeature() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async updateFeature() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async deleteFeature() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async renameBody() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async reorderFeature() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async setFeatureCursor() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async evaluatePreview() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
      async resolveReference() {
        throw new Error('Not implemented in phase 6 snapshot test adapter.')
      },
    }
  }

  function createModelingSnapshotValidator(snapshot: GetDocumentSnapshotResponse['snapshot']): ModelingService {
    return createModelingService(createSnapshotAdapter(snapshot), {
      currentDocumentId: OCC_KERNEL_DOCUMENT_ID,
    })
  }

  async function testWorkspaceSnapshotBuildsContractValidRenderExport() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createStandardPlaneDefinition('xy')
    const { sketch, region } = createRectangleSketch('sketch_phase6_snapshot' as SketchId, plane)
    const initialState = createOccAuthoringState(oc, {
      sketches: [sketch],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    })
    const features: readonly {
      featureId: FeatureId
      definition: FeatureDefinition
    }[] = [
      {
        featureId: 'feature_phase6_plane' as FeatureId,
        definition: {
          kind: 'plane',
          featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
          parameters: {
            mode: 'coplanar',
            reference: {
              target: {
                kind: 'construction',
                constructionId: 'construction_plane-xy',
              },
            },
          },
        },
      },
      {
        featureId: 'feature_phase6_extrude' as FeatureId,
        definition: {
          kind: 'extrude',
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            profiles: [{
              kind: 'region',
              sketchId: sketch.sketchId,
              regionId: region.regionId,
            }],
            startExtent: { kind: 'profilePlane' },
            endExtent: { kind: 'blind', direction: 'positive', distance: 6 },
            operation: 'newBody',
            booleanScope: { kind: 'standalone' },
          },
        },
      },
    ]
    const rebuilt = rebuildOccAuthoringState(initialState, features)
    const snapshot = buildOccWorkspaceSnapshot(rebuilt)
    const validator = createModelingSnapshotValidator(snapshot)
    const normalized = await validator.getCurrentDocumentSnapshot()

    assert(normalized.document.documentId === OCC_KERNEL_DOCUMENT_ID, 'Phase 6 workspace snapshot must preserve the document ID.')
    assert(normalized.document.render.records.length > 0, 'Phase 6 workspace snapshot must export render records.')
    assert(normalized.document.featureTree.length >= 5, 'Phase 6 workspace snapshot must populate the feature tree.')
    assert(normalized.document.objects.length >= 4, 'Phase 6 workspace snapshot must populate the object tree.')
    assert(normalized.document.features.length === 2, 'Phase 6 workspace snapshot must include every rebuilt feature.')
    assert(normalized.document.bodies.length === 1, 'Phase 6 workspace snapshot must include rebuilt body snapshots.')

    const planarFaceEntity = normalized.document.entities.find((entry) =>
      entry.target.kind === 'face' && entry.selectionSemantics.includes('planarFace'),
    )
    assert(planarFaceEntity, 'Phase 6 snapshot entities must expose planar-face selection semantics.')
    assert(
      planarFaceEntity.selectionSemantics.includes('planarReference'),
      'Planar face entities must also advertise planar-reference semantics.',
    )

    const constructionEntity = normalized.document.entities.find((entry) =>
      entry.target.kind === 'construction' && entry.selectionSemantics.includes('constructionPlane'),
    )
    assert(constructionEntity, 'Phase 6 snapshot entities must expose construction-plane semantics.')
    assert(
      constructionEntity.selectionSemantics.includes('planarReference'),
      'Construction entities must also advertise planar-reference semantics.',
    )

    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === 'face' && record.binding.semanticClass === 'planarFace',
      ),
      'Phase 6 render export must include planar-face mesh bindings.',
    )
    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === 'edge' && record.binding.semanticClass === 'featureEdge',
      ),
      'Phase 6 render export must include edge polyline bindings.',
    )
    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === 'vertex' && record.binding.semanticClass === 'featureVertex',
      ),
      'Phase 6 render export must include vertex marker bindings.',
    )
    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === null && record.binding.semanticClass === 'construction',
      ),
      'Phase 6 render export must include construction render bindings.',
    )
    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === null
        && record.binding.semanticClass === 'construction'
        && record.geometry.kind === 'mesh',
      ),
      'Phase 6 render export must expose filled construction-plane surfaces for viewport picking.',
    )
    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === null
        && record.binding.semanticClass === 'region'
        && record.binding.target.kind === 'region'
        && record.geometry.kind === 'mesh',
      ),
      'Phase 6 render export must expose filled sketch-region surfaces for viewport profile picking.',
    )
    const yzConstruction = normalized.document.constructions.find(
      (construction) => construction.constructionId === 'construction_plane-yz',
    )
    assert(yzConstruction, 'Phase 6 snapshot must include the standard YZ construction plane.')
    assert(
      yzConstruction.plane.key === 'yz' && yzConstruction.plane.frame.normal[0] === 1,
      'Construction snapshots must carry explicit plane definitions for non-XY sketch entry.',
    )
    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === null && record.binding.semanticClass === 'sketchCurve',
      ),
      'Phase 6 render export must include sketch-curve render bindings.',
    )
    assert(
      normalized.document.render.records.some((record) =>
        record.binding.topology === null && record.binding.semanticClass === 'sketchPoint',
      ),
      'Phase 6 render export must include sketch-point render bindings.',
    )
  }

  async function testWorkspaceSnapshotPreservesInvalidatedReferencesWithoutPromotingDiagnostics() {
    const oc = await getDefaultOpenCascadeInstance()
    const baseBody = await createBoxBody()
    const initialState = createOccAuthoringState(oc, {
      bodies: [baseBody],
      constructions: [createConstructionSnapshot('construction_plane-xy')],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    })
    const targetEdgeId = baseBody.topology.edgeIds[0]
    assert(targetEdgeId, 'Expected the seeded box body to expose at least one durable edge.')

    const rebuilt = rebuildOccAuthoringState(initialState, [
      {
        featureId: 'feature_phase6_fillet' as FeatureId,
        definition: {
          kind: 'fillet',
          featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
          parameters: {
            radius: 0.5,
            edgeTargets: [
              {
                kind: 'edge',
                bodyId: baseBody.bodyId,
                edgeId: targetEdgeId,
              },
            ],
          },
        },
      },
    ])
    const snapshot = buildOccWorkspaceSnapshot(rebuilt)
    const invalidatedEdge = snapshot.document.references.find((reference) =>
      reference.target.kind === 'edge'
      && reference.target.bodyId === baseBody.bodyId
      && reference.target.edgeId === targetEdgeId
      && reference.invalidation !== null,
    )

    assert(invalidatedEdge, 'Phase 6 snapshot references must preserve invalidated durable topology targets.')
    assert(
      !snapshot.document.diagnostics.some((diagnostic) =>
        diagnostic.code === 'occ-invalid-reference'
        && diagnostic.detail?.kind === 'invalidReference',
      ),
      'Phase 6 snapshot diagnostics must not surface historical invalidated references after a successful rebuild.',
    )
  }

  async function testOccSnapshotSurfacesSketchNavigationAndHistory() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createStandardPlaneDefinition('xy')
    const { sketch } = createRectangleSketch('sketch_phase6_history' as SketchId, plane)
    const state = createOccAuthoringState(oc, {
      sketches: [sketch],
    })
    const snapshot = buildOccWorkspaceSnapshot(state)

    assert(
      snapshot.presentation.objects.some((item) =>
        item.kind === 'sketch'
        && item.target.kind === 'sketch'
        && item.target.sketchId === sketch.sketchId,
      ),
      'OCC snapshot object navigation must include committed sketch rows.',
    )
    assert(
      snapshot.presentation.documentHistory.some((item) =>
        item.kind === 'sketch'
        && item.target.kind === 'sketch'
        && item.target.sketchId === sketch.sketchId,
      ),
      'OCC snapshot document history must include committed sketch items.',
    )
  }

  await testWorkspaceSnapshotBuildsContractValidRenderExport()
  await testWorkspaceSnapshotPreservesInvalidatedReferencesWithoutPromotingDiagnostics()
  await testOccSnapshotSurfacesSketchNavigationAndHistory()

  console.log('OCC phase 6 snapshot/export tests passed.')
})
