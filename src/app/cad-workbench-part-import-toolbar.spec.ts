import { beforeEach, mock, test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createImportProviderRegistry } from '@/domain/import/provider-registry'
import { createScopedRuntimeExtensionRegistryCompositionForTest } from '@/domain/extensions/test-registry-composition'

import { createHookTestHarness } from './workbench/controllers/controller-test-harness'

const hookHarness = createHookTestHarness()
const actualReactModule = await import('react')
const actualRuntimeExtensionRegistryModule = await import('@/hooks/use-runtime-extension-registry')
const actualWorkbenchDocumentOwnerModule = await import('@/hooks/use-workbench-document-owner')
mock.module('react', () => hookHarness.reactModule)
mock.module('@/hooks/use-runtime-extension-registry', () => ({
  useRuntimeExtensionRegistry() {
    return {
      ...createScopedRuntimeExtensionRegistryCompositionForTest(),
      importProviders: createImportProviderRegistry([]),
    }
  },
}))
mock.module('@/hooks/use-workbench-document-owner', () => ({
  useWorkbenchDocumentOwner() {
    return {
      async commitPartImport() {
        throw new Error('Tests should inject documentOwner directly.')
      },
    }
  },
}))

const { useWorkbenchPartImport } = await import('./workbench/controllers/use-workbench-part-import')
mock.module('react', () => actualReactModule)
mock.module('@/hooks/use-runtime-extension-registry', () => actualRuntimeExtensionRegistryModule)
mock.module('@/hooks/use-workbench-document-owner', () => actualWorkbenchDocumentOwnerModule)

beforeEach(() => {
  hookHarness.reset()
  delete (globalThis as { window?: unknown }).window
})

function makeSnapshot() {
  return {
    document: {
      revisionId: 'rev_part_import',
    },
    documentId: 'document_part_import',
    revisionId: 'rev_part_import',
    presentation: {
      documentHistory: [],
    },
  } as never
}

function makeImportProvider(id: string, label: string) {
  return {
    acceptedFileTypes: [{ extension: 'step', mediaType: 'model/step' }],
    accepts(source: { name: string }) {
      return source.name.endsWith('.step')
    },
    applySelectionPatch() {
      return {}
    },
    createDefaultSelections() {
      return {}
    },
    getReviewFormSchema() {
      return { fields: [] }
    },
    id,
    label,
    async prepare() {
      return { diagnostics: [] }
    },
    async review() {
      return {
        diagnostics: [],
        summary: [],
        value: {},
      }
    },
  }
}

test('useWorkbenchPartImport starts an import session for a matching provider', async () => {
  const events: unknown[] = []
  const errors: string[] = []
  const file = new File(['step'], 'housing.step', { type: 'model/step' })
  const provider = makeImportProvider('step', 'STEP importer')
  const session = {
    diagnostics: [],
    formSchema: { fields: [] },
    providerId: 'step',
    resolvedSource: { name: 'housing.step' },
    review: { diagnostics: [], summary: [], value: {} },
    selections: { body: 'all' },
  }
  const createCapabilitiesCalls: unknown[] = []
  const createSessionCalls: unknown[] = []

  const controller = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: null,
      deps: {
        createCapabilities(modelingService, snapshot) {
          createCapabilitiesCalls.push({ modelingService, snapshot })
          return { capabilities: true } as never
        },
        async createSession(input) {
          createSessionCalls.push(input)
          return session as never
        },
        documentOwner: {
          async commitPartImport() {
            throw new Error('commitPartImport should not run during file selection.')
          },
        },
        importProviders: createImportProviderRegistry([provider]),
        async openImportFilePicker() {
          return { files: [file], ok: true as const }
        },
        async resolveImportSource(selectedFile) {
          expectTrue(selectedFile === file, 'The selected file should be passed to source resolution.')
          return {
            bytes: new Uint8Array([1, 2, 3]),
            fingerprint: 'sha256:test',
            mediaType: 'model/step',
            name: 'housing.step',
            origin: { fileName: 'housing.step', kind: 'localFile' as const },
          }
        },
      },
      dispatch(event) {
        events.push(event)
      },
      modelingService: { id: 'modeling-service' } as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo() {
        throw new Error('No success notification should fire before commit.')
      },
      snapshot: makeSnapshot(),
    }),
  )

  await controller.requestPartImport()

  expectTrue(errors.length === 0, 'A successful import selection should not surface an error.')
  expectTrue(createCapabilitiesCalls.length === 1, 'Import review should build capabilities once from the controller seam.')
  expectTrue(createSessionCalls.length === 1, 'Import review should create exactly one import session.')
  expectTrue(
    JSON.stringify(events) === JSON.stringify([{ type: 'import.fileSelected', session }]),
    'Successful file selection should dispatch the selected import session.',
  )
})

