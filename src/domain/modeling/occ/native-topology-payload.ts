import { z } from 'zod'

import type { MeshExportAccuracy } from '@/contracts/export/capabilities'
import type { CadaraBrepGeometryAssetData } from '@/contracts/modeling/geometry-assets'
import type {
  BodyId,
  CoedgeId,
  EdgeId,
  FaceId,
  FeatureId,
  LoopId,
  RevisionId,
  VertexId,
} from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'

export const OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION = 'occ-native-topology-payload/v1alpha1'

export const OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS = [
  'CadaraNativeTopologyProbe',
  'CadaraBuildNativeTopologyPayload',
  'CadaraExecuteNativeFeatureTransaction',
  'CadaraBuildNativeExactBrepPayload',
  'CadaraBuildNativeMeshExportPayload',
] as const

export type OccNativeTopologyKernelEntrypoint = typeof OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS[number]

export interface OpenCascadeNativeTopologyKernelHost {
  CadaraNativeTopologyProbe?: {
    SchemaVersion?: () => string
    HasPre8Shim?: () => boolean
    SummarizeShape?: (shape: unknown) => string
  }
  CadaraBuildNativeTopologyPayload?: {
    BuildJson?: (
      shape: unknown,
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => string
  }
  CadaraExecuteNativeFeatureTransaction?: {
    BuildCommittedShapePayload?: (
      shape: unknown,
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => string
    BuildBooleanCommittedShapePayload?: (
      left: unknown,
      right: unknown,
      operation: 'join' | 'cut' | 'intersect',
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => string
    BuildBooleanCommittedShapeTransaction?: (
      left: unknown,
      right: unknown,
      operation: 'join' | 'cut' | 'intersect',
      bodyId: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult
    BuildBooleanCommittedShapeTransactionWithHistory?: (
      left: unknown,
      right: unknown,
      operation: 'join' | 'cut' | 'intersect',
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult
    BuildFilletCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      edgeIdsCsv: string,
      radius: number,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult
    BuildChamferCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      edgeIdsCsv: string,
      distance: number,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult
    BuildShellCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      faceIdsCsv: string,
      signedThickness: number,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult
    BuildTransformCommittedShapeTransactionWithHistory?: (
      shape: unknown,
      transform: unknown,
      copy: boolean,
      bodyId: string,
      previousTopologyToken: string,
      topologyToken: string,
      linearDeflection: number,
      angularDeflection: number,
    ) => OpenCascadeNativeFeatureTransactionResult
  }
  CadaraBuildNativeExactBrepPayload?: {
    BuildJson?: (
      shape: unknown,
      bodyId: string,
      topologyToken: string,
    ) => string
  }
  CadaraBuildNativeMeshExportPayload?: {
    BuildJson?: (
      shape: unknown,
      linearDeflection: number,
      angularDeflection: number,
    ) => string
  }
}

export interface OpenCascadeNativeFeatureTransactionResult {
  Shape: () => unknown
  PayloadJson: () => string
  HistoryJson: () => string
  IsDone: () => boolean
}

export type OccNativeTopologyKind =
  | 'body'
  | 'solid'
  | 'shell'
  | 'face'
  | 'loop'
  | 'coedge'
  | 'edge'
  | 'vertex'

export type OccNativeTopologyId =
  | BodyId
  | `occ_solid_${string}`
  | `occ_shell_${string}`
  | FaceId
  | LoopId
  | CoedgeId
  | EdgeId
  | VertexId

export type OccNativeIdentitySource =
  | 'occt7-shim'
  | 'brepgraph'

export type OccNativeBufferScalar =
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'int32'
  | 'float32'
  | 'float64'

export interface OccNativeBufferRef {
  bufferId: `occ_buffer_${string}`
  scalar: OccNativeBufferScalar
  byteOffset: number
  byteLength: number
  itemStride: number
}

export interface OccNativeTransferableBuffer {
  bufferId: OccNativeBufferRef['bufferId']
  buffer: ArrayBuffer
}

export interface OccNativeTableLayout {
  rowCount: number
  columns: Record<string, OccNativeBufferRef>
}

export interface OccNativeTopologyTableLayout {
  bodies: OccNativeTableLayout
  solids: OccNativeTableLayout
  shells: OccNativeTableLayout
  faces: OccNativeTableLayout
  loops: OccNativeTableLayout
  coedges: OccNativeTableLayout
  edges: OccNativeTableLayout
  vertices: OccNativeTableLayout
}

export interface OccNativeIdentityTableLayout {
  topologyToKernelIdentity: OccNativeTableLayout
  kernelHistorySuccessors: OccNativeTableLayout
  publicReferenceBindings: OccNativeTableLayout
}

export interface OccNativeAdjacencyTableLayout {
  faceLoops: OccNativeTableLayout
  loopCoedges: OccNativeTableLayout
  edgeVertices: OccNativeTableLayout
  coedgeOpposites: OccNativeTableLayout
  faceEdges: OccNativeTableLayout
  vertexEdges: OccNativeTableLayout
}

export interface OccNativeMeshTableLayout {
  positions: OccNativeBufferRef
  normals: OccNativeBufferRef
  triangleIndices: OccNativeBufferRef
  triangleFaceBindings: OccNativeBufferRef
}

export interface OccNativeExactBrepTableLayout {
  topology: OccNativeTopologyTableLayout
  curves: OccNativeTableLayout
  surfaces: OccNativeTableLayout
  trims: OccNativeTableLayout
  fallbackTriangles: OccNativeMeshTableLayout | null
}

export interface OccNativeDiagnosticTableLayout {
  diagnostics: OccNativeTableLayout
  targetBindings: OccNativeTableLayout | null
}

export interface OccNativeTopologyRecord {
  id: OccNativeTopologyId
  kind: OccNativeTopologyKind
  bodyId: BodyId
  parentId: OccNativeTopologyId | null
}

export interface OccNativeKernelIdentityRecord {
  topologyId: OccNativeTopologyId
  source: OccNativeIdentitySource
  kernelUid: string
  publicRef: DurableRef | null
}

export type OccNativeReferenceInvalidationReason =
  | 'deleted'
  | 'ambiguous'
  | 'unsupported-history'
  | 'invalid-result'
  | 'unsafe-repair'

export interface OccNativeReferenceInvalidation {
  target: DurableRef
  reason: OccNativeReferenceInvalidationReason
  successors: readonly DurableRef[]
  featureId: FeatureId | null
  message: string
}

export interface OccNativeTopologyDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  target: DurableRef | null
  detail: Record<string, unknown> | null
}

export const OCC_NATIVE_FEATURE_TRANSACTION_HISTORY_SCHEMA_VERSION = 'occ-native-history-payload/v1alpha1'

export interface OccNativeFeatureTransactionHistoryPayload {
  schemaVersion: typeof OCC_NATIVE_FEATURE_TRANSACTION_HISTORY_SCHEMA_VERSION
  source: OccNativeIdentitySource
  status: 'available' | 'unsupported'
  operation?: string
  bodyId?: BodyId
  previousTopologyToken?: string
  topologyToken?: string
  records: readonly OccNativeFeatureTransactionHistoryRecord[]
  diagnostics: readonly OccNativeTopologyDiagnostic[]
}

export type OccNativeFeatureTransactionHistoryReason =
  | 'unique-successor'
  | 'ambiguous'
  | 'deleted'
  | 'missing'

export interface OccNativeFeatureTransactionHistoryRecord {
  target: DurableRef
  reason: OccNativeFeatureTransactionHistoryReason
  successors: readonly DurableRef[]
}

export interface OccNativeTopologyBodyPayload {
  bodyId: BodyId
  topology: readonly OccNativeTopologyRecord[]
  identity: readonly OccNativeKernelIdentityRecord[]
  adjacency: OccNativeAdjacencyTableLayout
  renderMesh: OccNativeMeshTableLayout | null
  renderMeshSummary?: OccNativeShimMeshSummary | null
  exactBrep: OccNativeExactBrepTableLayout | null
  invalidations: readonly OccNativeReferenceInvalidation[]
}

export interface OccNativeTopologyPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION
  source: OccNativeIdentitySource
  revisionId: RevisionId
  lodTierId: OccTessellationTierId | null
  bodies: readonly OccNativeTopologyBodyPayload[]
  tables: {
    topology: OccNativeTopologyTableLayout
    identity: OccNativeIdentityTableLayout
    diagnostics: OccNativeDiagnosticTableLayout
  }
  buffers: readonly OccNativeTransferableBuffer[]
  diagnostics: readonly OccNativeTopologyDiagnostic[]
}

export interface OccNativeExactBrepPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION
  revisionId: RevisionId
  target: DurableRef
  brep: CadaraBrepGeometryAssetData
  tables: OccNativeExactBrepTableLayout
  buffers: readonly OccNativeTransferableBuffer[]
  diagnostics: readonly OccNativeTopologyDiagnostic[]
}

export interface OccNativeMeshExportPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION
  revisionId: RevisionId
  target: DurableRef
  options: MeshExportAccuracy
  mesh: OccNativeMeshTableLayout
  meshSummary?: OccNativeShimMeshSummary | null
  buffers: readonly OccNativeTransferableBuffer[]
  diagnostics: readonly OccNativeTopologyDiagnostic[]
}

export interface OccNativeTopologyCapabilityProbeResult {
  kind: 'available' | 'missing'
  requiredEntrypoints: readonly OccNativeTopologyKernelEntrypoint[]
  missingEntrypoints: readonly OccNativeTopologyKernelEntrypoint[]
  diagnostics: readonly OccNativeTopologyDiagnostic[]
}

export interface OccNativeShimMeshSummary {
  nodeCount: number
  triangleCount: number
  linearDeflection: number
  angularDeflection: number
  positions?: readonly (readonly [number, number, number])[]
  triangleIndices?: readonly (readonly [number, number, number])[]
  triangleFaceBindings?: readonly string[]
}

export interface OccNativeShimVertexPointRecord {
  vertexId: VertexId
  point: readonly [number, number, number]
}

export interface OccNativeShimFaceEdgeRecord {
  faceId: FaceId
  edgeIds: readonly EdgeId[]
}

const nativeShimTopologyRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['face', 'edge', 'vertex']),
  bodyId: z.string().min(1),
  index: z.number().int().positive(),
})

