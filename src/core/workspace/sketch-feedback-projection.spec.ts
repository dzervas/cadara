import { test } from 'bun:test'

import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { projectSketchFeedbackAnchor, resolveSketchFeedbackAnchorWorldPoint } from '@/core/workspace/sketch-feedback-projection'

test('src/core/workspace/sketch-feedback-projection.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const plane = createStandardPlaneDefinition('xy')
  const anchor = {
    kind: 'sketchPoint' as const,
    point: [2, 3] as const,
    offset: { x: 5, y: -7 },
  }
  const worldPoint = resolveSketchFeedbackAnchorWorldPoint(anchor, plane)

  assert(
    JSON.stringify(worldPoint) === JSON.stringify([2, 3, 0]),
    'Sketch feedback anchors should resolve sketch-space points through the active sketch plane.',
  )

  const screenPoint = projectSketchFeedbackAnchor({
    anchor,
    plane,
    viewport: { width: 200, height: 100 },
    projectWorldPoint: (point) => ({
      x: point[0] / 10,
      y: point[1] / 10,
      z: 0,
    }),
  })

  assert(screenPoint, 'Projected feedback anchor should produce a screen point.')
  assert(screenPoint.x === 125, 'Projected feedback anchors should include horizontal descriptor offsets.')
  assert(screenPoint.y === 28, 'Projected feedback anchors should include vertical descriptor offsets.')
})
