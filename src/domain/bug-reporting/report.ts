import { strToU8, zipSync } from 'fflate'

import { createAuthoredModelDocumentFromSnapshot, type AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import { validateOperationHistoryPayload, type ModelingOperationHistoryPayload } from '@/contracts/modeling/operation-history'
import type { WorkspaceSnapshot, ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { EditorRuntimeTraceSnapshot } from '@/domain/debug/debug-platform'
import type { EditorViewState } from '@/domain/editor/state-machine'
import { MODELING_OPERATION_HISTORY_STORAGE_KEY, type StorageLike } from '@/domain/modeling/modeling-history-persistence'

export const CADARA_GITHUB_BUG_REPORT_URL = 'https://github.com/dzervas/cadara/issues/new'
export const CADARA_GITHUB_BUG_REPORT_TEMPLATE = 'bug_report.yml'

export const BUG_REPORT_FIELD_IDS = {
  title: 'title',
  template: 'template',
  description: 'description',
  document: 'document',
  environment: 'environment',
  diagnostics: 'diagnostics',
} as const

const DEFAULT_SECTION_BYTE_LIMIT = 12_000
const DEFAULT_TOTAL_INLINE_BYTE_LIMIT = 18_000
const DEFAULT_QUERY_FIELD_BYTE_LIMIT = 900
const DEFAULT_TOTAL_QUERY_BYTE_LIMIT = 3_600
const DEFAULT_RECENT_OPERATION_ENTRY_LIMIT = 20
const DOCUMENT_REPOSITORY_AUTOMERGE_URLS_STORAGE_KEY = 'cad.documentRepository.automergeUrls.v1'
const DEFAULT_INDEXED_DB_DATABASE_NAMES = ['cad-authored-documents'] as const
const TEXT_ENCODER = new TextEncoder()

type BugReportSectionId =
  | 'build'
  | 'browser'
  | 'viewport'
  | 'webgl'
  | 'route'
  | 'editor'
  | 'diagnostics'
  | 'documentSummary'
  | 'authoredDocument'
  | 'operationHistory'
  | 'runtimeTrace'
  | 'payloadStatus'

export interface BugReportBuildMetadata {
  version: string
  commit: string
  mode: string | null
}

export interface BugReportBrowserMetadata {
  userAgent: string
  language: string | null
  languages: readonly string[]
  platform: string | null
  hardwareConcurrency: number | null
  deviceMemory: number | null
  userAgentData: {
    mobile: boolean | null
    platform: string | null
    brands: readonly { brand: string; version: string }[]
  } | null
}

export interface BugReportViewportMetadata {
  width: number | null
  height: number | null
  devicePixelRatio: number | null
  screenWidth: number | null
  screenHeight: number | null
}

export interface BugReportWebglMetadata {
  status: 'available' | 'unavailable'
  vendor: string | null
  renderer: string | null
  unmaskedVendor: string | null
  unmaskedRenderer: string | null
  reason?: string
}

export interface BugReportRouteContext {
  origin: string | null
  pathname: string | null
  search: string | null
  hash: string | null
}

export interface BugReportEditorContext {
  mode: EditorViewState['mode']
  activeCommand: Pick<NonNullable<EditorViewState['activeCommand']>, 'toolId' | 'phase' | 'commandSessionId'> | null
  selectionFilter: {
    kind: string
    label: string
    requirementIds: readonly string[]
  } | null
  selectedTargets: readonly unknown[]
  activeReferencePickerFieldId: string | null
  preview: {
    kind: string
    label: string
    target: unknown
  } | null
  activeSketch: {
    sketchId: string | null
    sketchLabel: string
    planeKey: string | null
    activeTool: string | null
    status: string
    entityCount: number
    pointCount: number
    constraintCount: number
    dimensionCount: number
    referenceCount: number
    projectedReferenceCount: number
    historyCursor: string
    constructionModifierActive: boolean
    constructionTargetPicking: boolean
    referenceTargetPicking: boolean
    validationMessage: string | null
  } | null
  activeFeatureEdit: {
    mode: string
    featureType: string
    featureId: string | null
    previewId: string
    status: string
    lastPreviewRevisionId: string | null
    lastCommittedRevisionId: string | null
    diagnosticCount: number
    draftSummary: unknown
  } | null
}

export interface BugReportDiagnosticsContext {
  snapshotDiagnostics: readonly ModelingDiagnostic[]
  activeFeatureDiagnostics: readonly ModelingDiagnostic[]
  activeSketchDiagnostics: readonly unknown[]
}

export interface BugReportDocumentSummary {
  availability: 'loaded' | 'unavailable'
  documentId?: string
  revisionId?: string
  contractVersion?: string
  schemaVersion?: string
  counts?: {
    sketches: number
    features: number
    bodies: number
    constructions: number
    variables: number
    diagnostics: number
    renderRecords: number
  }
  assetDiagnostics?: readonly {
    code: string
    assetId: string
    format: string
    byteLength: number
    hashPrefix: string
    ownerFeatureIds: readonly string[]
  }[]
  reason?: string
}

export type BugReportSection<T> =
  | { status: 'included'; byteLength: number; value: T }
  | { status: 'unavailable' | 'invalid' | 'omitted-too-large' | 'omitted-unserializable' | 'not-loaded'; byteLength?: number; reason: string }

export interface BugReportPayloadStatus {
  inlineLimits: {
    sectionByteLimit: number
    totalInlineByteLimit: number
  }
  omittedSectionIds: readonly BugReportSectionId[]
  artifactRequired: boolean
}

export interface BugReportPayload {
  generatedAt: string
  build: BugReportBuildMetadata
  browser: BugReportBrowserMetadata
  viewport: BugReportViewportMetadata
  webgl: BugReportWebglMetadata
  route: BugReportRouteContext
  editor: BugReportEditorContext
  diagnostics: BugReportDiagnosticsContext
  documentSummary: BugReportDocumentSummary
  authoredDocument: BugReportSection<AuthoredModelDocument>
  operationHistory: BugReportSection<ModelingOperationHistoryPayload>
  runtimeTrace: BugReportSection<EditorRuntimeTraceSnapshot>
  payloadStatus: BugReportPayloadStatus
}

export interface BugReportPayloadResult {
  payload: BugReportPayload
  artifactSections: Partial<Record<'authoredDocument' | 'operationHistory' | 'runtimeTrace', unknown>>
}

export interface BugReportPayloadOptions {
  generatedAt?: Date
  sectionByteLimit?: number
  totalInlineByteLimit?: number
  recentOperationEntryLimit?: number
}

export interface BugReportPayloadInput {
  build: BugReportBuildMetadata
  editorState: Pick<
    EditorViewState,
    | 'mode'
    | 'activeCommand'
    | 'selection'
    | 'selectionFilter'
    | 'preview'
    | 'activeEditSession'
    | 'activeReferencePickerFieldId'
    | 'sketchSession'
  >
  snapshot: WorkspaceSnapshot | null
  debugTrace?: EditorRuntimeTraceSnapshot | null
  storage?: StorageLike | null
  environment?: BrowserReportEnvironment
}

interface UserAgentBrandVersion {
  brand: string
  version: string
}

interface UserAgentDataLike {
  mobile?: boolean
  platform?: string
  brands?: readonly UserAgentBrandVersion[]
}

interface NavigatorLike {
  userAgent?: string
  language?: string
  languages?: readonly string[]
  platform?: string
  hardwareConcurrency?: number
  deviceMemory?: number
  userAgentData?: UserAgentDataLike
}

interface LocationLike {
  origin?: string
  pathname?: string
  search?: string
  hash?: string
}

interface WindowLike {
  innerWidth?: number
  innerHeight?: number
  devicePixelRatio?: number
  screen?: {
    width?: number
    height?: number
  }
  location?: LocationLike
}

interface CanvasLike {
  getContext: (contextId: 'webgl' | 'experimental-webgl') => WebGLRenderingContext | null
}

interface DocumentLike {
  createElement: (tagName: 'canvas') => CanvasLike
}

export interface BrowserReportEnvironment {
  navigator?: NavigatorLike
  window?: WindowLike
  document?: DocumentLike
}

export interface MarkdownSectionInput {
  id: BugReportSectionId
  summary: string
  value: unknown
}

export interface MarkdownLimitOptions {
  sectionByteLimit?: number
  totalByteLimit?: number
  attachmentFilename?: string | null
}

export interface BoundedMarkdownResult {
  markdown: string
  omittedSectionIds: readonly BugReportSectionId[]
}

export type BugReportArtifactStatus =
  | { kind: 'not-needed' }
  | { kind: 'downloaded'; filename: string }
  | { kind: 'unavailable'; filename: string | null; reason: string }

export interface BugReportIssueDraft {
  url: string
  fields: Record<string, string>
  omittedSectionIds: readonly BugReportSectionId[]
}

export interface BugReportIssueDraftOptions {
  artifactStatus?: BugReportArtifactStatus
  sectionByteLimit?: number
  totalInlineByteLimit?: number
  queryFieldByteLimit?: number
  totalQueryByteLimit?: number
  fullQueryFieldIds?: readonly string[]
  fallbackQueryFieldValues?: Record<string, string>
}

export interface BugReportDebugArtifact {
  filename: string
  mimeType: string
  payload: string | Uint8Array
}

export interface BugReportStateArchiveOptions {
  storage?: StorageLike | null
  indexedDB?: IDBFactory | null
  databaseNames?: readonly string[]
}

interface DownloadAnchor {
  href: string
  download: string
  click: () => void
  remove?: () => void
}

interface DownloadUrlApi {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

export interface BugReportDownloadEnvironment {
  document: {
    createElement: (tagName: 'a') => DownloadAnchor
    body?: {
      appendChild: (element: DownloadAnchor) => void
    }
  }
  URL: DownloadUrlApi
}

export function createBugReportPayload(
  input: BugReportPayloadInput,
  options: BugReportPayloadOptions = {},
): BugReportPayloadResult {
  const generatedAt = options.generatedAt ?? new Date()
  const sectionByteLimit = options.sectionByteLimit ?? DEFAULT_SECTION_BYTE_LIMIT
  const totalInlineByteLimit = options.totalInlineByteLimit ?? DEFAULT_TOTAL_INLINE_BYTE_LIMIT
  const artifactSections: BugReportPayloadResult['artifactSections'] = {}
  const documentSummary = createDocumentSummary(input.snapshot)
  const authoredDocument = createAuthoredDocumentSection(input.snapshot, sectionByteLimit)
  const operationHistory = loadOperationHistorySection(
    input.storage ?? null,
    sectionByteLimit,
    options.recentOperationEntryLimit ?? DEFAULT_RECENT_OPERATION_ENTRY_LIMIT,
  )
  const runtimeTrace = createRuntimeTraceSection(
    input.debugTrace ?? null,
    sectionByteLimit,
  )

  if (authoredDocument.status === 'omitted-too-large' && input.snapshot) {
    artifactSections.authoredDocument = createAuthoredModelDocumentFromSnapshot(input.snapshot)
  }

  if (operationHistory.status === 'omitted-too-large') {
    const history = loadFullOperationHistory(input.storage ?? null)
    if (history.status === 'included') {
      artifactSections.operationHistory = history.value
    }
  }
  if (runtimeTrace.status === 'omitted-too-large' && input.debugTrace) {
    artifactSections.runtimeTrace = input.debugTrace
  }

  const omittedSectionIds: BugReportSectionId[] = []
  if (authoredDocument.status !== 'included') {
    omittedSectionIds.push('authoredDocument')
  }
  if (operationHistory.status !== 'included') {
    omittedSectionIds.push('operationHistory')
  }
  if (runtimeTrace.status !== 'included') {
    omittedSectionIds.push('runtimeTrace')
  }

  return {
    payload: {
      generatedAt: generatedAt.toISOString(),
      build: input.build,
      browser: collectBrowserMetadata(input.environment?.navigator),
      viewport: collectViewportMetadata(input.environment?.window),
      webgl: collectWebglMetadata(input.environment?.document),
      route: collectRouteContext(input.environment?.window?.location),
      editor: createEditorContext(input.editorState),
      diagnostics: createDiagnosticsContext(input.snapshot, input.editorState),
      documentSummary,
      authoredDocument,
      operationHistory,
      runtimeTrace,
      payloadStatus: {
        inlineLimits: {
          sectionByteLimit,
          totalInlineByteLimit,
        },
        omittedSectionIds,
        artifactRequired: Object.keys(artifactSections).length > 0,
      },
    },
    artifactSections,
  }
}

export function formatMarkdownJsonDisclosure(summary: string, value: unknown) {
  return [
    '<details>',
    `<summary>${escapeHtml(summary)}</summary>`,
    '',
    '````json',
    stringifyJson(value),
    '````',
    '</details>',
  ].join('\n')
}

export function createBoundedMarkdownSections(
  sections: readonly MarkdownSectionInput[],
  options: MarkdownLimitOptions = {},
): BoundedMarkdownResult {
  const sectionByteLimit = options.sectionByteLimit ?? DEFAULT_SECTION_BYTE_LIMIT
  const totalByteLimit = options.totalByteLimit ?? DEFAULT_TOTAL_INLINE_BYTE_LIMIT
  const blocks: string[] = []
  const omittedSectionIds: BugReportSectionId[] = []
  let totalBytes = 0

  for (const section of sections) {
    const block = formatMarkdownJsonDisclosure(section.summary, section.value)
    const blockBytes = getUtf8ByteLength(block)

    if (blockBytes > sectionByteLimit) {
      omittedSectionIds.push(section.id)
      blocks.push(createOmittedMarkdownMarker(section.summary, blockBytes, sectionByteLimit, options.attachmentFilename))
      continue
    }

    if (totalBytes + blockBytes > totalByteLimit) {
      omittedSectionIds.push(section.id)
      blocks.push(createOmittedMarkdownMarker(section.summary, totalBytes + blockBytes, totalByteLimit, options.attachmentFilename))
      continue
    }

    blocks.push(block)
    totalBytes += blockBytes
  }

  return {
    markdown: blocks.join('\n\n'),
    omittedSectionIds,
  }
}

export function createBugReportIssueDraft(
  result: BugReportPayloadResult,
  options: BugReportIssueDraftOptions = {},
): BugReportIssueDraft {
  const artifactStatus = options.artifactStatus ?? createArtifactStatus(result)
  const attachmentFilename = artifactStatus.kind === 'not-needed' ? null : artifactStatus.filename
  const environmentMarkdown = createEnvironmentMarkdown(result.payload)
  const diagnostics = createBoundedMarkdownSections([
    { id: 'diagnostics', summary: 'Diagnostics and errors', value: result.payload.diagnostics },
  ], {
    sectionByteLimit: options.sectionByteLimit,
    totalByteLimit: options.totalInlineByteLimit,
    attachmentFilename,
  })
  const debugPayload = createBoundedMarkdownSections([
    { id: 'documentSummary', summary: 'Document summary', value: result.payload.documentSummary },
    { id: 'authoredDocument', summary: 'Authored document', value: result.payload.authoredDocument },
    { id: 'operationHistory', summary: 'Operation history', value: result.payload.operationHistory },
    { id: 'runtimeTrace', summary: 'Runtime trace', value: result.payload.runtimeTrace },
    { id: 'payloadStatus', summary: 'Payload status', value: { ...result.payload.payloadStatus, artifact: artifactStatus } },
  ], {
    sectionByteLimit: options.sectionByteLimit,
    totalByteLimit: options.totalInlineByteLimit,
    attachmentFilename,
  })

  const artifactNote = createArtifactMarkdownNote(artifactStatus)
  const debugPayloadMarkdown = [artifactNote, debugPayload.markdown].filter(Boolean).join('\n\n')
  const debugPayloadFallback = [artifactNote, createDownloadedDebugJsonPlaceholder()].filter(Boolean).join('\n\n')
  const fields = {
    [BUG_REPORT_FIELD_IDS.title]: '[Bug Report]: ',
    [BUG_REPORT_FIELD_IDS.description]: 'Generated from the Cadara workbench. Replace this with a concise bug description and reproduction steps.',
    [BUG_REPORT_FIELD_IDS.document]: debugPayloadMarkdown,
    [BUG_REPORT_FIELD_IDS.environment]: environmentMarkdown,
    [BUG_REPORT_FIELD_IDS.diagnostics]: diagnostics.markdown,
  }

  return {
    fields,
    omittedSectionIds: [
      ...diagnostics.omittedSectionIds,
      ...debugPayload.omittedSectionIds,
    ],
    url: createGithubBugReportUrl(fields, {
      queryFieldByteLimit: options.queryFieldByteLimit,
      totalQueryByteLimit: options.totalQueryByteLimit,
      fullQueryFieldIds: [BUG_REPORT_FIELD_IDS.environment, ...(options.fullQueryFieldIds ?? [])],
      fallbackQueryFieldValues: {
        [BUG_REPORT_FIELD_IDS.document]: debugPayloadFallback,
        ...options.fallbackQueryFieldValues,
      },
    }),
  }
}

export function createGithubBugReportUrl(
  fields: Record<string, string>,
  options: Pick<
    BugReportIssueDraftOptions,
    'queryFieldByteLimit' | 'totalQueryByteLimit' | 'fullQueryFieldIds' | 'fallbackQueryFieldValues'
  > = {},
) {
  const url = new URL(CADARA_GITHUB_BUG_REPORT_URL)
  const fieldLimit = options.queryFieldByteLimit ?? DEFAULT_QUERY_FIELD_BYTE_LIMIT
  const totalLimit = options.totalQueryByteLimit ?? DEFAULT_TOTAL_QUERY_BYTE_LIMIT
  const fullFieldIds = new Set(options.fullQueryFieldIds ?? [])
  const fallbackValues = options.fallbackQueryFieldValues ?? {}
  let totalBytes = 0

  url.searchParams.set(BUG_REPORT_FIELD_IDS.template, CADARA_GITHUB_BUG_REPORT_TEMPLATE)
  totalBytes += getUtf8ByteLength(url.search)

  for (const [fieldId, value] of getOrderedIssueFields(fields)) {
    if (!isAllowedIssuePrefillField(fieldId)) {
      continue
    }

    const boundedValue = fullFieldIds.has(fieldId)
      ? value
      : getBoundedIssueFieldValue(fieldId, value, fieldLimit, fallbackValues)
    const nextBytes = getUtf8ByteLength(`${fieldId}=${encodeURIComponent(boundedValue)}`)

    if (fullFieldIds.has(fieldId)) {
      url.searchParams.set(fieldId, boundedValue)
      totalBytes += nextBytes
      continue
    }

    if (totalBytes + nextBytes > totalLimit) {
      const marker = '[Omitted from URL prefill because the bug-report query limit was reached.]'
      const markerBytes = getUtf8ByteLength(`${fieldId}=${encodeURIComponent(marker)}`)
      if (totalBytes + markerBytes <= totalLimit) {
        url.searchParams.set(fieldId, marker)
        totalBytes += markerBytes
      }
      continue
    }

    url.searchParams.set(fieldId, boundedValue)
    totalBytes += nextBytes
  }

  return url.toString()
}

export function createBugReportDebugArtifact(
  result: BugReportPayloadResult,
  generatedAt = new Date(result.payload.generatedAt),
): BugReportDebugArtifact | null {
  if (Object.keys(result.artifactSections).length === 0) {
    return null
  }

  return {
    filename: createBugReportArtifactFilename(generatedAt),
    mimeType: 'application/json',
    payload: stringifyJson({
      generatedAt: result.payload.generatedAt,
      compactReport: result.payload,
      omittedSections: result.artifactSections,
    }),
  }
}

export function createBugReportArtifactFilename(generatedAt: Date) {
  const timestamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `cadara-bug-report-${timestamp}.json`
}

export async function createBugReportStateArchive(
  result: BugReportPayloadResult,
  options: BugReportStateArchiveOptions = {},
): Promise<BugReportDebugArtifact> {
  const generatedAt = new Date(result.payload.generatedAt)
  const entries: Record<string, Uint8Array> = {
    'README.txt': strToU8(createStateArchiveReadme()),
    'report/compact-report.json': strToU8(stringifyJson(result.payload)),
    'state/local-storage.json': strToU8(stringifyJson(collectLocalStorageState(options.storage ?? null))),
    'state/indexeddb.json': strToU8(stringifyJson(await collectIndexedDbState(
      options.indexedDB ?? getGlobalIndexedDB() ?? null,
      options.databaseNames ?? DEFAULT_INDEXED_DB_DATABASE_NAMES,
    ))),
  }
  const authoredDocument = getArchivedSectionValue(result, 'authoredDocument')
  const operationHistory = getArchivedSectionValue(result, 'operationHistory')
  const runtimeTrace = getArchivedSectionValue(result, 'runtimeTrace')

  if (authoredDocument !== null) {
    entries['state/authored-document.json'] = strToU8(stringifyJson(authoredDocument))
  }
  if (operationHistory !== null) {
    entries['state/operation-history.json'] = strToU8(stringifyJson(operationHistory))
  }
  if (runtimeTrace !== null) {
    entries['state/runtime-trace.json'] = strToU8(stringifyJson(runtimeTrace))
  }

  return {
    filename: createBugReportStateArchiveFilename(generatedAt),
    mimeType: 'application/zip',
    payload: zipSync(entries, { level: 6 }),
  }
}

export function createBugReportStateArchiveFilename(generatedAt: Date) {
  const timestamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `cadara-state-${timestamp}.zip`
}

export function createDownloadedDebugJsonPlaceholder() {
  return [
    '<details>',
    '<summary>Downloaded debug JSON</summary>',
    '',
    '<!-- place the json you downloaded here -->',
    '</details>',
  ].join('\n')
}

export function downloadBugReportDebugArtifact(
  artifact: BugReportDebugArtifact,
  environment: BugReportDownloadEnvironment = getBugReportDownloadEnvironment(),
) {
  const blob = new Blob([createArtifactBlobPart(artifact.payload)], { type: artifact.mimeType })
  const url = environment.URL.createObjectURL(blob)
  const anchor = environment.document.createElement('a')

  anchor.href = url
  anchor.download = artifact.filename
  environment.document.body?.appendChild(anchor)
  anchor.click()
  anchor.remove?.()
  environment.URL.revokeObjectURL(url)
}

export function createFallbackBugReportIssueUrl(error: unknown) {
  const message = error instanceof Error ? error.message : 'Bug-report payload generation failed.'
  return createGithubBugReportUrl({
    [BUG_REPORT_FIELD_IDS.title]: '[Bug Report]: ',
    [BUG_REPORT_FIELD_IDS.description]: 'Generated from the Cadara workbench. Replace this with a concise bug description and reproduction steps.',
    [BUG_REPORT_FIELD_IDS.document]: createDownloadedDebugJsonPlaceholder(),
    [BUG_REPORT_FIELD_IDS.environment]: '',
    [BUG_REPORT_FIELD_IDS.diagnostics]: `Bug-report metadata collection was unavailable: ${message}`,
  })
}

function createAuthoredDocumentSection(
  snapshot: WorkspaceSnapshot | null,
  sectionByteLimit: number,
): BugReportSection<AuthoredModelDocument> {
  if (!snapshot) {
    return { status: 'not-loaded', reason: 'No active document snapshot is loaded.' }
  }

  try {
    const document = createAuthoredModelDocumentFromSnapshot(snapshot)
    const byteLength = getUtf8ByteLength(stringifyJson(document))

    if (byteLength > sectionByteLimit) {
      return {
        status: 'omitted-too-large',
        byteLength,
        reason: `Authored document is ${byteLength} bytes, over the ${sectionByteLimit} byte inline limit.`,
      }
    }

    return { status: 'included', byteLength, value: document }
  } catch (error) {
    return {
      status: 'omitted-unserializable',
      reason: error instanceof Error ? error.message : 'Authored document could not be serialized.',
    }
  }
}

function loadOperationHistorySection(
  storage: StorageLike | null,
  sectionByteLimit: number,
  recentEntryLimit: number,
): BugReportSection<ModelingOperationHistoryPayload> {
  const full = loadFullOperationHistory(storage)

  if (full.status !== 'included') {
    return full
  }

  const recentPayload: ModelingOperationHistoryPayload = {
    ...full.value,
    entries: full.value.entries.slice(-recentEntryLimit),
  }
  const byteLength = getUtf8ByteLength(stringifyJson(full.value))

  if (byteLength > sectionByteLimit) {
    return {
      status: 'omitted-too-large',
      byteLength,
      reason: `Operation history is ${byteLength} bytes, over the ${sectionByteLimit} byte inline limit.`,
    }
  }

  return {
    status: 'included',
    byteLength,
    value: recentPayload,
  }
}

function createRuntimeTraceSection(
  debugTrace: EditorRuntimeTraceSnapshot | null,
  sectionByteLimit: number,
): BugReportSection<EditorRuntimeTraceSnapshot> {
  if (!debugTrace) {
    return {
      status: 'unavailable',
      reason: 'No runtime trace data is available.',
    }
  }

  const byteLength = getUtf8ByteLength(stringifyJson(debugTrace))
  if (byteLength > sectionByteLimit) {
    return {
      status: 'omitted-too-large',
      byteLength,
      reason: `Runtime trace is ${byteLength} bytes, over the ${sectionByteLimit} byte inline limit.`,
    }
  }

  return {
    status: 'included',
    byteLength,
    value: debugTrace,
  }
}

function loadFullOperationHistory(storage: StorageLike | null): BugReportSection<ModelingOperationHistoryPayload> {
  if (!storage) {
    return {
      status: 'unavailable',
      reason: 'Local storage is unavailable.',
    }
  }

  let serialized: string | null
  try {
    serialized = storage.getItem(MODELING_OPERATION_HISTORY_STORAGE_KEY)
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'Operation history could not be read from local storage.',
    }
  }

  if (serialized === null) {
    return {
      status: 'unavailable',
      reason: 'No operation history payload is stored.',
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch {
    return {
      status: 'invalid',
      reason: 'Operation history storage did not contain valid JSON.',
    }
  }

  const result = validateOperationHistoryPayload(parsed)
  if (!result.ok) {
    return {
      status: 'invalid',
      reason: result.message,
    }
  }

  return {
    status: 'included',
    byteLength: getUtf8ByteLength(serialized),
    value: result.payload,
  }
}

function createDocumentSummary(snapshot: WorkspaceSnapshot | null): BugReportDocumentSummary {
  if (!snapshot) {
    return {
      availability: 'unavailable',
      reason: 'No active document snapshot is loaded.',
    }
  }

  return {
    availability: 'loaded',
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
    contractVersion: snapshot.document.contractVersion,
    schemaVersion: snapshot.document.schemaVersion,
    counts: {
      sketches: snapshot.document.sketches.length,
      features: snapshot.document.features.length,
      bodies: snapshot.document.bodies.length,
      constructions: snapshot.document.constructions.length,
      variables: snapshot.document.variables.length,
      diagnostics: snapshot.document.diagnostics.length,
      renderRecords: snapshot.document.render.records.length,
    },
    assetDiagnostics: snapshot.document.diagnostics.flatMap((diagnostic) => {
      if (diagnostic.detail?.kind !== 'geometryAsset') {
        return []
      }

      return [{
        code: diagnostic.detail.code,
        assetId: diagnostic.detail.assetId,
        format: diagnostic.detail.format,
        byteLength: diagnostic.detail.byteLength,
        hashPrefix: diagnostic.detail.hashPrefix,
        ownerFeatureIds: diagnostic.detail.ownerFeatureIds,
      }]
    }),
  }
}

function createDiagnosticsContext(
  snapshot: WorkspaceSnapshot | null,
  editorState: BugReportPayloadInput['editorState'],
): BugReportDiagnosticsContext {
  return {
    snapshotDiagnostics: snapshot?.document.diagnostics ?? [],
    activeFeatureDiagnostics: editorState.activeEditSession?.diagnostics ?? [],
    activeSketchDiagnostics: editorState.sketchSession?.projectionDiagnostics ?? [],
  }
}

function createEditorContext(editorState: BugReportPayloadInput['editorState']): BugReportEditorContext {
  const sketchSession = editorState.sketchSession
  const activeEditSession = editorState.activeEditSession

  return {
    mode: editorState.mode,
    activeCommand: editorState.activeCommand
      ? {
          toolId: editorState.activeCommand.toolId,
          phase: editorState.activeCommand.phase,
          commandSessionId: editorState.activeCommand.commandSessionId,
        }
      : null,
    selectionFilter: editorState.selectionFilter
      ? {
          kind: editorState.selectionFilter.kind,
          label: editorState.selectionFilter.label,
          requirementIds: editorState.selectionFilter.requirements.map((requirement) => requirement.id),
        }
      : null,
    selectedTargets: editorState.selection.map((target) => structuredClone(target)),
    activeReferencePickerFieldId: editorState.activeReferencePickerFieldId,
    preview: editorState.preview
      ? {
          kind: editorState.preview.kind,
          label: editorState.preview.label,
          target: editorState.preview.target ? structuredClone(editorState.preview.target) : null,
        }
      : null,
    activeSketch: sketchSession
      ? {
          sketchId: sketchSession.sketchId,
          sketchLabel: sketchSession.sketchLabel,
          planeKey: sketchSession.planeKey,
          activeTool: sketchSession.activeTool,
          status: sketchSession.status,
          entityCount: sketchSession.definition.entities.length,
          pointCount: sketchSession.definition.points.length,
          constraintCount: sketchSession.definition.constraints.length,
          dimensionCount: sketchSession.definition.dimensions.length,
          referenceCount: sketchSession.definition.references.length,
          projectedReferenceCount: sketchSession.projectedReferences.length,
          historyCursor: sketchSession.historyCursor.kind === 'empty' ? 'empty' : sketchSession.historyCursor.itemId,
          constructionModifierActive: sketchSession.constructionModifierActive,
          constructionTargetPicking: sketchSession.constructionTargetPicking,
          referenceTargetPicking: sketchSession.referenceTargetPicking,
          validationMessage: sketchSession.validationMessage,
        }
      : null,
    activeFeatureEdit: activeEditSession
      ? {
          mode: activeEditSession.mode,
          featureType: activeEditSession.featureType,
          featureId: activeEditSession.featureId,
          previewId: activeEditSession.previewId,
          status: activeEditSession.status,
          lastPreviewRevisionId: activeEditSession.lastPreviewRevisionId,
          lastCommittedRevisionId: activeEditSession.lastCommittedRevisionId,
          diagnosticCount: activeEditSession.diagnostics.length,
          draftSummary: summarizeFeatureDraft(activeEditSession.draft),
        }
      : null,
  }
}

function summarizeFeatureDraft(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { kind: 'array', length: value.length }
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (Array.isArray(entry)) {
        return [key, { kind: 'array', length: entry.length }]
      }

      if (typeof entry === 'object' && entry !== null) {
        return [key, summarizeCompactObject(entry)]
      }

      return [key, entry]
    }),
  )
}

function summarizeCompactObject(value: object) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (Array.isArray(entry)) {
        return [key, { kind: 'array', length: entry.length }]
      }

      if (typeof entry === 'object' && entry !== null) {
        return [key, '[object]']
      }

      return [key, entry]
    }),
  )
}

