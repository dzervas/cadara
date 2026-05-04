import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import { composeViewportRenderables, isTargetHidden } from '@/app/workbench/shell/viewport-renderables'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  startSketchDraw,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

test('src/app/viewport-renderables.spec.ts', async () => {  function assertEqual<T>(actual: T, expected: T, message = 'Expected values to match') {
    if (actual !== expected) {
      throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`)
    }
  }

  const committedFace: RenderableEntityRecord = {
    id: 'renderable_face_committed',
    label: 'Committed face',
    ownerBodyId: 'body_a',
    ownerFeatureId: 'feature_a',
    binding: {
      pickId: 'pick_face_committed',
      pickPriority: 10,
      target: { kind: 'face', bodyId: 'body_a', faceId: 'face_a' },
      topology: 'face',
      semanticClass: 'bodyFace',
    },
    geometry: {
      kind: 'mesh',
      vertexPositions: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      vertexNormals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      triangleIndices: [[0, 1, 2]],
    },
  }

  const committedEdge: RenderableEntityRecord = {
    id: 'renderable_edge_committed',
    label: 'Committed edge',
    ownerBodyId: 'body_a',
    ownerFeatureId: 'feature_a',
    binding: {
      pickId: 'pick_edge_committed',
      pickPriority: 5,
      target: { kind: 'edge', bodyId: 'body_a', edgeId: 'edge_a' },
      topology: 'edge',
      semanticClass: 'featureEdge',
    },
    geometry: {
      kind: 'polyline',
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      isClosed: false,
    },
  }

  const previewFace: RenderableEntityRecord = {
    ...committedFace,
    id: 'renderable_face_preview',
    label: 'Preview face',
    binding: {
      ...committedFace.binding,
      pickId: 'pick_face_preview',
    },
  }

  const committedSketchCurve: RenderableEntityRecord = {
    id: 'renderable_sketch_curve_committed',
    label: 'Committed sketch curve',
    ownerBodyId: null,
    ownerFeatureId: null,
    binding: {
      pickId: 'pick_sketch_curve_committed',
      pickPriority: 5,
      target: { kind: 'sketchEntity', sketchId: 'sketch_a', entityId: 'sketch_entity_a' },
      topology: null,
      semanticClass: 'sketchCurve',
    },
    geometry: {
      kind: 'polyline',
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      isClosed: false,
    },
  }

  function createCommittedRegion(
    sketchId: 'sketch_a' | 'sketch_b',
    regionId: 'region_a' | 'region_b',
  ): RenderableEntityRecord {
    return {
      id: `renderable_${regionId}`,
      label: `Committed ${regionId}`,
      ownerBodyId: null,
      ownerFeatureId: null,
      binding: {
        pickId: `pick_${regionId}`,
        pickPriority: 3,
        target: { kind: 'region', sketchId, regionId },
        topology: null,
        semanticClass: 'region',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [[0, 1, 2]],
      },
    }
  }

  {
    const composed = composeViewportRenderables({
      snapshotRenderables: [committedFace, committedEdge],
      previewRenderables: [previewFace],
      sketchSession: null,
      hiddenTargetKeys: {},
    })

    assertEqual(composed.documentRenderables.length, 3)
    assertEqual(composed.documentRenderables[0]?.origin, 'document')
    assertEqual(composed.documentRenderables[1]?.origin, 'document')
    assertEqual(composed.documentRenderables[2]?.origin, 'preview')
  }

  {
    const composed = composeViewportRenderables({
      snapshotRenderables: [committedFace, committedEdge],
      previewRenderables: null,
      sketchSession: null,
      hiddenTargetKeys: {},
    })

    assertEqual(composed.documentRenderables.length, 2)
    expectTrue(composed.documentRenderables.every(({ origin }) => origin === 'document'))
  }

  {
    const composed = composeViewportRenderables({
      snapshotRenderables: [committedFace, committedEdge],
      previewRenderables: [previewFace],
      sketchSession: null,
      hiddenTargetKeys: {
        'body:body_a': true,
      },
    })

    assertEqual(composed.documentRenderables.length, 0)
    expectTrue(
      isTargetHidden(
        { kind: 'face', bodyId: 'body_a', faceId: 'face_a' },
        { 'body:body_a': true },
      ),
      'Body-hidden visibility should hide body-owned topology selection targets.',
    )
  }

  {
    const composed = composeViewportRenderables({
      snapshotRenderables: [committedFace, committedEdge, committedSketchCurve],
      previewRenderables: [previewFace],
      sketchSession: null,
      hiddenTargetKeys: {
        'sketch:sketch_a': true,
      },
    })

    assertEqual(composed.documentRenderables.length, 3)
    assertEqual(composed.documentRenderables[0]?.renderable.id, committedFace.id)
    assertEqual(composed.documentRenderables[1]?.renderable.id, committedEdge.id)
    assertEqual(composed.documentRenderables[2]?.renderable.id, previewFace.id)
    expectTrue(
      isTargetHidden(
        { kind: 'sketchPoint', sketchId: 'sketch_a', pointId: 'sketch_point_a' },
        { 'sketch:sketch_a': true },
      ),
      'Sketch-owned selection targets should be hidden when their owning committed sketch is hidden.',
    )
  }

  {
    const activeSession = {
      ...createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      sketchId: 'sketch_a',
    }
    const activeSketchRegion = createCommittedRegion('sketch_a', 'region_a')
    const otherSketchRegion = createCommittedRegion('sketch_b', 'region_b')

    const composed = composeViewportRenderables({
      snapshotRenderables: [committedFace, committedSketchCurve, activeSketchRegion, otherSketchRegion],
      previewRenderables: null,
      sketchSession: activeSession,
      hiddenTargetKeys: {},
    })

    assertEqual(composed.documentRenderables.length, 2)
    expectTrue(
      composed.documentRenderables.every(({ renderable }) => renderable.id !== activeSketchRegion.id),
      'Committed regions from the actively edited sketch should be hidden.',
    )
    expectTrue(
      composed.documentRenderables.every(({ renderable }) => renderable.id !== committedSketchCurve.id),
      'Committed sketch curves from the actively edited sketch should be hidden.',
    )
    expectTrue(
      composed.documentRenderables.some(({ renderable }) => renderable.id === otherSketchRegion.id),
      'Committed regions from inactive sketches should remain visible.',
    )
  }

  {
    const plane = createStandardPlaneDefinition('xy')
    const sketchSnapshot = {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_a',
      ownerBodyId: null,
      sketchId: 'sketch_a',
      label: 'Sketch A',
      plane,
      planeTarget: plane.support,
      planeKey: 'xy',
      sketch: {
        ownerDocumentId: 'doc_workspace',
        ownerRevisionId: 'rev_0001',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_a',
        ownerBodyId: null,
        sketchId: 'sketch_a',
        label: 'Sketch A',
        planeSupport: plane.support,
        definition: {
          schemaVersion: 'sketch-definition/v1alpha1',
          referenceIds: [],
          references: [],
          pointIds: [],
          points: [],
          entityIds: ['sketch_entity_a'],
          entities: [],
          constraintIds: ['constraint_horizontal'],
          constraints: [{
            kind: 'horizontal',
            constraintId: 'constraint_horizontal',
            label: 'Horizontal',
            entityId: 'sketch_entity_a',
          }],
          dimensionIds: [],
          dimensions: [],
        },
        solvedSnapshot: {
          schemaVersion: 'solved-sketch/v1alpha1',
          status: { solveState: 'partiallySolved', constraintState: 'underConstrained' },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [{ constraintId: 'constraint_horizontal', status: 'unsatisfied' }],
          dimensionStatuses: [],
          diagnostics: [],
        },
        projectedReferences: [],
        regions: [],
      },
    } satisfies SketchSnapshotRecord
    const composed = composeViewportRenderables({
      snapshotRenderables: [committedSketchCurve],
      snapshotSketches: [sketchSnapshot],
      previewRenderables: null,
      sketchSession: null,
      hiddenTargetKeys: {},
    })

    expectTrue(
      composed.documentRenderables[0]?.sketchConstraintDisplay?.isAffectedOverconstraint,
      'Committed sketch renderables should carry solved constraint display diagnostics from their sketch snapshot.',
    )
  }

  {
    let session = beginSketchTool(
      createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' }),
      'spline',
    )
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [1, 2])

    const previewComposed = composeViewportRenderables({
      snapshotRenderables: [],
      previewRenderables: null,
      sketchSession: session,
      hiddenTargetKeys: {},
    })

    expectTrue(
      previewComposed.sketchDisplayRenderables.some((renderable) =>
        renderable.label === 'Spline preview'
        && renderable.geometry.kind === 'polyline'
        && renderable.geometry.points.length >= 2,
      ),
      'Spline preview should render as viewport polyline feedback.',
    )

    session = acceptSketchDraw(session, [3, 0])
    const committedComposed = composeViewportRenderables({
      snapshotRenderables: [],
      previewRenderables: null,
      sketchSession: session,
      hiddenTargetKeys: {},
    })

    expectTrue(
      committedComposed.sketchDisplayRenderables.some((renderable) =>
        renderable.target?.kind === 'sketchEntity'
        && renderable.geometry.kind === 'polyline'
        && renderable.geometry.points.length > 3,
      ),
      'Persisted spline geometry should render as a sampled viewport polyline.',
    )
  }
})
