import { test } from 'bun:test'

import {
  getToolCommandBehavior,
  resolveToolActivationMode,
} from '@/core/tools/activation-policy'

test('src/domain/tools/activation-policy.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(
    getToolCommandBehavior('undo') === 'undo',
    'Undo should declare undo behavior through tool metadata.',
  )
  assert(
    getToolCommandBehavior('redo') === 'redo',
    'Redo should declare redo behavior through tool metadata.',
  )
  assert(
    getToolCommandBehavior('import') === 'partImport',
    'Part import should declare import behavior through tool metadata.',
  )
  assert(
    getToolCommandBehavior('importImage') === 'sketchReferenceImageImport',
    'Sketch reference-image import should declare image-import behavior through tool metadata.',
  )
  assert(
    getToolCommandBehavior('line') === null,
    'Ordinary modeling tools should not declare special command behavior.',
  )

  assert(
    resolveToolActivationMode('undo', 'part') === 'part',
    'Undo should preserve the current toolbar mode.',
  )
  assert(
    resolveToolActivationMode('redo', 'sketch') === 'sketch',
    'Redo should preserve the current toolbar mode.',
  )
  assert(
    resolveToolActivationMode('sketch', 'part') === 'part',
    'Sketch should log and route activation from part mode.',
  )
  assert(
    resolveToolActivationMode('finishSketch', 'sketch') === 'sketch',
    'Finish Sketch should remain a sketch-mode activation.',
  )
  assert(
    resolveToolActivationMode('line', 'part') === 'sketch',
    'Sketch-only tools should resolve to sketch mode from metadata alone.',
  )
  assert(
    resolveToolActivationMode('extrude', 'sketch') === 'part',
    'Part-only tools should resolve to part mode from metadata alone.',
  )
})