function collectBrowserMetadata(navigatorLike = getGlobalNavigator()): BugReportBrowserMetadata {
  const userAgentData = navigatorLike?.userAgentData

  return {
    userAgent: navigatorLike?.userAgent ?? 'unavailable',
    language: navigatorLike?.language ?? null,
    languages: navigatorLike?.languages ? [...navigatorLike.languages] : [],
    platform: navigatorLike?.platform ?? null,
    hardwareConcurrency: navigatorLike?.hardwareConcurrency ?? null,
    deviceMemory: navigatorLike?.deviceMemory ?? null,
    userAgentData: userAgentData
      ? {
          mobile: userAgentData.mobile ?? null,
          platform: userAgentData.platform ?? null,
          brands: userAgentData.brands ? [...userAgentData.brands] : [],
        }
      : null,
  }
}

function collectViewportMetadata(windowLike = getGlobalWindow()): BugReportViewportMetadata {
  return {
    width: windowLike?.innerWidth ?? null,
    height: windowLike?.innerHeight ?? null,
    devicePixelRatio: windowLike?.devicePixelRatio ?? null,
    screenWidth: windowLike?.screen?.width ?? null,
    screenHeight: windowLike?.screen?.height ?? null,
  }
}

function collectRouteContext(locationLike = getGlobalWindow()?.location): BugReportRouteContext {
  return {
    origin: locationLike?.origin ?? null,
    pathname: locationLike?.pathname ?? null,
    search: locationLike?.search ?? null,
    hash: locationLike?.hash ?? null,
  }
}

