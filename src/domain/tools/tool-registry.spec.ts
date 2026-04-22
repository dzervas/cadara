import { test } from 'bun:test'

import { getToolById, getToolbarSectionsForMode, searchToolDefinitions } from '@/domain/tools/tool-registry'
import { toolIconAssetFileNames } from '@/domain/tools/tool-icons'

test('src/domain/tools/tool-registry.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const importPart = getToolById('importPart')
  const partToolIds = getToolbarSectionsForMode('part').flatMap((section) => section.toolIds)
  const sketchToolIds = getToolbarSectionsForMode('sketch').flatMap((section) => section.toolIds)

  assert(importPart.group === 'import', 'Import Part should register in the import toolbar group.')
  assert(importPart.tooltip.includes('STEP') && importPart.tooltip.includes('STL') && importPart.tooltip.includes('3MF'), 'Import Part should describe supported part formats.')
  assert(toolIconAssetFileNames[importPart.icon] === 'import-part.svg', 'Import Part should use the requested public SVG asset.')
  assert(partToolIds.includes('importPart'), 'Import Part should be visible in part mode.')
  assert(!sketchToolIds.includes('importPart'), 'Import Part should not be visible while sketching.')
  assert(searchToolDefinitions('mesh').some((tool) => tool.id === 'importPart'), 'Tool search should discover Import Part by mesh intent.')
  assert(searchToolDefinitions('step').some((tool) => tool.id === 'importPart'), 'Tool search should discover Import Part by STEP intent.')
})