test('useWorkbenchPartImport blocks invalid request states and reports the visible failure', async () => {
  const errors: string[] = []
  let pickerCalls = 0

  const blockedByEdit = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: { kind: 'feature' } as never,
      activeImportSession: null,
      deps: {
        documentOwner: { async commitPartImport() { return { ok: true as const, createdEntityIds: { featureIds: [], sketchIds: [], variableIds: [] } } } },
        importProviders: createImportProviderRegistry([makeImportProvider('step', 'STEP importer')]),
        async openImportFilePicker() {
          pickerCalls += 1
          return { files: [], ok: false as const, reason: 'cancelled' as const }
        },
      },
      dispatch() {
        throw new Error('Blocked requests should not dispatch editor events.')
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo() {
        throw new Error('Blocked requests should not show success information.')
      },
      snapshot: makeSnapshot(),
    }),
  )

  await blockedByEdit.requestPartImport()
  expectTrue(pickerCalls === 0, 'Active editing should block part import before the file picker opens.')

  const missingSnapshot = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: null,
      deps: {
        documentOwner: { async commitPartImport() { return { ok: true as const, createdEntityIds: { featureIds: [], sketchIds: [], variableIds: [] } } } },
        importProviders: createImportProviderRegistry([makeImportProvider('step', 'STEP importer')]),
      },
      dispatch() {
        throw new Error('Missing snapshots should not dispatch editor events.')
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo() {
        throw new Error('Missing snapshots should not show success information.')
      },
      snapshot: null,
    }),
  )

  await missingSnapshot.requestPartImport()

  const noProviders = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: null,
      deps: {
        documentOwner: { async commitPartImport() { return { ok: true as const, createdEntityIds: { featureIds: [], sketchIds: [], variableIds: [] } } } },
        importProviders: createImportProviderRegistry([]),
      },
      dispatch() {
        throw new Error('Missing providers should not dispatch editor events.')
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo() {
        throw new Error('Missing providers should not show success information.')
      },
      snapshot: makeSnapshot(),
    }),
  )

  await noProviders.requestPartImport()

  const unmatched = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: null,
      deps: {
        documentOwner: { async commitPartImport() { return { ok: true as const, createdEntityIds: { featureIds: [], sketchIds: [], variableIds: [] } } } },
        importProviders: createImportProviderRegistry([makeImportProvider('step', 'STEP importer')]),
        async openImportFilePicker() {
          return { files: [new File(['obj'], 'mesh.obj', { type: 'model/obj' })], ok: true as const }
        },
        async resolveImportSource() {
          return {
            bytes: new Uint8Array([9]),
            fingerprint: 'sha256:obj',
            mediaType: 'model/obj',
            name: 'mesh.obj',
            origin: { fileName: 'mesh.obj', kind: 'localFile' as const },
          }
        },
      },
      dispatch() {
        throw new Error('Unmatched providers should not dispatch editor events.')
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo() {
        throw new Error('Unmatched providers should not show success information.')
      },
      snapshot: makeSnapshot(),
    }),
  )

  await unmatched.requestPartImport()

  expectTrue(
    JSON.stringify(errors) === JSON.stringify([
      'The current document is still loading.',
      'No part importers are currently registered.',
      'No importer is available for mesh.obj.',
    ]),
    'The controller should surface the user-visible failure for each blocked import state.',
  )
})

test('useWorkbenchPartImport lets the user choose among multiple matching providers', async () => {
  const providerA = makeImportProvider('step-a', 'STEP A')
  const providerB = makeImportProvider('step-b', 'STEP B')
  const events: unknown[] = []
  const selectedProviders: string[] = []
  const resolvedSource = {
    bytes: new Uint8Array([1]),
    fingerprint: 'sha256:step',
    mediaType: 'model/step',
    name: 'multi.step',
    origin: { fileName: 'multi.step', kind: 'localFile' as const },
  }

  ;(globalThis as { window?: { prompt: () => string } }).window = {
    prompt: () => '2',
  }

  const controller = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: null,
      deps: {
        createCapabilities() {
          return { capabilities: true } as never
        },
        async createSession(input) {
          selectedProviders.push(input.provider.id)
          return {
            diagnostics: [],
            formSchema: { fields: [] },
            providerId: input.provider.id,
            resolvedSource,
            review: { diagnostics: [], summary: [], value: {} },
            selections: {},
          } as never
        },
        documentOwner: { async commitPartImport() { return { ok: true as const, createdEntityIds: { featureIds: [], sketchIds: [], variableIds: [] } } } },
        importProviders: createImportProviderRegistry([providerA, providerB]),
        async openImportFilePicker() {
          return { files: [new File(['step'], 'multi.step', { type: 'model/step' })], ok: true as const }
        },
        async resolveImportSource() {
          return resolvedSource
        },
      },
      dispatch(event) {
        events.push(event)
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        throw new Error(`Provider selection should not fail: ${message}`)
      },
      showWorkbenchInfo() {
        throw new Error('Provider selection should not show success information before commit.')
      },
      snapshot: makeSnapshot(),
    }),
  )

  await controller.requestPartImport()

  expectTrue(
    JSON.stringify(selectedProviders) === JSON.stringify(['step-b']),
    'Prompt selection should choose the requested matching provider.',
  )
  expectTrue(events.length === 1, 'Provider selection should still dispatch a single import session event.')
})

