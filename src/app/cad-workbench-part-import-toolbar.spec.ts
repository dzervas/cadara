import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/cad-workbench-part-import-toolbar.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const workbenchSource = readFileSync(join(process.cwd(), 'src/app/workbench/cad-workbench.tsx'), 'utf8')
  const importSource = readFileSync(join(process.cwd(), 'src/app/workbench/controllers/use-workbench-part-import.ts'), 'utf8')
  const toolButtonSource = readFileSync(join(process.cwd(), 'src/components/layout/tool-button.tsx'), 'utf8')

  assert(!workbenchSource.includes('showPartImport='), 'Workbench should no longer gate the import tool behind a toolbar prop.')
  assert(
    workbenchSource.includes('requestPartImport,') && workbenchSource.includes('commitImportSession'),
    'Workbench should compose the shared part-import controller for toolbar activation and inspector commit.',
  )
  assert(
    importSource.includes('showOpenImportFilePicker')
      && importSource.includes('matchImportProviders')
      && importSource.includes("dispatch({ type: 'import.fileSelected', session })"),
    'The shared part-import controller should own file picking, provider matching, and import-session startup.',
  )
  assert(
    toolButtonSource.includes('useWorkbenchCommandHandlers')
      && toolButtonSource.includes('activateTool(tool.id'),
    'Toolbar tool buttons should invoke the shared workbench command entrypoint rather than calling tool hooks directly.',
  )
})
