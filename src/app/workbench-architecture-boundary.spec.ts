import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'bun:test'

const ROOT = process.cwd()
const LAYER_ROOTS = ['src/components', 'src/contracts', 'src/domain', 'src/hooks'] as const

test('src/app/workbench-architecture-boundary.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const offenders: string[] = []

  for (const layerRoot of LAYER_ROOTS) {
    for (const filePath of walk(join(ROOT, layerRoot))) {
      if (!/\.(ts|tsx)$/.test(filePath) || /\.spec\.(ts|tsx)$/.test(filePath)) {
        continue
      }

      const source = readFileSync(filePath, 'utf8')
      if (source.includes("from '@/app/") || source.includes('from "@/app/')) {
        offenders.push(relative(ROOT, filePath))
      }
    }
  }

  assert(
    offenders.length === 0,
    `Modules outside src/app must not import app-layer workbench modules.\n${offenders.join('\n')}`,
  )
})

test('src/app/workbench-architecture-boundary.spec.ts tool activation routing', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const contextSource = readFileSync(join(ROOT, 'src/hooks/workbench-command-context.ts'), 'utf8')
  const shortcutSource = readFileSync(join(ROOT, 'src/app/workbench/commands/workbench-shortcuts.ts'), 'utf8')
  const toolButtonSource = readFileSync(join(ROOT, 'src/components/layout/tool-button.tsx'), 'utf8')
  const dropdownSource = readFileSync(join(ROOT, 'src/components/layout/tool-dropdown-button.tsx'), 'utf8')
  const workbenchSource = readFileSync(join(ROOT, 'src/app/workbench/cad-workbench.tsx'), 'utf8')

  assert(
    contextSource.includes('activateTool:'),
    'Workbench command context should expose a shared tool activation entrypoint.',
  )
  assert(
    shortcutSource.includes('activateTool')
      && !shortcutSource.includes('triggerTool: (toolId'),
    'Shortcut handlers should invoke the shared tool activation entrypoint instead of owning a separate trigger function contract.',
  )
  assert(
    toolButtonSource.includes('useWorkbenchCommandHandlers')
      && !toolButtonSource.includes('useToolActions'),
    'Toolbar tool buttons should use the shared workbench command handlers rather than calling tool hooks directly.',
  )
  assert(
    dropdownSource.includes('useWorkbenchCommandHandlers')
      && !dropdownSource.includes('useToolActions'),
    'Toolbar dropdown triggers should use the shared workbench command handlers rather than calling tool hooks directly.',
  )
  assert(
    workbenchSource.includes('activateTool: triggerTool'),
    'CadWorkbench should inject the shared tool activation entrypoint from its application composition layer.',
  )
})

function walk(directory: string): string[] {
  const entries = readdirSync(directory)
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry)
    const entryStat = statSync(entryPath)

    if (entryStat.isDirectory()) {
      files.push(...walk(entryPath))
      continue
    }

    files.push(entryPath)
  }

  return files
}