test('useWorkbenchPartImport commits the active session, reopens a created sketch, and reports failures', async () => {
  const events: unknown[] = []
  const errors: string[] = []
  const infos: string[] = []
  const session = {
    diagnostics: [],
    formSchema: { fields: [] },
    providerId: 'step',
    resolvedSource: { name: 'housing.step' },
    review: { diagnostics: [], summary: [], value: {} },
    selections: {},
  } as never

  const successful = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: session,
      deps: {
        documentOwner: {
          async commitPartImport() {
            return {
              createdEntityIds: {
                featureIds: [],
                sketchIds: ['sketch_imported_1'],
                variableIds: [],
              },
              ok: true as const,
            }
          },
        },
        importProviders: createImportProviderRegistry([]),
      },
      dispatch(event) {
        events.push(event)
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo(message) {
        infos.push(message)
      },
      snapshot: makeSnapshot(),
    }),
  )

  await successful.commitImportSession()

  expectTrue(errors.length === 0, 'A successful commit should not surface an error.')
  expectTrue(
    JSON.stringify(events) === JSON.stringify([
      { type: 'import.commitRequested' },
      { type: 'import.committed' },
      {
        type: 'authoring.reopenRequested',
        target: { kind: 'sketch', sketchId: 'sketch_imported_1' },
        toolId: 'sketch',
      },
    ]),
    'A successful sketch import should commit, then reopen the created sketch.',
  )
  expectTrue(
    JSON.stringify(infos) === JSON.stringify(['Imported housing.step.']),
    'A successful commit should surface a user-facing confirmation with the imported file name.',
  )

  const failedEvents: unknown[] = []
  const failedController = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: session,
      deps: {
        documentOwner: {
          async commitPartImport() {
            return {
              diagnostics: [{
                code: 'import-invalid',
                detail: null,
                message: 'Import surface is self-intersecting.',
                severity: 'error' as const,
                target: null,
              }],
              ok: false as const,
            }
          },
        },
        importProviders: createImportProviderRegistry([]),
      },
      dispatch(event) {
        failedEvents.push(event)
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo() {
        throw new Error('Failed commits should not show success information.')
      },
      snapshot: makeSnapshot(),
    }),
  )

  await failedController.commitImportSession()

  const thrownEvents: unknown[] = []
  const thrownController = hookHarness.render(() =>
    useWorkbenchPartImport({
      activeEditSession: null,
      activeImportSession: session,
      deps: {
        documentOwner: {
          async commitPartImport() {
            throw new Error('Import transaction rolled back.')
          },
        },
        importProviders: createImportProviderRegistry([]),
      },
      dispatch(event) {
        thrownEvents.push(event)
      },
      modelingService: {} as never,
      showWorkbenchError(message) {
        errors.push(message)
      },
      showWorkbenchInfo() {
        throw new Error('Thrown commits should not show success information.')
      },
      snapshot: makeSnapshot(),
    }),
  )

  await thrownController.commitImportSession()

  expectTrue(
    JSON.stringify(failedEvents) === JSON.stringify([
      { type: 'import.commitRequested' },
      {
        type: 'import.failed',
        diagnostics: [{
          code: 'import-invalid',
          detail: null,
          message: 'Import surface is self-intersecting.',
          severity: 'error',
          target: null,
        }],
      },
    ]),
    'Rejected import commits should dispatch the returned diagnostics through the controller seam.',
  )
  expectTrue(thrownEvents.length === 2, 'Thrown commit failures should still dispatch the commit request and normalized failure.')
  expectTrue(
    (thrownEvents[0] as { type: string }).type === 'import.commitRequested',
    'Thrown commit failures should preserve the initial commit request event.',
  )
  expectTrue(
    (thrownEvents[1] as { type: string }).type === 'import.failed'
      && (thrownEvents[1] as { diagnostics: Array<{ code: string; message: string }> }).diagnostics[0]?.code === 'import-commit-failed'
      && (thrownEvents[1] as { diagnostics: Array<{ code: string; message: string }> }).diagnostics[0]?.message === 'Import transaction rolled back.',
    'Thrown commit failures should be normalized into an import.failed event.',
  )
  expectTrue(
    JSON.stringify(errors.slice(-2)) === JSON.stringify([
      'Import surface is self-intersecting.',
      'Import transaction rolled back.',
    ]),
    'Commit failures should preserve the visible error message for both returned diagnostics and thrown errors.',
  )
})
