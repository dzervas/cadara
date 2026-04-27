import { test } from 'bun:test'

import { solveReferenceImageCalibration } from '@/domain/reference-image-calibration/solver/solve-reference-image-calibration'

test('src/domain/reference-image-calibration/solver/solve-reference-image-calibration.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const input = {
    image: {
      pixelWidth: 400,
      pixelHeight: 200,
    },
    initialPlacement: {
      center: [0, 0] as const,
      width: 200,
      height: 100,
      rotationRadians: 0,
    },
    constraints: [],
  } as const

  const locked = solveReferenceImageCalibration({
    ...input,
    scaleMode: 'lockedAspect',
    anchors: [
      {
        anchorId: 'anchor_a',
        label: 'Anchor A',
        uv: [0.25, 0.25],
        worldPosition: [-50, 50],
      },
      {
        anchorId: 'anchor_b',
        label: 'Anchor B',
        uv: [0.75, 0.25],
        worldPosition: [50, 50],
      },
      {
        anchorId: 'anchor_c',
        label: 'Anchor C',
        uv: [0.25, 0.75],
        worldPosition: [-50, -50],
      },
    ],
  })
  const independent = solveReferenceImageCalibration({
    ...input,
    scaleMode: 'independent',
    anchors: [
      {
        anchorId: 'anchor_a',
        label: 'Anchor A',
        uv: [0.25, 0.25],
        worldPosition: [-50, 50],
      },
      {
        anchorId: 'anchor_b',
        label: 'Anchor B',
        uv: [0.75, 0.25],
        worldPosition: [50, 50],
      },
      {
        anchorId: 'anchor_c',
        label: 'Anchor C',
        uv: [0.25, 0.75],
        worldPosition: [-50, -50],
      },
    ],
  })

  assert(
    Math.abs((locked.placement.width / locked.placement.height) - 2) < 1e-2,
    'Locked-aspect calibration should preserve the image aspect ratio.',
  )
  assert(
    Math.abs((independent.placement.width / independent.placement.height) - 2) > 0.25,
    'Independent calibration should solve without forcing the image aspect ratio.',
  )
  assert(
    independent.anchors.length === 3 && locked.anchors.length === 3,
    'Dedicated calibration solving should return solved positions for every calibration anchor.',
  )
})
