import { test } from 'bun:test'

import { createReferenceImageOperation } from '@/domain/reference-image/operations'
import {
  createReferenceImageCalibrationAnchor,
  replaceReferenceImagePayloadPreservingCalibration,
  solveReferenceImageOperationState,
} from '@/domain/reference-image-calibration/state'

test('src/domain/reference-image-calibration/state.spec.ts', () => {
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

  const calibrated = solveReferenceImageOperationState({
    ...operation.ownedState,
    calibration: {
      ...operation.ownedState.calibration!,
      anchors: [
        createReferenceImageCalibrationAnchor({
          anchorId: 'anchor_a',
          anchorIndex: 0,
          uv: [0.2, 0.8],
          worldPosition: [-20, -10],
        }),
        createReferenceImageCalibrationAnchor({
          anchorId: 'anchor_b',
          anchorIndex: 1,
          uv: [0.8, 0.2],
          worldPosition: [20, 10],
        }),
      ],
    },
  })
  const replaced = replaceReferenceImagePayloadPreservingCalibration({
    state: calibrated,
    image: {
      mediaType: 'image/jpeg',
      fileName: 'replacement.jpg',
      pixelWidth: 1200,
      pixelHeight: 800,
      base64Data: 'cmVwbGFjZW1lbnQ=',
    },
  })

  assert(
    JSON.stringify(replaced.calibration?.anchors.map((anchor) => anchor.uv)) === JSON.stringify([[0.2, 0.8], [0.8, 0.2]]),
    'Replacing the inline image payload should preserve anchor UV coordinates.',
  )
  assert(
    replaced.image.fileName === 'replacement.jpg' && replaced.calibration.solveResult.anchors.length === 2,
    'Replacing the image should keep calibration anchors available to the dedicated solver.',
  )
})

test('src/domain/reference-image-calibration/state.spec.ts preserves the last stable placement when calibration is ambiguous', () => {
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
          worldPosition: [-50, 0],
        }),
        createReferenceImageCalibrationAnchor({
          anchorId: 'anchor_b',
          anchorIndex: 1,
          uv: [0.75, 0.5],
          worldPosition: [50, 0],
        }),
      ],
    },
  })

  assert(
    solved.calibration.solveResult.diagnostics.some((diagnostic) => diagnostic.code === 'underconstrained-calibration'),
    'Fixture should produce an honestly underconstrained independent calibration.',
  )
  assert(
    JSON.stringify(solved.placement) === JSON.stringify(initialPlacement),
    'Ambiguous calibration should not overwrite the last stable reference-image placement.',
  )
})
