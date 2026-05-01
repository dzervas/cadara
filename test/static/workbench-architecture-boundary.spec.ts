import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'bun:test'

const ROOT = process.cwd()
const LAYER_ROOTS = [
  'src/application',
  'src/components',
  'src/contracts',
  'src/core',
  'src/domain',
  'src/hooks',
  'src/infrastructure',
] as const

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
  const toolActionsSource = readFileSync(join(ROOT, 'src/hooks/use-tool-actions.ts'), 'utf8')

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
  assert(
    toolActionsSource.includes('getToolCommandBehavior')
      && toolActionsSource.includes('resolveToolActivationMode')
      && !toolActionsSource.includes('isRegisteredSketchToolId')
      && !toolActionsSource.includes('isRegisteredSketchConstraintToolId')
      && !toolActionsSource.includes('isRegisteredSketchEditToolId'),
    'Tool activation policy should flow through shared tool metadata helpers instead of duplicating sketch tool classification in the hook layer.',
  )
})

test('src/app/workbench-architecture-boundary.spec.ts workbench document ownership routing', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const workbenchSource = readFileSync(join(ROOT, 'src/app/workbench/cad-workbench.tsx'), 'utf8')
  const historySource = readFileSync(join(ROOT, 'src/app/workbench/controllers/use-workbench-history.ts'), 'utf8')
  const importSource = readFileSync(join(ROOT, 'src/app/workbench/controllers/use-workbench-part-import.ts'), 'utf8')
  const fileActionsSource = readFileSync(join(ROOT, 'src/app/workbench/document/workbench-document-actions.ts'), 'utf8')
  const ownerHookSource = readFileSync(join(ROOT, 'src/hooks/use-workbench-document-owner.ts'), 'utf8')
  const ownerServiceSource = readFileSync(join(ROOT, 'src/application/workbench/document-owner.ts'), 'utf8')
  const presentationHookSource = readFileSync(join(ROOT, 'src/app/workbench/controllers/use-workbench-document-presentation.ts'), 'utf8')

  assert(
    ownerHookSource.includes('createWorkbenchDocumentOwner')
      && ownerServiceSource.includes('document.snapshotLoaded')
      && ownerServiceSource.includes('document.replaced'),
    'Workbench document owner should keep distinct incremental snapshot and whole-document replacement handoffs while the hook remains a thin adapter.',
  )
  assert(
    historySource.includes('useWorkbenchDocumentOwner')
      && !historySource.includes('modelingService.updateDocumentVariable')
      && !historySource.includes('modelingService.reorderDocumentHistory')
      && !historySource.includes('modelingService.getCurrentDocumentSnapshot'),
    'Workbench history controller should delegate variable and reorder ownership to the shared document owner hook.',
  )
  assert(
    importSource.includes('useWorkbenchDocumentOwner')
      && !importSource.includes('applyImportPreparedActions')
      && !importSource.includes('prepareImportActions')
      && !importSource.includes('applyLoadedSnapshot'),
    'Workbench part import controller should delegate accepted import completion through the shared document owner hook.',
  )
  assert(
    workbenchSource.includes('const documentOwner = useWorkbenchDocumentOwner()')
      && !workbenchSource.includes('modelingService.deleteTarget')
      && !workbenchSource.includes('modelingService.updateFeature')
      && !workbenchSource.includes('modelingService.commitSketch')
      && !workbenchSource.includes('modelingService.renameBody'),
    'CadWorkbench should not own ordinary document mutation sequencing once the shared document owner hook is in place.',
  )
  assert(
    fileActionsSource.includes('replaceAfterDocumentFileAction')
      && !fileActionsSource.includes('refreshAfterDocumentFileAction'),
    'Whole-document file flows should use the explicit replacement handoff instead of the ordinary refresh callback.',
  )
  assert(
    presentationHookSource.includes('resetForDocumentReplacement')
      && presentationHookSource.includes('setInvalidVariableValueMessages({})'),
    'Document-scoped shell presentation state should expose one reset path for whole-document replacement flows.',
  )
})

test('src/app/workbench-architecture-boundary.spec.ts extension registry composition ownership', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const appSource = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8')
  const modelingServiceSource = readFileSync(join(ROOT, 'src/domain/modeling/modeling-service/service.ts'), 'utf8')
  const importControllerSource = readFileSync(join(ROOT, 'src/app/workbench/controllers/use-workbench-part-import.ts'), 'utf8')
  const specialModeRegistrySource = readFileSync(join(ROOT, 'src/core/sketch-special-modes/registry.ts'), 'utf8')
  const specialModePresentationSource = readFileSync(join(ROOT, 'src/core/sketch-special-modes/presentation.ts'), 'utf8')

  assert(
    appSource.includes('createBuiltinRuntimeExtensionRegistryComposition')
      && appSource.includes('RuntimeExtensionRegistryProvider')
      && appSource.includes('exportProviders: runtimeExtensionRegistries.exportProviders'),
    'Application bootstrap should own runtime extension registry composition and inject it into services and UI.',
  )
  assert(
    !modelingServiceSource.includes('registerBuiltinExportProviders')
      && !modelingServiceSource.includes('registerExportProvider('),
    'Modeling service construction must not register built-in export providers as a side effect.',
  )
  assert(
    importControllerSource.includes('importProviders.getAcceptedFileTypes()')
      && importControllerSource.includes('importProviders.matchProviders('),
    'Import flows should consume explicit import-provider lookup surfaces instead of ambient registry helpers.',
  )
  assert(
    !specialModeRegistrySource.includes('let sketchSpecialModeRegistry'),
    'Sketch special-mode registry composition should be immutable rather than replaced through process-global state.',
  )
  assert(
    specialModePresentationSource.includes('registry: SketchSpecialModeRegistry')
      && !specialModePresentationSource.includes('getRegisteredSketchSpecialModeDefinitions()'),
    'Sketch special-mode presentation should consume an explicit registry and avoid registry-owned global discovery.',
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
