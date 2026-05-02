import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  getToolCommandBehavior,
  resolveToolActivationMode,
} from '@/core/tools/activation-policy'

test('src/core/tools/activation-policy.spec.ts', () => {
  expectTrue(
    getToolCommandBehavior('undo') === 'undo',
    'Undo should declare undo behavior through tool metadata.',
  )
  expectTrue(
    getToolCommandBehavior('redo') === 'redo',
    'Redo should declare redo behavior through tool metadata.',
  )
  expectTrue(
    getToolCommandBehavior('import') === 'partImport',
    'Part import should declare import behavior through tool metadata.',
  )
  expectTrue(
    getToolCommandBehavior('importImage') === 'sketchReferenceImageImport',
    'Sketch reference-image import should declare image-import behavior through tool metadata.',
  )
  expectTrue(
    getToolCommandBehavior('line') === null,
    'Ordinary modeling tools should not declare special command behavior.',
  )

  expectTrue(
    resolveToolActivationMode('undo', 'part') === 'part',
    'Undo should preserve the current toolbar mode.',
  )
  expectTrue(
    resolveToolActivationMode('redo', 'sketch') === 'sketch',
    'Redo should preserve the current toolbar mode.',
  )
  expectTrue(
    resolveToolActivationMode('sketch', 'part') === 'part',
    'Sketch should log and route activation from part mode.',
  )
  expectTrue(
    resolveToolActivationMode('finishSketch', 'sketch') === 'sketch',
    'Finish Sketch should remain a sketch-mode activation.',
  )
  expectTrue(
    resolveToolActivationMode('line', 'part') === 'sketch',
    'Sketch-only tools should resolve to sketch mode from metadata alone.',
  )
  expectTrue(
    resolveToolActivationMode('extrude', 'sketch') === 'part',
    'Part-only tools should resolve to part mode from metadata alone.',
  )
})
