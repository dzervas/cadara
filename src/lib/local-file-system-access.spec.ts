import { test } from 'bun:test'

import {
  CADARA_OPEN_FILE_PICKER_OPTIONS,
  CADARA_SAVE_FILE_PICKER_OPTIONS,
  createLocalAuthoredDocumentPayload,
  getLocalFileSystemOpenSupport,
  readCadaraDocumentFile,
  getLocalFileSystemSaveSupport,
  showOpenLocalDocumentPicker,
  showSaveLocalDocumentPicker,
  writeTextToLocalFileHandle,
  type LocalFileSystemFileHandle,
  type LocalFileSystemOpenPickerOptions,
  type LocalFileSystemSavePickerOptions,
} from '@/lib/local-file-system-access'
import {
  createIndexedDbLocalFileBindingStore,
  createLocalFileBindingMetadata,
} from '@/domain/modeling/local-file-binding-store'
import { serializeAuthoredDocumentJson } from '@/contracts/modeling/authored-document-serialization'
import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'

test('src/lib/local-file-system-access.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createHandle(name = 'part.cadara'): LocalFileSystemFileHandle {
    return {
      name,
      async getFile() {
        return new File(['{"ok":true}'], name, { type: 'application/json' })
      },
      async createWritable() {
        return {
          async write() {},
          async close() {},
        }
      },
      async queryPermission() {
        return 'granted'
      },
      async requestPermission() {
        return 'granted'
      },
    }
  }

  async function testPickerOptionsAndRouting() {
    const openHandle = createHandle()
    let openOptions: LocalFileSystemOpenPickerOptions | null = null
    const openResult = await showOpenLocalDocumentPicker({
      isSecureContext: true,
      async showOpenFilePicker(options) {
        openOptions = options
        return [openHandle]
      },
    })
    assert(openResult.ok && openResult.handle === openHandle, 'Open picker should return the selected local file handle.')
    assert(openOptions?.types[0]?.accept['application/json']?.includes('.cadara'), 'Open picker should accept .cadara JSON files.')
    assert(openOptions?.types[0]?.accept['application/json']?.includes('.json'), 'Open picker should accept JSON files.')
    assert(openOptions?.multiple === false, 'Open picker should select a single document.')

    const saveHandle = createHandle('saved.cadara')
    let saveOptions: LocalFileSystemSavePickerOptions | null = null
    const saveResult = await showSaveLocalDocumentPicker({
      isSecureContext: true,
      async showSaveFilePicker(options) {
        saveOptions = options
        return saveHandle
      },
    })
    assert(saveResult.ok && saveResult.handle === saveHandle, 'Save picker should return the selected destination handle.')
    assert(saveOptions?.suggestedName.endsWith('.cadara'), 'Save picker should suggest a cadara filename.')
    assert(saveOptions?.types[0]?.accept['application/json']?.includes('.cadara'), 'Save picker should accept .cadara JSON files.')
  }

  async function testUnsupportedAndCancelledPickers() {
    const unsupportedOpen = getLocalFileSystemOpenSupport({ isSecureContext: true })
    assert(!unsupportedOpen.supported && unsupportedOpen.reason === 'missing-open-picker', 'Missing open picker should be reported explicitly.')
    const unsupportedSave = getLocalFileSystemSaveSupport({ isSecureContext: false })
    assert(!unsupportedSave.supported && unsupportedSave.reason === 'insecure-context', 'Insecure save context should be reported explicitly.')

    const cancelledOpen = await showOpenLocalDocumentPicker({
      isSecureContext: true,
      async showOpenFilePicker() {
        throw new DOMException('Selection cancelled.', 'AbortError')
      },
    })
    assert(!cancelledOpen.ok && cancelledOpen.reason === 'cancelled', 'Open picker AbortError should be normalized to cancellation.')

    const cancelledSave = await showSaveLocalDocumentPicker({
      isSecureContext: true,
      async showSaveFilePicker() {
        throw new DOMException('Selection cancelled.', 'AbortError')
      },
    })
    assert(!cancelledSave.ok && cancelledSave.reason === 'cancelled', 'Save picker AbortError should be normalized to cancellation.')
  }

  async function testWritePermissionAndPersistentBindingSupport() {
    let requestedMode = ''
    let written = ''
    const handle: LocalFileSystemFileHandle = {
      name: 'bound.cadara',
      async getFile() {
        return new File([], 'bound.cadara')
      },
      async createWritable() {
        return {
          write(data) {
            written = String(data)
          },
          close() {},
        }
      },
      async queryPermission() {
        return 'prompt'
      },
      async requestPermission(descriptor) {
        requestedMode = descriptor.mode
        return 'granted'
      },
    }

    const writeResult = await writeTextToLocalFileHandle(handle, 'payload')
    assert(writeResult.ok, 'Writable handles should be written after permission is granted.')
    assert(requestedMode === 'readwrite', 'Write permission should be requested in readwrite mode.')
    assert(written === 'payload', 'Direct write should use the selected file handle stream.')

    const metadata = createLocalFileBindingMetadata('doc_workspace', handle, new Date('2026-04-22T00:00:00.000Z'))
    assert(metadata.fileName === 'bound.cadara', 'Binding metadata should retain the local file name.')
    assert(metadata.storedAt === '2026-04-22T00:00:00.000Z', 'Binding metadata should store a deterministic timestamp value.')

    const bindingStore = createIndexedDbLocalFileBindingStore({ indexedDB: undefined })
    const loadResult = await bindingStore.load('doc_workspace')
    assert(!bindingStore.isSupported(), 'Binding store should report unsupported storage when IndexedDB is unavailable.')
    assert(!loadResult.ok && loadResult.reason === 'unsupported-storage', 'Binding store operations should return explicit unsupported-storage results.')
  }

  function testStableSerialization() {
    const serialized = serializeAuthoredDocumentJson({
      z: 1,
      a: {
        d: true,
        b: ['second', { c: 'third', a: 'first' }],
      },
    })

    assert(
      serialized.indexOf('"a"') < serialized.indexOf('"z"'),
      'Authored document serialization should sort object keys deterministically.',
    )
    assert(
      serialized.indexOf('"a": "first"') < serialized.indexOf('"c": "third"'),
      'Nested object keys should also be sorted deterministically.',
    )
  }

  async function testCadaraDocumentsStaySingleJsonObjects() {
    const asset = await createDeterministicGeometryAsset()
    const document = {
      contractVersion: 'modeling-contract/v1alpha1',
      schemaVersion: 'authored-model-document/v1alpha1',
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      settings: {
        linearUnit: 'millimeter',
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.001,
      },
      variables: [],
      sketches: [],
      features: [],
      featureOrder: [],
      historyOrder: [],
      cursor: { kind: 'empty' },
      bodyLabels: [],
      assets: {
        schemaVersion: 'geometry-asset-manifest/v1alpha1',
        records: [asset.asset],
      },
    } as AuthoredModelDocument

    const payload = createLocalAuthoredDocumentPayload(document)
    assert(typeof payload === 'string', 'Documents with geometry assets should serialize as single JSON cadara payloads.')
    assert(!payload.startsWith('PK'), 'Cadara JSON payloads should not be ZIP-backed packages.')

    const parsed = await readCadaraDocumentFile(new File([payload], 'asset.cadara'))
    assert(
      (parsed as AuthoredModelDocument).assets.records[0]?.hash === asset.asset.hash,
      'Cadara JSON reads should restore authored asset records directly.',
    )

    let zipRejected = false
    try {
      await readCadaraDocumentFile(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'asset.cadara'))
    } catch (error: unknown) {
      zipRejected = error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
    }
    assert(zipRejected, 'Cadara reads should reject ZIP-backed packages without backwards-compatible extraction.')
  }

  assert(
    CADARA_OPEN_FILE_PICKER_OPTIONS.types[0]?.accept['application/json']?.includes('.cadara'),
    'Open picker constants should advertise cadara JSON documents.',
  )
  assert(
    CADARA_SAVE_FILE_PICKER_OPTIONS.types[0]?.accept['application/json']?.includes('.cadara'),
    'Save picker constants should advertise cadara JSON documents.',
  )

  await testPickerOptionsAndRouting()
  await testUnsupportedAndCancelledPickers()
  await testWritePermissionAndPersistentBindingSupport()
  await testCadaraDocumentsStaySingleJsonObjects()
  testStableSerialization()
})
