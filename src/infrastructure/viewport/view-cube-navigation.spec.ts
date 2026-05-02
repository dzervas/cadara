import { expect, test } from 'bun:test'

import {
  VIEW_CUBE_CORNER_TARGETS,
  VIEW_CUBE_FACE_TARGETS,
} from '@/infrastructure/viewport/view-cube-navigation'

test('src/infrastructure/viewport/view-cube-navigation.spec.ts', async () => {
  expect(VIEW_CUBE_FACE_TARGETS.length).toBe(6)
  expect(VIEW_CUBE_FACE_TARGETS.map(({ label }) => label)).toEqual(['Front', 'Back', 'Right', 'Left', 'Top', 'Bottom'])
  expect(
    VIEW_CUBE_FACE_TARGETS
      .filter(({ presetId }) => presetId !== 'top' && presetId !== 'bottom')
      .every(({ labelUp }) => labelUp[0] === 0 && labelUp[1] === 0 && labelUp[2] === 1),
  ).toBe(true)
  expect(VIEW_CUBE_FACE_TARGETS.find(({ presetId }) => presetId === 'top')?.labelUp).toEqual([0, 1, 0])
  expect(VIEW_CUBE_FACE_TARGETS.find(({ presetId }) => presetId === 'bottom')?.labelUp).toEqual([0, -1, 0])
  expect(new Set(VIEW_CUBE_FACE_TARGETS.map(({ presetId }) => presetId)).size).toBe(6)
  expect(VIEW_CUBE_CORNER_TARGETS.length).toBe(8)
  expect(
    VIEW_CUBE_CORNER_TARGETS.some(({ presetId, position }) => (
      presetId === 'frontRightTop'
      && position[0] > 0
      && position[1] < 0
      && position[2] > 0
    )),
  ).toBe(true)
  expect(
    VIEW_CUBE_CORNER_TARGETS.every(({ position }) => position.every((value) => Math.abs(value) < 0.62)),
  ).toBe(true)
})
