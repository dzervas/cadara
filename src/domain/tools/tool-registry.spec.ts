import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { getToolById, getToolbarSectionsForMode, searchToolDefinitions } from '@/core/tools/tool-registry'
import { toolIconAssetFileNames } from '@/core/tools/tool-icons'

test('src/domain/tools/tool-registry.spec.ts', () => {  const importTool = getToolById('import')
  const partToolIds = getToolbarSectionsForMode('part').flatMap((section) => section.toolIds)
  const sketchToolIds = getToolbarSectionsForMode('sketch').flatMap((section) => section.toolIds)

  expectTrue(importTool.group === 'import', 'Import should register in the import toolbar group.')
  expectTrue(importTool.tooltip.includes('image') && importTool.tooltip.includes('mesh'), 'Import should describe generic supported file categories.')
  expectTrue(toolIconAssetFileNames[importTool.icon] === 'import-part.svg', 'Import should use the requested public SVG asset.')
  expectTrue(partToolIds.includes('import'), 'Import should be visible in part mode.')
  expectTrue(!sketchToolIds.includes('import'), 'Import should not be visible while sketching.')
  expectTrue(searchToolDefinitions('image').some((tool) => tool.id === 'import'), 'Tool search should discover Import by image intent.')
  expectTrue(searchToolDefinitions('mesh').some((tool) => tool.id === 'import'), 'Tool search should discover Import by mesh intent.')
})