const nativeShimEdgeVertexRecordSchema = z.object({
  edgeId: z.string().min(1),
  start: z.tuple([z.number(), z.number(), z.number()]),
  end: z.tuple([z.number(), z.number(), z.number()]),
})

const nativeShimMeshSummarySchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  triangleCount: z.number().int().nonnegative(),
  linearDeflection: z.number().nonnegative(),
  angularDeflection: z.number().nonnegative(),
  positions: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
  triangleIndices: z.array(z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ])).optional(),
  triangleFaceBindings: z.array(z.string().min(1)).optional(),
})

const nativeShimVertexPointRecordSchema = z.object({
  vertexId: z.string().min(1),
  point: z.tuple([z.number(), z.number(), z.number()]),
})

const nativeShimFaceEdgeRecordSchema = z.object({
  faceId: z.string().min(1),
  edgeIds: z.array(z.string().min(1)),
})

const nativeTopologyDiagnosticSchema: z.ZodType<OccNativeTopologyDiagnostic> = z.object({
  code: z.string().min(1),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1),
  target: z.custom<DurableRef>((value) =>
    (typeof value === 'object' && value !== null && 'kind' in value) || value === null,
  ).nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
})

const nativeFeatureTransactionHistoryPayloadSchema: z.ZodType<OccNativeFeatureTransactionHistoryPayload> = z.object({
  schemaVersion: z.literal(OCC_NATIVE_FEATURE_TRANSACTION_HISTORY_SCHEMA_VERSION),
  source: z.enum(['occt7-shim', 'brepgraph']),
  status: z.enum(['available', 'unsupported']),
  operation: z.string().optional(),
  bodyId: z.string().optional() as z.ZodType<BodyId | undefined>,
  previousTopologyToken: z.string().optional(),
  topologyToken: z.string().optional(),
  records: z.array(z.object({
    target: z.custom<DurableRef>((value) => typeof value === 'object' && value !== null && 'kind' in value),
    reason: z.enum(['unique-successor', 'ambiguous', 'deleted', 'missing']),
    successors: z.array(z.custom<DurableRef>((value) => typeof value === 'object' && value !== null && 'kind' in value)),
  })).optional().default([]),
  diagnostics: z.array(nativeTopologyDiagnosticSchema).optional().default([]),
})

