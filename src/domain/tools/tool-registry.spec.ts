import { test } from 'bun:test'

import { getToolById, getToolbarSectionsForMode, searchToolDefinitions } from '@/core/tools/tool-registry'
import { toolIconAssetFileNames } from '@/core/tools/tool-icons'

test('src/domain/tools/tool-registry.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const importTool = getToolById('import')
  const partToolIds = getToolbarSectionsForMode('part').flatMap((section) => section.toolIds)
  const sketchToolIds = getToolbarSectionsForMode('sketch').flatMap((section) => section.toolIds)

  assert(importTool.group === 'import', 'Import should register in the import toolbar group.')
  assert(importTool.tooltip.includes('image') && importTool.tooltip.includes('mesh'), 'Import should describe generic supported file categories.')
  assert(toolIconAssetFileNames[importTool.icon] === 'import-part.svg', 'Import should use the requested public SVG asset.')
  assert(partToolIds.includes('import'), 'Import should be visible in part mode.')
  assert(!sketchToolIds.includes('import'), 'Import should not be visible while sketching.')
  assert(searchToolDefinitions('image').some((tool) => tool.id === 'import'), 'Tool search should discover Import by image intent.')
  assert(searchToolDefinitions('mesh').some((tool) => tool.id === 'import'), 'Tool search should discover Import by mesh intent.')
})
