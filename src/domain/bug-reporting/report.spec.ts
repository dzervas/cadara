import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import { strFromU8, unzipSync } from 'fflate'

import { createAuthoredModelDocumentFromSnapshot } from '@/contracts/modeling/authored-document'
import { createGeometryAssetDiagnostic } from '@/contracts/modeling/geometry-assets'
import { createEmptyOperationHistory } from '@/contracts/modeling/operation-history'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { initialEditorState, getEditorViewState } from '@/domain/editor/state-machine'
import {
  BUG_REPORT_FIELD_IDS,
  CADARA_GITHUB_BUG_REPORT_TEMPLATE,
  createBoundedMarkdownSections,
  createBugReportArtifactFilename,
  createBugReportDebugArtifact,
  createBugReportIssueDraft,
  createBugReportPayload,
  createBugReportStateArchive,
  createBugReportStateArchiveFilename,
  createGithubBugReportUrl,
  formatMarkdownJsonDisclosure,
} from '@/domain/bug-reporting/report'
import { createFeatureEditSession } from '@/domain/editor/feature-editing'
import { createNewSketchSession } from '@/domain/editor/sketch-session'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { MODELING_OPERATION_HISTORY_STORAGE_KEY, type StorageLike } from '@/domain/modeling/modeling-history-persistence'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'