const nativeShimPayloadSchema = z.object({
  schemaVersion: z.literal(OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION),
  source: z.literal('occt7-shim'),
  bodyId: z.string().min(1).optional(),
  topologyToken: z.string().min(1).optional(),
  counts: z.object({
    faces: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    vertices: z.number().int().nonnegative(),
  }).optional(),
  topology: z.array(nativeShimTopologyRecordSchema).optional().default([]),
  edgeVertices: z.array(nativeShimEdgeVertexRecordSchema).optional().default([]),
  vertexPoints: z.array(nativeShimVertexPointRecordSchema).optional().default([]),
  faceEdges: z.array(nativeShimFaceEdgeRecordSchema).optional().default([]),
  mesh: nativeShimMeshSummarySchema.optional(),
  diagnostics: z.array(nativeTopologyDiagnosticSchema).optional().default([]),
})

export type OccNativeShimPayload = z.infer<typeof nativeShimPayloadSchema>

const emptyBuffer = new ArrayBuffer(0)

function emptyBufferRef(
  suffix: string,
  scalar: OccNativeBufferScalar,
): OccNativeBufferRef {
  return {
    bufferId: `occ_buffer_empty_${suffix}` as OccNativeBufferRef['bufferId'],
    scalar,
    byteOffset: 0,
    byteLength: 0,
    itemStride: 0,
  }
}

