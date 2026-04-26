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

  assert(source.includes('showPartImport={false}'), 'Workbench toolbar should keep part import disabled.')
  assert(!source.includes('partImportInputRef'), 'Workbench should not keep the legacy part import input wiring.')
})
