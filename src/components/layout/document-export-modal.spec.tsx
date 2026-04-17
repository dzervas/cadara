import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  DocumentExportModal,
} from '@/components/layout/document-export-modal'
import { buildDocumentExportModalInput } from '@/components/layout/document-export-modal-input'
import { getDefaultDocumentExportOptions } from '@/contracts/modeling/export.runtime-schema'
import type { ObjectExportModalState } from '@/app/object-export-state'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/document-export-modal.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const target: ObjectExportModalState = {
    target: { kind: 'body', bodyId: 'body_part-1' },
    label: 'Part 1',
    baseRevisionId: 'rev_0001',
  }

  const stlMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <DocumentExportModal
        opened
        target={target}
        withinPortal={false}
        exportDocument={async () => ({ ok: false, format: 'stl', diagnostics: [] })}
        onClose={() => undefined}
        onDownload={() => undefined}
      />
    </MantineProvider>,
  )

  assert(stlMarkup.includes('Export Part 1'), 'Export modal should be scoped to the selected row label.')
  assert(stlMarkup.includes('STL'), 'Export modal should list STL.')
  assert(stlMarkup.includes('STEP'), 'Export modal should list STEP.')
  assert(stlMarkup.includes('3MF'), 'Export modal should list 3MF.')
  assert(stlMarkup.includes('cadara'), 'Export modal should list cadara.')
  assert(stlMarkup.includes('Mesh accuracy'), 'STL export should show mesh accuracy controls.')
  assert(!stlMarkup.includes('STEP options'), 'STL export should not show STEP-specific controls.')
  assert(!stlMarkup.includes('cadara JSON'), 'STL export should not show cadara-specific controls.')

  const stepMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <DocumentExportModal
        opened
        initialFormat="step"
        target={target}
        withinPortal={false}
        exportDocument={async () => ({ ok: false, format: 'step', diagnostics: [] })}
        onClose={() => undefined}
        onDownload={() => undefined}
      />
    </MantineProvider>,
  )

  assert(stepMarkup.includes('STEP options'), 'STEP export should show STEP-specific controls.')
  assert(!stepMarkup.includes('Mesh accuracy'), 'STEP export should omit mesh accuracy controls.')

  const cadaraMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <DocumentExportModal
        opened
        initialFormat="cadara"
        target={target}
        withinPortal={false}
        exportDocument={async () => ({ ok: false, format: 'cadara', diagnostics: [] })}
        onClose={() => undefined}
        onDownload={() => undefined}
      />
    </MantineProvider>,
  )

  assert(cadaraMarkup.includes('cadara JSON'), 'cadara export should show JSON options.')
  assert(!cadaraMarkup.includes('Mesh accuracy'), 'cadara export should omit mesh accuracy controls.')

  const input = buildDocumentExportModalInput(
    target,
    'step',
    getDefaultDocumentExportOptions('step'),
  )

  assert(input.format === 'step', 'Modal submission should preserve the selected format.')
  assert(!('meshAccuracy' in input.options), 'Modal submission should not include incompatible mesh options for STEP.')
})