function emptyTableLayout(rowCount = 0): OccNativeTableLayout {
  return {
    rowCount,
    columns: {},
  }
}

function createTopologyTableLayout(counts: {
  bodies?: number
  solids?: number
  shells?: number
  faces?: number
  loops?: number
  coedges?: number
  edges?: number
  vertices?: number
} = {}): OccNativeTopologyTableLayout {
  return {
    bodies: emptyTableLayout(counts.bodies ?? 0),
    solids: emptyTableLayout(counts.solids ?? 0),
    shells: emptyTableLayout(counts.shells ?? 0),
    faces: emptyTableLayout(counts.faces ?? 0),
    loops: emptyTableLayout(counts.loops ?? 0),
    coedges: emptyTableLayout(counts.coedges ?? 0),
    edges: emptyTableLayout(counts.edges ?? 0),
    vertices: emptyTableLayout(counts.vertices ?? 0),
  }
}

function createIdentityTableLayout(rowCount = 0): OccNativeIdentityTableLayout {
  return {
    topologyToKernelIdentity: emptyTableLayout(rowCount),
    kernelHistorySuccessors: emptyTableLayout(),
    publicReferenceBindings: emptyTableLayout(rowCount),
  }
}

function createAdjacencyTableLayout(edgeVertexCount = 0): OccNativeAdjacencyTableLayout {
  return {
    faceLoops: emptyTableLayout(),
    loopCoedges: emptyTableLayout(),
    edgeVertices: emptyTableLayout(edgeVertexCount),
    coedgeOpposites: emptyTableLayout(),
    faceEdges: emptyTableLayout(),
    vertexEdges: emptyTableLayout(),
  }
}

function createMeshTableLayout(): OccNativeMeshTableLayout {
  return {
    positions: emptyBufferRef('positions', 'float32'),
    normals: emptyBufferRef('normals', 'float32'),
    triangleIndices: emptyBufferRef('triangle_indices', 'uint32'),
    triangleFaceBindings: emptyBufferRef('triangle_face_bindings', 'uint32'),
  }
}

function createExactBrepTableLayout(topology: OccNativeTopologyTableLayout): OccNativeExactBrepTableLayout {
  return {
    topology,
    curves: emptyTableLayout(),
    surfaces: emptyTableLayout(),
    trims: emptyTableLayout(),
    fallbackTriangles: null,
  }
}

function createDiagnosticTableLayout(rowCount = 0): OccNativeDiagnosticTableLayout {
  return {
    diagnostics: emptyTableLayout(rowCount),
    targetBindings: null,
  }
}

export function createNativeTopologyDiagnostic(
  code: string,
  message: string,
  detail: Record<string, unknown> | null = null,
  target: DurableRef | null = null,
): OccNativeTopologyDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    target,
    detail,
  }
}

function nativeTopologyRecordToPublicRef(
  record: OccNativeTopologyRecord,
): DurableRef | null {
  switch (record.kind) {
    case 'face':
      return {
        kind: 'face',
        bodyId: record.bodyId,
        faceId: record.id as FaceId,
      }
    case 'edge':
      return {
        kind: 'edge',
        bodyId: record.bodyId,
        edgeId: record.id as EdgeId,
      }
    case 'vertex':
      return {
        kind: 'vertex',
        bodyId: record.bodyId,
        vertexId: record.id as VertexId,
      }
    case 'body':
      return {
        kind: 'body',
        bodyId: record.bodyId,
      }
    default:
      return null
  }
}

function createIdentityRecords(
  topology: readonly OccNativeTopologyRecord[],
): OccNativeKernelIdentityRecord[] {
  return topology.map((record) => ({
    topologyId: record.id,
    source: 'occt7-shim',
    kernelUid: record.id,
    publicRef: nativeTopologyRecordToPublicRef(record),
  }))
}

