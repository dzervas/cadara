import { test } from 'bun:test'

import { createReferenceImageOperation } from '@/domain/reference-image/operations'
import {
  createReferenceImageCalibrationAnchor,
  replaceReferenceImagePayloadPreservingCalibration,
  solveReferenceImageOperationState,
} from '@/domain/reference-image-calibration/state'

test('src/domain/reference-image-calibration/state.spec.ts preserves anchor UVs and point bindings when replacing the image payload', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: 'sketch_primary',
    payload: {
      mediaType: 'image/png',
      fileName: 'original.png',
      pixelWidth: 400,
      pixelHeight: 200,
      base64Data: 'b3JpZ2luYWw=',
    },
  })

  const pointPositionsById = new Map([
    ['sketch_point_anchor_a', [-20, -10] as const],
    ['sketch_point_anchor_b', [20, 10] as const],
  ])

  const calibrated = solveReferenceImageOperationState({
    ...operation.ownedState,
    calibration: {
      ...operation.ownedState.calibration!,
      anchors: [
        createReferenceImageCalibrationAnchor({
          anchorId: 'anchor_a',
          anchorIndex: 0,
          uv: [0.2, 0.8],
          pointId: 'sketch_point_anchor_a',
        }),
        createReferenceImageCalibrationAnchor({
          anchorId: 'anchor_b',
          anchorIndex: 1,
          uv: [0.8, 0.2],
          pointId: 'sketch_point_anchor_b',
        }),
      ],
    },
  }, { pointPositionsById })
  const replaced = replaceReferenceImagePayloadPreservingCalibration({
    state: calibrated,
    image: {
      mediaType: 'image/jpeg',
      fileName: 'replacement.jpg',
      pixelWidth: 1200,
      pixelHeight: 800,
      base64Data: 'cmVwbGFjZW1lbnQ=',
    },
    pointPositionsById,
  })

  assert(
    JSON.stringify(replaced.calibration?.anchors.map((anchor) => anchor.uv)) === JSON.stringify([[0.2, 0.8], [0.8, 0.2]]),
    'Replacing the inline image payload should preserve anchor UV coordinates.',
  )
  assert(
    JSON.stringify(replaced.calibration?.anchors.map((anchor) => anchor.pointId)) === JSON.stringify(['sketch_point_anchor_a', 'sketch_point_anchor_b']),
    'Replacing the inline image payload should preserve the local point bindings.',
  )
})

test('src/domain/reference-image-calibration/state.spec.ts preserves the last stable placement when bound anchors are insufficient', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: 'sketch_primary',
    payload: {
      mediaType: 'image/png',
      fileName: 'original.png',
      pixelWidth: 400,
      pixelHeight: 200,
      base64Data: 'b3JpZ2luYWw=',
    },
  })

  const initialPlacement = operation.ownedState.placement
  const solved = solveReferenceImageOperationState({
    ...operation.ownedState,
    calibration: {
      ...operation.ownedState.calibration!,
      scaleMode: 'independent',
      anchors: [
        createReferenceImageCalibrationAnchor({
          anchorId: 'anchor_a',
          anchorIndex: 0,
          uv: [0.25, 0.5],
          pointId: 'sketch_point_anchor_a',
        }),
      ],
    },
  }, {
    pointPositionsById: new Map([
      ['sketch_point_anchor_a', [-50, 0] as const],
    ]),
  })

  assert(
    solved.calibration.solveResult.diagnostics.some((diagnostic) => diagnostic.code === 'underconstrained-calibration'),
    'A single bound anchor should leave the independent fit underconstrained.',
  )
  assert(
    JSON.stringify(solved.placement) === JSON.stringify(initialPlacement),
    'Ambiguous calibration should not overwrite the last stable reference-image placement.',
  )
})