test('src/domain/bug-reporting/report.spec.ts', async () => {  function createStorage(value: string | null): StorageLike {
    return {
      getItem: (key) => key === MODELING_OPERATION_HISTORY_STORAGE_KEY ? value : null,
      setItem: () => undefined,
      removeItem: () => undefined,
    }
  }

  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
  })).snapshot
  const authoredDocument = createAuthoredModelDocumentFromSnapshot(snapshot)
  const operationHistory = createEmptyOperationHistory(snapshot.document.documentId)
  const baseEditorState = getEditorViewState(initialEditorState)
  const debugTrace = {
    maxEntries: 200,
    totalEntries: 3,
    droppedEntries: 0,
    entries: [
      {
        kind: 'event-dispatched',
        sequence: 1,
        at: '2026-01-02T03:04:05.000Z',
        event: {
          type: 'session.started',
          requestId: null,
        },
        state: {
          machineState: 'idle',
          mode: 'part',
          activeCommand: null,
          activePhase: null,
          revisionId: snapshot.document.revisionId,
          selectionCount: 0,
          pendingSnapshotRequestId: null,
        },
        emittedEffects: [],
      },
    ],
  } as const

  const payloadResult = createBugReportPayload({
    build: { version: '0.0.1', commit: 'abc1234', mode: 'test' },
    editorState: {
      ...baseEditorState,
      activeCommand: {
        commandSessionId: 'command_bug-report',
        toolId: 'extrude',
        phase: 'collecting',
      },
      selection: [{ kind: 'sketch', sketchId: snapshot.document.sketches[0]!.sketchId }],
      activeEditSession: createFeatureEditSession({ featureType: 'extrude', selectedTarget: null }),
      activeReferencePickerFieldId: 'profiles',
      sketchSession: createNewSketchSession(createStandardPlaneDefinition('xy')),
    },
    snapshot,
    debugTrace,
    storage: createStorage(JSON.stringify(operationHistory)),
    environment: {
      navigator: {
        userAgent: 'UnitTest/1.0',
        language: 'en-US',
        languages: ['en-US'],
        platform: 'test-platform',
        hardwareConcurrency: 8,
        deviceMemory: 16,
        userAgentData: {
          mobile: false,
          platform: 'test-platform',
          brands: [{ brand: 'Unit', version: '1' }],
        },
      },
      window: {
        innerWidth: 1440,
        innerHeight: 900,
        devicePixelRatio: 2,
        screen: { width: 2880, height: 1800 },
        location: {
          origin: 'https://cadara.test',
          pathname: '/workspace',
          search: '?doc=1',
          hash: '#sketch',
        },
      },
    },
  })

  expectTrue(payloadResult.payload.authoredDocument.status === 'included', 'Authored document should be included when it fits.')
  expectTrue(
    JSON.stringify(payloadResult.payload.authoredDocument.value) === JSON.stringify(authoredDocument),
    'Bug reports should reuse createAuthoredModelDocumentFromSnapshot for document reproduction data.',
  )
  expectTrue(!('render' in payloadResult.payload.authoredDocument.value), 'Authored debug data should exclude render exports.')
  expectTrue(!('presentation' in payloadResult.payload.authoredDocument.value), 'Authored debug data should exclude presentation state.')
  expectTrue(payloadResult.payload.operationHistory.status === 'included', 'Valid stored operation history should be included.')
  expectTrue(payloadResult.payload.runtimeTrace.status === 'included', 'Available runtime trace data should be included when it fits.')
  expectTrue(
    payloadResult.payload.editor.activeSketch?.entityCount === 0 &&
      payloadResult.payload.editor.activeFeatureEdit?.featureType === 'extrude' &&
      payloadResult.payload.editor.activeReferencePickerFieldId === 'profiles' &&
      payloadResult.payload.editor.selectedTargets.length === 1,
    'Payload should include compact transient editor context.',
  )

  const asset = await createDeterministicGeometryAsset({ ownerFeatureIds: [snapshot.document.features[0]!.featureId] })
  const assetDiagnosticSnapshot = structuredClone(snapshot)
  assetDiagnosticSnapshot.document.diagnostics = [
    createGeometryAssetDiagnostic('geometry-asset-corrupt', asset.asset, 'Referenced geometry asset bytes are corrupt.'),
  ]
  const assetPayload = createBugReportPayload({
    build: { version: '0.0.1', commit: 'abc1234', mode: 'test' },
    editorState: baseEditorState,
    snapshot: assetDiagnosticSnapshot,
    storage: null,
  })
  expectTrue(
    assetPayload.payload.documentSummary.assetDiagnostics?.[0]?.hashPrefix === asset.asset.hash.replace(/^sha256:/, '').slice(0, 12),
    'Bug report document summaries should include compact geometry asset diagnostic context.',
  )
  expectTrue(
    !('bytes' in assetPayload.payload.documentSummary.assetDiagnostics![0]!),
    'Bug report geometry asset summaries should not include raw asset bytes.',
  )

  const invalidHistory = createBugReportPayload({
    build: { version: '0.0.1', commit: 'abc1234', mode: 'test' },
    editorState: baseEditorState,
    snapshot,
    storage: createStorage('{'),
  })
  expectTrue(invalidHistory.payload.operationHistory.status === 'invalid', 'Invalid operation history should be recorded without throwing.')

  const unavailableHistory = createBugReportPayload({
    build: { version: '0.0.1', commit: 'abc1234', mode: 'test' },
    editorState: baseEditorState,
    snapshot,
    storage: null,
  })
  expectTrue(unavailableHistory.payload.operationHistory.status === 'unavailable', 'Unavailable local storage should be recorded without throwing.')

  const omittedSections = createBugReportPayload({
    build: { version: '0.0.1', commit: 'abc1234', mode: 'test' },
    editorState: baseEditorState,
    snapshot,
    debugTrace,
    storage: createStorage(JSON.stringify(operationHistory)),
  }, { sectionByteLimit: 8 })
  expectTrue(omittedSections.payload.authoredDocument.status === 'omitted-too-large', 'Large authored documents should be omitted from inline payloads.')
  expectTrue(omittedSections.payload.operationHistory.status === 'omitted-too-large', 'Large operation histories should be omitted from inline payloads.')
  expectTrue(omittedSections.payload.runtimeTrace.status === 'omitted-too-large', 'Large runtime traces should be omitted from inline payloads.')
  expectTrue(
    omittedSections.artifactSections.authoredDocument && omittedSections.artifactSections.operationHistory && omittedSections.artifactSections.runtimeTrace,
    'Omitted high-value sections should be available for the debug artifact.',
  )

  const disclosure = formatMarkdownJsonDisclosure('Debug <section>', { ok: true })
  expectTrue(disclosure.includes('<details>') && disclosure.includes('&lt;section&gt;'), 'Debug JSON should be wrapped in a safe Markdown disclosure.')
  expectTrue(disclosure.includes('````json'), 'Debug JSON should use a fenced code block.')

  const bounded = createBoundedMarkdownSections([
    { id: 'documentSummary', summary: 'Small section', value: { ok: true } },
    { id: 'authoredDocument', summary: 'Large section', value: { data: 'x'.repeat(200) } },
  ], { sectionByteLimit: 100, totalByteLimit: 500, attachmentFilename: 'cadara-bug-report-20260102T030405Z.json' })
  expectTrue(bounded.omittedSectionIds.includes('authoredDocument'), 'Large inline sections should be omitted by section limit.')
  expectTrue(
    bounded.markdown.includes('cadara-bug-report-20260102T030405Z.json'),
    'Omitted markers should point reporters at the generated artifact.',
  )

  const filename = createBugReportArtifactFilename(new Date('2026-01-02T03:04:05.000Z'))
  expectTrue(filename === 'cadara-bug-report-20260102T030405Z.json', 'Artifact filenames should be deterministic and timestamped.')
  const artifact = createBugReportDebugArtifact(omittedSections, new Date('2026-01-02T03:04:05.000Z'))
  expectTrue(
    artifact?.filename === filename && typeof artifact.payload === 'string' && artifact.payload.includes('omittedSections'),
    'Debug artifact should include omitted high-value sections.',
  )

  const archiveFilename = createBugReportStateArchiveFilename(new Date('2026-01-02T03:04:05.000Z'))
  expectTrue(archiveFilename === 'cadara-state-20260102T030405Z.zip', 'State archive filenames should be deterministic and timestamped.')
  const stateStorage = {
    getItem: (key: string) => {
      if (key === MODELING_OPERATION_HISTORY_STORAGE_KEY) {
        return JSON.stringify(operationHistory)
      }
      if (key === 'cad.documentRepository.automergeUrls.v1') {
        return JSON.stringify({ doc_workspace: 'automerge:debug' })
      }
      if (key === 'cad.extraDebugKey') {
        return 'extra'
      }
      return null
    },
    setItem: () => undefined,
    removeItem: () => undefined,
    length: 3,
    key: (index: number) => [
      MODELING_OPERATION_HISTORY_STORAGE_KEY,
      'cad.documentRepository.automergeUrls.v1',
      'cad.extraDebugKey',
    ][index] ?? null,
  } satisfies StorageLike & { length: number; key: (index: number) => string | null }
  const stateArchive = await createBugReportStateArchive(payloadResult, {
    storage: stateStorage,
    indexedDB: null,
  })
  const stateArchiveEntries = unzipSync(stateArchive.payload as Uint8Array)
  const compactReport = JSON.parse(strFromU8(stateArchiveEntries['report/compact-report.json']!)) as typeof payloadResult.payload
  const localStorageState = JSON.parse(strFromU8(stateArchiveEntries['state/local-storage.json']!)) as {
    entries: Record<string, string | null>
  }
  const indexedDbState = JSON.parse(strFromU8(stateArchiveEntries['state/indexeddb.json']!)) as { status: string }

  expectTrue(
    stateArchive.filename.startsWith('cadara-state-') && stateArchive.filename.endsWith('.zip'),
    'State archive should use a timestamped zip filename.',
  )
  expectTrue(stateArchive.mimeType === 'application/zip', 'State archive should download as a zip.')
  expectTrue(compactReport.generatedAt === payloadResult.payload.generatedAt, 'State archive should include the compact report payload.')
  expectTrue(stateArchiveEntries['README.txt'], 'State archive should include a brief manifest.')
  expectTrue(stateArchiveEntries['state/authored-document.json'], 'State archive should include the full authored document when available.')
  expectTrue(stateArchiveEntries['state/operation-history.json'], 'State archive should include operation history when available.')
  expectTrue(stateArchiveEntries['state/runtime-trace.json'], 'State archive should include runtime trace data when available.')
  expectTrue(
    localStorageState.entries['cad.documentRepository.automergeUrls.v1']?.includes('automerge:debug')
      && localStorageState.entries['cad.extraDebugKey'] === 'extra',
    'State archive should include known and enumerable Cadara localStorage entries.',
  )
  expectTrue(indexedDbState.status === 'unavailable', 'State archive should record unavailable IndexedDB without throwing.')

  const issueDraft = createBugReportIssueDraft(omittedSections, {
    artifactStatus: { kind: 'downloaded', filename },
    queryFieldByteLimit: 500,
    totalQueryByteLimit: 2_500,
  })
  expectTrue(issueDraft.url.includes(`template=${CADARA_GITHUB_BUG_REPORT_TEMPLATE}`), 'Issue URL should select the bug-report issue form.')
  expectTrue(issueDraft.url.includes(BUG_REPORT_FIELD_IDS.document), 'Issue URL should prefill the document field by id.')
  expectTrue(!issueDraft.url.includes('presentation'), 'Issue URL should not encode complete derived snapshot data.')

  const defaultIssueDraft = createBugReportIssueDraft(omittedSections, {
    artifactStatus: { kind: 'downloaded', filename },
  })
  const defaultIssueUrl = new URL(defaultIssueDraft.url)
  expectTrue(defaultIssueDraft.url.length < 8_000, 'Default bug-report issue URLs should stay below GitHub practical URL limits.')
  expectTrue(
    defaultIssueUrl.searchParams.get(BUG_REPORT_FIELD_IDS.environment) === defaultIssueDraft.fields[BUG_REPORT_FIELD_IDS.environment],
    'Default bounded issue URLs should include the full environment payload.',
  )
  expectTrue(
    defaultIssueDraft.fields[BUG_REPORT_FIELD_IDS.environment].startsWith('<details>\n<summary>Environment</summary>'),
    'Environment metadata should be hidden behind a disclosure block.',
  )
  expectTrue(
    defaultIssueUrl.searchParams.get(BUG_REPORT_FIELD_IDS.document)?.includes('place the json you downloaded here'),
    'Oversized debug payload prefills should include a downloaded JSON placeholder.',
  )
  expectTrue(
    defaultIssueUrl.searchParams.get(BUG_REPORT_FIELD_IDS.document)?.includes('<!-- A debug artifact was downloaded as cadara-bug-report-20260102T030405Z.json. Please attach it to this issue. -->'),
    'Downloaded artifact instructions should be an issue-form comment.',
  )

  const boundedUrl = createGithubBugReportUrl({
    [BUG_REPORT_FIELD_IDS.description]: 'x'.repeat(2_000),
    unexpected_field: 'should-not-appear',
  }, { queryFieldByteLimit: 80, totalQueryByteLimit: 600 })
  const parsedBoundedUrl = new URL(boundedUrl)
  expectTrue(!parsedBoundedUrl.searchParams.has('unexpected_field'), 'Issue URLs should only include known issue-form field ids.')
  expectTrue(
    parsedBoundedUrl.searchParams.get(BUG_REPORT_FIELD_IDS.description)?.includes('Omitted from URL prefill'),
    'Oversized issue-form query values should be bounded with explicit markers.',
  )
})
