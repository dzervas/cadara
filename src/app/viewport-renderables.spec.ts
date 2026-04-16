import { test } from 'bun:test'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import { composeViewportRenderables, isTargetHidden } from '@/app/viewport-renderables'

test('src/app/viewport-renderables.spec.ts', async () => {
  function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function assertEqual<T>(actual: T, expected: T, message = 'Expected values to match') {
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
    assert(composed.documentRenderables.every(({ origin }) => origin === 'document'))
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
    assert(
      isTargetHidden(
        { kind: 'sketchPoint', sketchId: 'sketch_a', pointId: 'sketch_point_a' },
        { 'sketch:sketch_a': true },
      ),
      'Sketch-owned selection targets should be hidden when their owning committed sketch is hidden.',
    )
  }
})