function countTopologyKinds(topology: readonly OccNativeTopologyRecord[]) {
  const counts = {
    bodies: 0,
    solids: 0,
    shells: 0,
    faces: 0,
    loops: 0,
    coedges: 0,
    edges: 0,
    vertices: 0,
  }

  for (const record of topology) {
    switch (record.kind) {
      case 'body':
        counts.bodies += 1
        break
      case 'solid':
        counts.solids += 1
        break
      case 'shell':
        counts.shells += 1
        break
      case 'face':
        counts.faces += 1
        break
      case 'loop':
        counts.loops += 1
        break
      case 'coedge':
        counts.coedges += 1
        break
      case 'edge':
        counts.edges += 1
        break
      case 'vertex':
        counts.vertices += 1
        break
    }
  }

  return counts
}

function createBodyTopologyRecords(
  bodyId: BodyId,
  nativePayload: OccNativeShimPayload,
): OccNativeTopologyRecord[] {
  return [
    {
      id: bodyId,
      kind: 'body',
      bodyId,
      parentId: null,
    },
    ...nativePayload.topology.map((record) => ({
      id: record.id as OccNativeTopologyId,
      kind: record.kind,
      bodyId: record.bodyId as BodyId,
      parentId: bodyId,
    } satisfies OccNativeTopologyRecord)),
  ]
}

export function parseNativeShimPayloadJson(json: string): OccNativeShimPayload {
  const parsed = JSON.parse(json) as unknown
  return nativeShimPayloadSchema.parse(parsed)
}

export function parseNativeFeatureTransactionHistoryJson(json: string): OccNativeFeatureTransactionHistoryPayload {
  const parsed = JSON.parse(json) as unknown
  return nativeFeatureTransactionHistoryPayloadSchema.parse(parsed)
}

export function createOccNativeReferenceInvalidationsFromHistoryPayload(
  history: OccNativeFeatureTransactionHistoryPayload,
): OccNativeReferenceInvalidation[] {
  if (history.status !== 'available') {
    return history.diagnostics.map((diagnostic) => ({
      target: diagnostic.target ?? ({ kind: 'body', bodyId: (history.bodyId ?? 'body_unresolved') as BodyId }),
      reason: 'unsupported-history',
      successors: [],
      featureId: null,
      message: diagnostic.message,
    }))
  }

  const invalidations: OccNativeReferenceInvalidation[] = []

  for (const record of history.records) {
    switch (record.reason) {
      case 'unique-successor':
        break
      case 'ambiguous':
        invalidations.push({
          target: record.target,
          reason: 'ambiguous',
          successors: record.successors,
          featureId: null,
          message: 'Native topology history reported ambiguous successors.',
        })
        break
      case 'deleted':
        invalidations.push({
          target: record.target,
          reason: 'deleted',
          successors: [],
          featureId: null,
          message: 'Native topology history reported deleted topology.',
        })
        break
      case 'missing':
        invalidations.push({
          target: record.target,
          reason: 'unsupported-history',
          successors: [],
          featureId: null,
          message: 'Native topology history could not resolve a reliable successor.',
        })
        break
    }
  }

  return invalidations
}

export function createOccNativeTopologyPayloadFromShimPayloads(input: {
  revisionId: RevisionId
  lodTierId: OccTessellationTierId | null
  bodies: readonly {
    bodyId: BodyId
    nativePayload: OccNativeShimPayload
    invalidations?: readonly OccNativeReferenceInvalidation[]
  }[]
  diagnostics?: readonly OccNativeTopologyDiagnostic[]
}): OccNativeTopologyPayload {
  const bodyPayloads = input.bodies.map(({ bodyId, nativePayload, invalidations = [] }) => {
    const topology = createBodyTopologyRecords(bodyId, nativePayload)
    const identity = createIdentityRecords(topology)
    const topologyCounts = countTopologyKinds(topology)

    return {
      bodyId,
      topology,
      identity,
      adjacency: createAdjacencyTableLayout(nativePayload.edgeVertices.length),
      renderMesh: nativePayload.mesh ? createMeshTableLayout() : null,
      renderMeshSummary: nativePayload.mesh ?? null,
      exactBrep: null,
      invalidations,
      topologyCounts,
    }
  })
  const allTopology = bodyPayloads.flatMap((body) => body.topology)
  const allDiagnostics = [
    ...(input.diagnostics ?? []),
    ...input.bodies.flatMap(({ nativePayload }) => nativePayload.diagnostics),
  ]

  return {
    schemaVersion: OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION,
    source: 'occt7-shim',
    revisionId: input.revisionId,
    lodTierId: input.lodTierId,
    bodies: bodyPayloads.map(({ topologyCounts: _topologyCounts, ...body }) => body),
    tables: {
      topology: createTopologyTableLayout(countTopologyKinds(allTopology)),
      identity: createIdentityTableLayout(allTopology.length),
      diagnostics: createDiagnosticTableLayout(allDiagnostics.length),
    },
    buffers: [],
    diagnostics: allDiagnostics,
  }
}

