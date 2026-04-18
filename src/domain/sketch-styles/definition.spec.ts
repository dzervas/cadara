import { test } from 'bun:test'

import {
  SKETCH_STYLE_PATCH_INTENT,
  buildSketchStyleControls,
  parseSketchStylePatch,
} from '@/domain/sketch-styles/definition'

test('src/domain/sketch-styles/definition.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const controls = buildSketchStyleControls(undefined)
  assert(controls.some((control) => control.id === 'sketch-style-fill-mode'), 'Style controls should expose fill mode.')
  assert(controls.some((control) => control.id === 'sketch-style-gradient-start'), 'Style controls should expose gradient start color.')
  assert(controls.some((control) => control.id === 'sketch-style-stroke-join'), 'Style controls should expose stroke join.')

  const accepted = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: 'strokeWidth',
    value: 3,
  })
  assert(accepted?.field === 'strokeWidth' && accepted.value === 3, 'Style patch parser should accept local style fields.')

  const rejected = parseSketchStylePatch({
    intent: SKETCH_STYLE_PATCH_INTENT,
    field: 'externalGeometryRef',
    value: 'paint://other-sketch',
  })
  assert(rejected === null, 'Style patch parser should ignore external style sources.')
})
