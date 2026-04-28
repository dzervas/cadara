import { test } from 'bun:test'

import type { ReferenceImagePlacement } from '@/contracts/reference-image/schema'
import type { SketchPoint2D } from '@/contracts/sketch/schema'

import { solveReferenceImageCalibration } from '@/domain/reference-image-calibration/solver/solve-reference-image-calibration'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function mapAnchorToWorld(
  uv: SketchPoint2D,
  placement: ReferenceImagePlacement,
): SketchPoint2D {
  const localX = (uv[0] - 0.5) * placement.width
  const localY = (0.5 - uv[1]) * placement.height
  const cos = Math.cos(placement.rotationRadians)
  const sin = Math.sin(placement.rotationRadians)
  return [
    placement.center[0] + localX * cos - localY * sin,
    placement.center[1] + localX * sin + localY * cos,
  ]
}

test('src/domain/reference-image-calibration/solver/solve-reference-image-calibration.spec.ts solves rotated exact fits', () => {
  const exactPlacement = {
    center: [18, -12] as const,
    width: 120,
    height: 60,
    rotationRadians: Math.PI / 4,
  }
  const anchors = [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.1, 0.8],
    [0.9, 0.8],
  ].map((uv, index) => ({
    anchorId: `anchor_${index}`,
    label: `Anchor ${index + 1}`,
    uv: uv as SketchPoint2D,
    worldPosition: mapAnchorToWorld(uv as SketchPoint2D, exactPlacement),
  }))

  for (const scaleMode of ['lockedAspect', 'independent'] as const) {
    const result = solveReferenceImageCalibration({
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
      scaleMode,
      anchors,
      constraints: [],
    })

    assert(result.diagnostics.length === 0, `${scaleMode} rotated exact fit should solve without diagnostics.`)
    assert(Math.abs(result.placement.center[0] - exactPlacement.center[0]) < 1e-3, `${scaleMode} rotated solve should recover center X.`)
    assert(Math.abs(result.placement.center[1] - exactPlacement.center[1]) < 1e-3, `${scaleMode} rotated solve should recover center Y.`)
    assert(Math.abs(result.placement.width - exactPlacement.width) < 1e-3, `${scaleMode} rotated solve should recover width.`)
    assert(Math.abs(result.placement.height - exactPlacement.height) < 1e-3, `${scaleMode} rotated solve should recover height.`)
    assert(Math.abs(result.placement.rotationRadians - exactPlacement.rotationRadians) < 1e-3, `${scaleMode} rotated solve should recover rotation.`)
  }
})

test('src/domain/reference-image-calibration/solver/solve-reference-image-calibration.spec.ts detects independent axis-degenerate targets as underconstrained', () => {
  const result = solveReferenceImageCalibration({
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
    scaleMode: 'independent',
    anchors: [
      {
        anchorId: 'anchor_a',
        label: 'Anchor A',
        uv: [0.25, 0.5],
        worldPosition: [-50, 0],
      },
      {
        anchorId: 'anchor_b',
        label: 'Anchor B',
        uv: [0.75, 0.5],
        worldPosition: [50, 0],
      },
    ],
    constraints: [],
  })

  assert(
    result.diagnostics.some((diagnostic) => diagnostic.code === 'underconstrained-calibration'),
    'Independent calibration should mark a single-axis target set as underconstrained.',
  )
  assert(result.placement.height > 1, 'Independent underconstrained solves should not collapse the unconstrained image axis.')
})

test('src/domain/reference-image-calibration/solver/solve-reference-image-calibration.spec.ts validates anchor-fit residuals after solving', () => {
  const result = solveReferenceImageCalibration({
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
    scaleMode: 'lockedAspect',
    anchors: [
      {
        anchorId: 'anchor_a',
        label: 'Anchor A',
        uv: [0.25, 0.5],
        worldPosition: [-50, 0],
      },
      {
        anchorId: 'anchor_b',
        label: 'Anchor B',
        uv: [0.75, 0.5],
        worldPosition: [50, 0],
      },
    ],
    constraints: [{
      constraintId: 'constraint_conflict',
      kind: 'distance',
      label: 'Conflict',
      firstAnchorId: 'anchor_a',
      secondAnchorId: 'anchor_b',
      distance: 10,
    }],
  })

  assert(
    result.diagnostics.some((diagnostic) => diagnostic.code === 'unsatisfied-anchor-target'),
    'Conflicting calibration should surface anchor-fit residual warnings, not only distance warnings.',
  )
  assert(
    result.diagnostics.some((diagnostic) => diagnostic.code === 'unsatisfied-distance-constraint'),
    'Conflicting calibration should still report unsatisfied distance constraints.',
  )
})