export function createOccNativeExactBrepPayloadFromShimPayload(input: {
  revisionId: RevisionId
  target: DurableRef
  bodyId: BodyId
  bodyLabel: string
  nativePayload: OccNativeShimPayload
  diagnostics?: readonly OccNativeTopologyDiagnostic[]
}): OccNativeExactBrepPayload {
  const topology = createBodyTopologyRecords(input.bodyId, input.nativePayload)
  const topologyLayout = createTopologyTableLayout(countTopologyKinds(topology))

  return {
    schemaVersion: OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION,
    revisionId: input.revisionId,
    target: input.target,
    brep: {
      kind: 'cadaraBrep',
      schemaVersion: 'cadara-brep/v1alpha1',
      source: {
        importedFormat: 'step',
        sourceStored: false,
      },
      bodies: [{
        bodyKey: input.bodyId,
        label: input.bodyLabel,
        topology: {
          vertices: [],
          edges: [],
          coedges: [],
          loops: [],
          faces: [],
          shells: [],
          solids: [],
        },
      }],
    },
    tables: createExactBrepTableLayout(topologyLayout),
    buffers: [],
    diagnostics: [...input.nativePayload.diagnostics, ...(input.diagnostics ?? [])],
  }
}

export function createOccNativeMeshExportPayloadFromShimPayload(input: {
  revisionId: RevisionId
  target: DurableRef
  options: MeshExportAccuracy
  nativePayload: OccNativeShimPayload
  diagnostics?: readonly OccNativeTopologyDiagnostic[]
}): OccNativeMeshExportPayload {
  return {
    schemaVersion: OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION,
    revisionId: input.revisionId,
    target: input.target,
    options: input.options,
    mesh: createMeshTableLayout(),
    meshSummary: input.nativePayload.mesh ?? null,
    buffers: [],
    diagnostics: [...input.nativePayload.diagnostics, ...(input.diagnostics ?? [])],
  }
}

export function createEmptyNativeTransferableBuffer(): OccNativeTransferableBuffer {
  return {
    bufferId: 'occ_buffer_empty' as OccNativeBufferRef['bufferId'],
    buffer: emptyBuffer,
  }
}

export function getMissingNativeTopologyKernelEntrypoints(
  host: Partial<Record<OccNativeTopologyKernelEntrypoint, unknown>> | OpenCascadeNativeTopologyKernelHost,
  requiredEntrypoints: readonly OccNativeTopologyKernelEntrypoint[] = OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS,
) {
  return requiredEntrypoints.filter((entrypoint) => typeof host[entrypoint] !== 'function')
}

export function createMissingNativeTopologyKernelDiagnostic(
  missingEntrypoints: readonly OccNativeTopologyKernelEntrypoint[],
): OccNativeTopologyDiagnostic {
  return {
    code: 'occ-native-topology-entrypoint-missing',
    severity: 'error',
    message: `Loaded OpenCascade build is missing native topology kernel entrypoints: ${missingEntrypoints.join(', ')}.`,
    target: null,
    detail: {
      missingEntrypoints: [...missingEntrypoints],
    },
  }
}

export function probeNativeTopologyKernelCapabilities(
  host: Partial<Record<OccNativeTopologyKernelEntrypoint, unknown>> | OpenCascadeNativeTopologyKernelHost,
): OccNativeTopologyCapabilityProbeResult {
  const missingEntrypoints = getMissingNativeTopologyKernelEntrypoints(host)

  return {
    kind: missingEntrypoints.length === 0 ? 'available' : 'missing',
    requiredEntrypoints: OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS,
    missingEntrypoints,
    diagnostics: missingEntrypoints.length === 0
      ? []
      : [createMissingNativeTopologyKernelDiagnostic(missingEntrypoints)],
  }
}

export function createNativeTopologyUnavailableResult() {
  return probeNativeTopologyKernelCapabilities({})
}