function collectWebglMetadata(documentLike = getGlobalDocument()): BugReportWebglMetadata {
  if (!documentLike) {
    return {
      status: 'unavailable',
      vendor: null,
      renderer: null,
      unmaskedVendor: null,
      unmaskedRenderer: null,
      reason: 'Document is unavailable.',
    }
  }

  try {
    const canvas = documentLike.createElement('canvas')
    const context = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')

    if (!context) {
      return {
        status: 'unavailable',
        vendor: null,
        renderer: null,
        unmaskedVendor: null,
        unmaskedRenderer: null,
        reason: 'WebGL context could not be created.',
      }
    }

    const debugInfo = context.getExtension('WEBGL_debug_renderer_info')
    return {
      status: 'available',
      vendor: String(context.getParameter(context.VENDOR)),
      renderer: String(context.getParameter(context.RENDERER)),
      unmaskedVendor: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : null,
      unmaskedRenderer: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : null,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      vendor: null,
      renderer: null,
      unmaskedVendor: null,
      unmaskedRenderer: null,
      reason: error instanceof Error ? error.message : 'WebGL metadata could not be collected.',
    }
  }
}

function createOmittedMarkdownMarker(
  summary: string,
  byteLength: number,
  limit: number,
  attachmentFilename: string | null | undefined,
) {
  const attachmentNote = attachmentFilename
    ? ` Attach \`${attachmentFilename}\` to include the omitted data.`
    : ' Attach the generated debug artifact if one was downloaded.'

  return `**${summary} omitted:** ${byteLength} bytes exceeded the ${limit} byte inline limit.${attachmentNote}`
}

