import { test } from 'bun:test'
import { strict as assert } from 'node:assert'

import {
  VIEW_CUBE_CORNER_TARGETS,
  VIEW_CUBE_FACE_TARGETS,
} from '@/infrastructure/viewport/view-cube-navigation'

test('src/domain/workspace/view-cube-navigation.spec.ts', async () => {
  assert.equal(VIEW_CUBE_FACE_TARGETS.length, 6, 'The cube should expose the six principal face targets.')
  assert.deepEqual(
    VIEW_CUBE_FACE_TARGETS.map(({ label }) => label),
    ['Front', 'Back', 'Right', 'Left', 'Top', 'Bottom'],
    'The transparent cube should keep a stable centered label for every face.',
  )
  assert(
    VIEW_CUBE_FACE_TARGETS
      .filter(({ presetId }) => presetId !== 'top' && presetId !== 'bottom')
      .every(({ labelUp }) => labelUp[0] === 0 && labelUp[1] === 0 && labelUp[2] === 1),
    'The vertical face labels should stay upright relative to the world Z axis.',
  )
  assert.deepEqual(
    VIEW_CUBE_FACE_TARGETS.find(({ presetId }) => presetId === 'top')?.labelUp,
    [0, 1, 0],
    'The top label should use an explicit in-face up vector.',
  )
  assert.deepEqual(
    VIEW_CUBE_FACE_TARGETS.find(({ presetId }) => presetId === 'bottom')?.labelUp,
    [0, -1, 0],
    'The bottom label should use an explicit in-face up vector.',
  )
  assert.deepEqual(
    new Set(VIEW_CUBE_FACE_TARGETS.map(({ presetId }) => presetId)).size,
    6,
    'Each face target should map to a unique principal preset.',
  )
  assert.equal(VIEW_CUBE_CORNER_TARGETS.length, 8, 'The cube should expose all eight corner snap targets.')
  assert(
    VIEW_CUBE_CORNER_TARGETS.some(({ presetId, position }) => (
      presetId === 'frontRightTop'
      && position[0] > 0
      && position[1] < 0
      && position[2] > 0
    )),
    'Corner target positions should preserve the sign of their shared camera snap preset.',
  )
  assert(
    VIEW_CUBE_CORNER_TARGETS.every(({ position }) => position.every((value) => Math.abs(value) < 0.62)),
    'Corner targets should sit on the cube body instead of floating outside the cube extent.',
  )
})
