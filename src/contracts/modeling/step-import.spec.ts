import { test } from 'bun:test'

import { getStepDocumentBasename } from '@/contracts/modeling/step-import'

test('src/contracts/modeling/step-import.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(
    getStepDocumentBasename('Parts\\Start%20Button%20v2.STEP') === 'start button v2.step',
    'STEP document basename matching should normalize paths, percent escapes, extension case, and case.',
  )
  assert(
    getStepDocumentBasename('./Sub/Info Bar.STEP?rev=1') === 'info bar.step',
    'STEP document basename matching should ignore query and fragment suffixes from exported references.',
  )
})
