import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'bun:test'

test('src/app/cad-workbench-part-import-toolbar.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const source = readFileSync(join(process.cwd(), 'src/app/cad-workbench.tsx'), 'utf8')
  const acceptLiteral = "const PART_IMPORT_FILE_ACCEPT = '.step,.stp,.stl,.3mf,model/step,model/stl,model/3mf'"

  assert(source.includes("actionBus.subscribeToTool('importPart', openPartImportPicker)"), 'Import Part toolbar activation should open the part import picker.')
  assert(source.includes('partImportInputRef.current?.click()'), 'Import Part should use a real file input click.')
  assert(source.includes('void handleImportDocument(file)'), 'Import Part should route selected files through the existing STEP and mesh import flow.')
  assert(source.includes(acceptLiteral), 'Import Part picker should accept only STEP, STL, and 3MF formats.')
  assert(source.includes('accept={PART_IMPORT_FILE_ACCEPT}'), 'Import Part input should use the dedicated part import accept list.')
  assert(!acceptLiteral.includes('.cadara'), 'Import Part picker should not include full-document cadara imports.')
})