function createEnvironmentMarkdown(payload: BugReportPayload) {
  return [
    '<details>',
    '<summary>Environment</summary>',
    '',
    '```json',
    JSON.stringify({
      build: payload.build,
      browser: payload.browser,
      viewport: payload.viewport,
      webgl: payload.webgl,
      route: payload.route,
      editor: payload.editor,
    }),
    '```',
    '</details>',
  ].join('\n')
}

function createArtifactStatus(result: BugReportPayloadResult): BugReportArtifactStatus {
  const artifact = createBugReportDebugArtifact(result)
  return artifact
    ? { kind: 'unavailable', filename: artifact.filename, reason: 'Debug artifact download was not attempted.' }
    : { kind: 'not-needed' }
}

function createArtifactMarkdownNote(status: BugReportArtifactStatus) {
  if (status.kind === 'not-needed') {
    return ''
  }

  if (status.kind === 'downloaded') {
    return `<!-- A debug artifact was downloaded as ${status.filename}. Please attach it to this issue. -->`
  }

  return `Debug artifact unavailable${status.filename ? ` for \`${status.filename}\`` : ''}: ${status.reason}`
}

function isAllowedIssuePrefillField(fieldId: string) {
  return fieldId === BUG_REPORT_FIELD_IDS.title
    || fieldId === BUG_REPORT_FIELD_IDS.description
    || fieldId === BUG_REPORT_FIELD_IDS.document
    || fieldId === BUG_REPORT_FIELD_IDS.environment
    || fieldId === BUG_REPORT_FIELD_IDS.diagnostics
}

function getOrderedIssueFields(fields: Record<string, string>) {
  const fieldPriority = [
    BUG_REPORT_FIELD_IDS.title,
    BUG_REPORT_FIELD_IDS.description,
    BUG_REPORT_FIELD_IDS.environment,
    BUG_REPORT_FIELD_IDS.document,
    BUG_REPORT_FIELD_IDS.diagnostics,
  ] as const
  const entries = new Map(Object.entries(fields))
  const ordered: Array<[string, string]> = []

  for (const fieldId of fieldPriority) {
    const value = entries.get(fieldId)
    if (value !== undefined) {
      ordered.push([fieldId, value])
      entries.delete(fieldId)
    }
  }

  return ordered.concat([...entries])
}

function getBoundedIssueFieldValue(
  fieldId: string,
  value: string,
  fieldLimit: number,
  fallbackValues: Record<string, string>,
) {
  if (getUtf8ByteLength(value) <= fieldLimit) {
    return value
  }

  const fallback = fallbackValues[fieldId]
  if (fallback && getUtf8ByteLength(fallback) <= fieldLimit) {
    return fallback
  }

  return limitTextByBytes(
    value,
    fieldLimit,
    '\n\n[Omitted from URL prefill because this field exceeded the bug-report query limit.]',
  )
}

function limitTextByBytes(value: string, limit: number, marker: string) {
  if (getUtf8ByteLength(value) <= limit) {
    return value
  }

  const markerBytes = getUtf8ByteLength(marker)
  const targetBytes = Math.max(0, limit - markerBytes)
  let output = ''

  for (const char of value) {
    if (getUtf8ByteLength(output + char) > targetBytes) {
      break
    }
    output += char
  }

  return `${output}${marker}`
}

function createArtifactBlobPart(payload: string | Uint8Array): BlobPart {
  if (typeof payload === 'string') {
    return payload
  }

  const copy = new Uint8Array(payload.byteLength)
  copy.set(payload)
  return copy.buffer
}

function createStateArchiveReadme() {
  return [
    'Cadara debug state archive',
    '',
    'report/compact-report.json contains the same compact diagnostics used by the GitHub bug-report flow.',
    'state/authored-document.json contains the authored document reconstructed from the current runtime snapshot when available.',
    'state/operation-history.json contains the persisted operation-history fallback when available.',
    'state/runtime-trace.json contains the bounded runtime trace captured by the dev debug platform when available.',
    'state/local-storage.json contains known Cadara localStorage entries.',
    'state/indexeddb.json contains a JSON-safe dump of known Cadara IndexedDB databases when the browser allows enumeration.',
  ].join('\n')
}

function getArchivedSectionValue(
  result: BugReportPayloadResult,
  sectionId: 'authoredDocument' | 'operationHistory' | 'runtimeTrace',
) {
  const section = result.payload[sectionId]
  if (section.status === 'included') {
    return section.value
  }

  return result.artifactSections[sectionId] ?? null
}

function collectLocalStorageState(storage: StorageLike | null) {
  if (!storage) {
    return { status: 'unavailable' as const, reason: 'Browser localStorage is unavailable.' }
  }

  const entries: Record<string, string | null> = {}
  const keys = new Set<string>([
    MODELING_OPERATION_HISTORY_STORAGE_KEY,
    DOCUMENT_REPOSITORY_AUTOMERGE_URLS_STORAGE_KEY,
  ])
  const enumerableStorage = storage as StorageLike & {
    readonly length?: number
    key?: (index: number) => string | null
  }

  if (typeof enumerableStorage.length === 'number' && typeof enumerableStorage.key === 'function') {
    for (let index = 0; index < enumerableStorage.length; index += 1) {
      const key = enumerableStorage.key(index)
      if (key?.startsWith('cad.')) {
        keys.add(key)
      }
    }
  }

  for (const key of [...keys].sort()) {
    try {
      entries[key] = storage.getItem(key)
    } catch (error: unknown) {
      entries[key] = `[[unavailable: ${formatUnknownError(error)}]]`
    }
  }

  return { status: 'included' as const, entries }
}

async function collectIndexedDbState(indexedDBFactory: IDBFactory | null, databaseNames: readonly string[]) {
  if (!indexedDBFactory) {
    return { status: 'unavailable' as const, reason: 'IndexedDB is unavailable.' }
  }

  const databases = (indexedDBFactory as IDBFactory & {
    databases?: () => Promise<readonly { name?: string | null; version?: number }[]>
  }).databases
  if (typeof databases !== 'function') {
    return {
      status: 'unavailable' as const,
      reason: 'IndexedDB database enumeration is unavailable in this browser.',
    }
  }

  try {
    const existingDatabases = await databases.call(indexedDBFactory)
    const existingDatabaseNames = new Set(existingDatabases.map((database) => database.name).filter(isString))
    const selectedDatabaseNames = databaseNames.filter((databaseName) => existingDatabaseNames.has(databaseName))

    return {
      status: 'included' as const,
      databases: await Promise.all(selectedDatabaseNames.map((databaseName) => readIndexedDbDatabase(indexedDBFactory, databaseName))),
      missingDatabases: databaseNames.filter((databaseName) => !existingDatabaseNames.has(databaseName)),
    }
  } catch (error: unknown) {
    return { status: 'failed' as const, reason: formatUnknownError(error) }
  }
}

async function readIndexedDbDatabase(indexedDBFactory: IDBFactory, databaseName: string) {
  const database = await openIndexedDbDatabase(indexedDBFactory, databaseName)
  try {
    const storeNames = Array.from(database.objectStoreNames)
    return {
      name: database.name,
      version: database.version,
      objectStores: await Promise.all(storeNames.map((storeName) => readIndexedDbObjectStore(database, storeName))),
    }
  } finally {
    database.close()
  }
}

function openIndexedDbDatabase(indexedDBFactory: IDBFactory, databaseName: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDBFactory.open(databaseName)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB database ${databaseName} could not be opened.`))
    request.onblocked = () => reject(new Error(`IndexedDB database ${databaseName} open was blocked.`))
  })
}

