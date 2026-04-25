import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/cad-workbench-step-import-review.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const source = readFileSync(join(process.cwd(), 'src/app/cad-workbench.tsx'), 'utf8')

  assert(
    source.includes('await modelingService.prepareStepImportReview({ files: stepFiles })'),
    'STEP import should prepare a review from the selected STEP files.',
  )
  assert(
    source.includes('onImportDocument={handleImportDocument}') && !source.includes('Add STEP files'),
    'The File menu should stay on document import and the STEP review modal should not add more STEP files.',
  )
  assert(
    source.includes('handleStepImportSelectAll') && source.includes('indeterminate={someStepSolidsSelected}'),
    'STEP import review should expose select-all with an indeterminate state.',
  )
  assert(
    source.includes('At least one solid must be selected.') && source.includes("disabled={stepImportFlow.kind !== 'review' || stepImportDisabled}"),
    'STEP import review should disable import and explain empty selection.',
  )
  assert(
    source.includes('stepImportFlow.review.diagnostics.map'),
    'STEP import review should render preparation diagnostics.',
  )
  assert(
    source.includes('selectedSolidKeys: review.selectedSolidKeys'),
    'STEP import review should commit the selected subset payload.',
  )
  assert(
    source.includes("setStepImportFlow({ kind: 'idle' })")
    && source.includes('data-step-import-progress')
    && source.includes('Baking Cadara geometry'),
    'STEP import commit should leave the modal and show background baking progress.',
  )
  assert(
    source.includes('subscribeToStepImportMaterializationStatus')
    && source.includes('data-step-import-materialization-status')
    && source.includes('Persisted faceted presentation is visible while OCC restore continues separately.'),
    'STEP import should surface a dedicated persistent background materialization status after import progress completes.',
  )
  assert(
    !source.includes("kind: 'importing'") && !source.includes('title={stepImportFlow.kind ==='),
    'STEP import should not hold the modal open in a blocking importing state.',
  )
})