async function readIndexedDbObjectStore(database: IDBDatabase, storeName: string) {
  const transaction = database.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)
  const keysRequest = store.getAllKeys()
  const valuesRequest = store.getAll()
  const [keys, values] = await Promise.all([
    requestToPromise(keysRequest),
    requestToPromise(valuesRequest),
    transactionDone(transaction),
  ]).then(([keys, values]) => [keys, values] as const)

  return {
    name: storeName,
    records: values.map((value, index) => ({
      key: toJsonSafeValue(keys[index]),
      value: toJsonSafeValue(value),
    })),
  }
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
  })
}

function toJsonSafeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof ArrayBuffer) {
    return serializeBytes('ArrayBuffer', new Uint8Array(value))
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return serializeBytes(
      value.constructor.name,
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    )
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafeValue(entry, seen))
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[[circular]]'
    }

    seen.add(value)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toJsonSafeValue(entry, seen)]),
    )
  }

  return String(value)
}

function serializeBytes(type: string, bytes: Uint8Array) {
  return {
    type,
    byteLength: bytes.byteLength,
    base64: bytesToBase64(bytes),
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function getUtf8ByteLength(value: string) {
  return TEXT_ENCODER.encode(value).byteLength
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getBugReportDownloadEnvironment(): BugReportDownloadEnvironment {
  if (!globalThis.document) {
    throw new Error('Browser document is not available for bug-report download.')
  }

  return {
    document: globalThis.document as unknown as BugReportDownloadEnvironment['document'],
    URL: globalThis.URL,
  }
}

function getGlobalNavigator(): NavigatorLike | undefined {
  return globalThis.navigator as NavigatorLike | undefined
}

function getGlobalWindow(): WindowLike | undefined {
  return globalThis.window as WindowLike | undefined
}

function getGlobalDocument(): DocumentLike | undefined {
  return globalThis.document as unknown as DocumentLike | undefined
}

function getGlobalIndexedDB(): IDBFactory | undefined {
  return globalThis.indexedDB
}
