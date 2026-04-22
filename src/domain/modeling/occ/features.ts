import type {
  ConstructionSnapshotRecord,
  ExtrudeEndCondition,
  ExtrudeFeatureParameters,
  FeatureBooleanOperation,
  FeatureBooleanScope,
  FeatureDefinition,
  FilletFeatureParameters,
  PlaneFeatureParameters,
  RevolveEndCondition,
  RevolveFeatureParameters,
  ShellFeatureParameters,
  SketchSnapshotRecord,
  SnapshotEntityRecord,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import { getExtrudeFeatureExtent, getRevolveFeatureExtent } from '@/contracts/modeling/feature-extents'
import type { AdvancedSolidFeatureDefinition } from '@/contracts/modeling/advanced-solid'
import {
  createStepImportDiagnostic,
  createStepSolidKey,
  findExternalStepDocumentNames,
  getStepDocumentBasename,
  type StepImportReviewFileInput,
  type StepImportReviewResolvedSource,
  type StepImportReviewResult,
  type StepImportDiagnosticCode,
  type StepImportFeatureParameters,
  type StepImportSourceAssetReference,
} from '@/contracts/modeling/step-import'
import type { MeshImportDiagnosticCode, MeshImportFeatureParameters } from '@/contracts/modeling/mesh-import'
import type { GeometryAssetHash, GeometryAssetRecord } from '@/contracts/modeling/geometry-assets'
import {
  DEFAULT_MESH_RECONSTRUCTION_SETTINGS,
  type MeshReconstructionProvenance,
  type MeshReconstructionSettings,
  type MeshUnificationDiagnostics,
  type MeshUnificationSurfaceTypeCounts,
} from '@/contracts/modeling/mesh-reconstruction'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { RegionRecord } from '@/contracts/sketch/schema'
import type {
  BodyId,
  ConstructionId,
  FeatureId,
  PickId,
  RenderableId,
  SnapshotEntityId,
} from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'
import { getAuthoredLiteralValue, type MaybeAuthoredValue } from '@/contracts/modeling/authored-values'
import { getAdvancedParticipant } from '@/contracts/modeling/advanced-solid'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import { MESH_IMPORT_FEATURE_SCHEMA_VERSION, RENDER_EXPORT_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import {
  getConstructionBackedRevolveAxisRejectionReason,
  OCC_CONTRACT_GAP_CODES,
  getMultiBodyBooleanPolicy,
} from '@/domain/modeling/occ/implementation-policy'
import type { Vec3 } from '@/domain/modeling/occ/math'
import {
  buildAxisFromLineEdge,
  buildConstructionPlaneFromPlanarFace,
  buildRegionProfileFace,
  getExtrusionNormalForPlanarFace,
  getExtrusionNormalForSketchProfile,
} from '@/domain/modeling/occ/sketch-profile'
import { cross, dot, magnitude, normalize, scale, subtract, toGpDir, toGpPlane, toGpPnt, toGpVec, toVec3FromGpPoint } from '@/domain/modeling/occ/geometry'
import type { OpenCascadeInstance } from '@/domain/modeling/occ/runtime'
import {
  extractSolidShapes,
  getOccDurableRefKey,
  OCC_REFERENCE_INVALIDATION_REASONS,
  reconcileReplacementSolidBody,
  trackNewSolidBody,
  trackReplacementSolidBody,
  type OccTrackedBody,
  type OccReferenceInvalidationRecord,
} from '@/domain/modeling/occ/topology'
import {
  isOccTopologyHistoryDeleted,
  type OccTopologyHistorySource,
} from '@/domain/modeling/occ/topology-naming'
import {
  bakedMeshGeometryToAsciiStl,
  parseBakedMeshGeometry,
} from '@/domain/modeling/baked-mesh-geometry'
import type { MeshPoint } from '@/domain/modeling/mesh-parser'

export interface OccFeatureExecutionContext {
  oc: OpenCascadeInstance
  documentId: `doc_${string}`
  revisionId: `rev_${string}`
  modelingTolerance: number
  sketches: readonly SketchSnapshotRecord[]
  constructions: readonly ConstructionSnapshotRecord[]
  constructionPlanes: ReadonlyMap<ConstructionId, SketchPlaneDefinition>
  bodies: readonly OccTrackedBody[]
  assets: { records: readonly GeometryAssetRecord[] }
  assetBlobs: ReadonlyMap<GeometryAssetHash, Uint8Array>
}

export interface OccFeatureExecutionResult {
  bodies: OccTrackedBody[]
  constructions: ConstructionSnapshotRecord[]
  constructionPlanes: Map<ConstructionId, SketchPlaneDefinition>
  featureDefinition?: FeatureDefinition
  assetRecords?: GeometryAssetRecord[]
  producedTargets: DurableRef[]
  entities: SnapshotEntityRecord[]
  renderRecords: RenderableEntityRecord[]
  historyInvalidations: Map<string, OccReferenceInvalidationRecord>
  diagnostics?: ModelingDiagnostic[]
}

export interface OccFeaturePresentationArtifacts {
  entities: SnapshotEntityRecord[]
  renderRecords: RenderableEntityRecord[]
}

function requireSketchSnapshot(
  context: OccFeatureExecutionContext,
  sketchId: SketchSnapshotRecord['sketchId'],
) {
  const sketch = context.sketches.find((entry) => entry.sketchId === sketchId)

  if (!sketch) {
    throw new Error(`Sketch ${sketchId} does not resolve in the current OCC authoring state.`)
  }

  return sketch
}

function requireRegion(
  sketch: SketchSnapshotRecord,
  regionId: RegionRecord['regionId'],
) {
  const region = sketch.sketch.regions.find((entry) => entry.regionId === regionId)

  if (!region) {
    throw new Error(`Sketch region ${regionId} does not resolve on sketch ${sketch.sketchId}.`)
  }

  return region
}

function requireBody(
  context: OccFeatureExecutionContext,
  bodyId: BodyId,
) {
  const body = context.bodies.find((entry) => entry.bodyId === bodyId)

  if (!body) {
    throw new Error(`Body ${bodyId} does not resolve in the current OCC authoring state.`)
  }

  return body
}

function requireFace(
  body: OccTrackedBody,
  faceId: `face_${string}`,
) {
  const face = body.facesById.get(faceId)

  if (!face) {
    throw new Error(`Face ${faceId} does not resolve on body ${body.bodyId}.`)
  }

  return face
}

function requireEdge(
  body: OccTrackedBody,
  edgeId: `edge_${string}`,
) {
  const edge = body.edgesById.get(edgeId)

  if (!edge) {
    throw new Error(`Edge ${edgeId} does not resolve on body ${body.bodyId}.`)
  }

  return edge
}

function requireVertex(
  body: OccTrackedBody,
  vertexId: `vertex_${string}`,
) {
  const vertex = body.verticesById.get(vertexId)

  if (!vertex) {
    throw new Error(`Vertex ${vertexId} does not resolve on body ${body.bodyId}.`)
  }

  return vertex
}

function requireConstructionPlaneDefinition(
  context: OccFeatureExecutionContext,
  constructionId: ConstructionId,
) {
  const plane = context.constructionPlanes.get(constructionId)

  if (!plane) {
    throw new Error(
      `${OCC_CONTRACT_GAP_CODES.constructionPlaneGeometryUnavailable}: Construction plane ${constructionId} does not expose internal plane geometry.`,
    )
  }

  return plane
}

function createBooleanBuilder(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, 'newBody'>,
  left: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  right: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const progress = new oc.Message_ProgressRange_1()

  switch (operation) {
    case 'join':
      return new oc.BRepAlgoAPI_Fuse_3(left, right, progress)
    case 'cut':
      return new oc.BRepAlgoAPI_Cut_3(left, right, progress)
    case 'intersect':
      return new oc.BRepAlgoAPI_Common_3(left, right, progress)
  }
}

function refineBooleanResultShape(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(shape, true, true, true)
  unifier.AllowInternalEdges(false)
  unifier.SetSafeInputMode(true)
  unifier.SetLinearTolerance(0.001)
  unifier.SetAngularTolerance(0.001)
  unifier.Build()
  const unifiedShape = unifier.Shape()
  const historySource = new oc.BRepTools_History()
  const historyHandle = unifier.History_1()

  if (!historyHandle.IsNull()) {
    historySource.Merge_1(historyHandle)
  }

  historyHandle.delete()
  unifier.delete()

  return {
    shape: unifiedShape,
    historySource,
  }
}

function runBoolean(
  oc: OpenCascadeInstance,
  operation: Exclude<FeatureBooleanOperation, 'newBody'>,
  left: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  right: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const builder = createBooleanBuilder(oc, operation, left, right)
  builder.SetToFillHistory(true)
  builder.Build(new oc.Message_ProgressRange_1())

  if (!builder.IsDone()) {
    throw new Error(`OCC boolean ${operation} failed to build.`)
  }

  builder.SimplifyResult(true, true, 1e-7)

  const refined = refineBooleanResultShape(oc, builder.Shape())

  return {
    shape: refined.shape,
    builder,
    historySources: [builder, refined.historySource] satisfies OccTopologyHistorySource[],
  }
}

function createHistoryTargetForShape(
  target: DurableRef,
  ownerBodyId: BodyId,
) {
  switch (target.kind) {
    case 'face':
    case 'edge':
    case 'vertex':
      return {
        target,
        sourceTarget: { kind: 'body', bodyId: ownerBodyId } as DurableRef,
      }
    default:
      return null
  }
}

function collectTopologyHistoryInvalidations(
  current: OccTrackedBody,
  historySource: OccTopologyHistorySource,
) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const register = (
    target: DurableRef,
    shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  ) => {
    const relation = createHistoryTargetForShape(target, current.bodyId)

    if (!relation) {
      return
    }

    let reason: OccReferenceInvalidationRecord['reason'] = OCC_REFERENCE_INVALIDATION_REASONS.missing

    if (isOccTopologyHistoryDeleted(historySource, shape)) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted
    } else if (
      historySource.Modified(shape).Size() > 0
      || historySource.Generated(shape).Size() > 0
    ) {
      reason = OCC_REFERENCE_INVALIDATION_REASONS.topologyModified
    }

    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason,
      sourceTarget: relation.sourceTarget,
    })
  }

  for (const [faceId, face] of current.facesById.entries()) {
    register({ kind: 'face', bodyId: current.bodyId, faceId }, face)
  }

  for (const [edgeId, edge] of current.edgesById.entries()) {
    register({ kind: 'edge', bodyId: current.bodyId, edgeId }, edge)
  }

  for (const [vertexId, vertex] of current.verticesById.entries()) {
    register({ kind: 'vertex', bodyId: current.bodyId, vertexId }, vertex)
  }

  return invalidations
}

function resolveReplacementBodies(
  context: OccFeatureExecutionContext,
  bodyId: BodyId,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  ownerFeatureId: FeatureId,
  options: {
    allowEmpty: boolean
    historySource?: OccTopologyHistorySource
    historySources?: readonly OccTopologyHistorySource[]
  },
) {
  const current = requireBody(context, bodyId)
  const solids = extractSolidShapes(context.oc, shape)
  const historySources = options.historySources ?? (options.historySource ? [options.historySource] : [])
  const invalidationHistorySource = options.historySource
    ?? historySources.find((historySource) =>
      typeof historySource.IsDeleted === 'function' || typeof historySource.IsRemoved === 'function',
    )
  let historyInvalidations = invalidationHistorySource
    ? collectTopologyHistoryInvalidations(current, invalidationHistorySource)
    : new Map<string, OccReferenceInvalidationRecord>()

  if (solids.length === 0) {
    if (options.allowEmpty) {
      return {
        replacements: [] as OccTrackedBody[],
        historyInvalidations,
      }
    }

    throw new Error(
      `Feature ${ownerFeatureId} removed every solid while replacing body ${bodyId}; Phase 4 expected one solid result.`,
    )
  }

  if (solids.length !== 1) {
    throw new Error(
      `Feature ${ownerFeatureId} produced ${solids.length} solids while replacing body ${bodyId}; single-body replacement is required in Phase 4.`,
    )
  }

  const replacement = historySources.length > 0
    ? reconcileReplacementSolidBody(context.oc, {
        previous: current,
        ownerFeatureId,
        shape: solids[0]!,
        historySources,
      })
    : {
        body: trackReplacementSolidBody(context.oc, {
          previous: current,
          ownerFeatureId,
          shape: solids[0]!,
        }),
        historyInvalidations,
      }

  historyInvalidations = replacement.historyInvalidations

  return {
    replacements: [replacement.body],
    historyInvalidations,
  }
}

function allocateBodyId(featureId: FeatureId) {
  return `body_${featureId}` as BodyId
}

function trackSingleResultBody(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const solids = extractSolidShapes(context.oc, shape)

  if (solids.length !== 1) {
    throw new Error(
      `Feature ${ownerFeatureId} produced ${solids.length} solids; Phase 4 only accepts single-solid body results.`,
    )
  }

  const bodyId = allocateBodyId(ownerFeatureId)
  return trackNewSolidBody(context.oc, {
    bodyId,
    label,
    ownerFeatureId,
    shape: solids[0]!,
  })
}

function trackNewBodyResults(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const solids = extractSolidShapes(context.oc, shape)

  if (solids.length === 1) {
    return [trackSingleResultBody(context, ownerFeatureId, label, shape)]
  }

  if (solids.length === 0) {
    throw new Error(
      `Feature ${ownerFeatureId} produced 0 solids; Phase 4 only accepts solid body results.`,
    )
  }

  return solids.map((solid, index) => trackNewSolidBody(context.oc, {
    bodyId: `body_${ownerFeatureId}_${index + 1}` as BodyId,
    label: `${label}_${index + 1}`,
    ownerFeatureId,
    shape: solid,
  }))
}

function isOccDoneStatus(status: unknown) {
  return typeof status === 'object'
    && status !== null
    && 'value' in status
    && (status as { value: unknown }).value === 1
}

function createStepImportErrorCode(
  code: StepImportDiagnosticCode,
  message: string,
  detail: {
    documentName?: string
    selectedFileName?: string
    solidKey?: string
  } = {},
) {
  const error = new Error(`${code}: ${message}`) as Error & {
    code: StepImportDiagnosticCode
    documentName?: string
    selectedFileName?: string
    solidKey?: string
  }
  error.code = code
  error.documentName = detail.documentName
  error.selectedFileName = detail.selectedFileName
  error.solidKey = detail.solidKey
  return error
}

function createMeshImportErrorCode(code: MeshImportDiagnosticCode, message: string) {
  const error = new Error(`${code}: ${message}`) as Error & { code: MeshImportDiagnosticCode }
  error.code = code
  return error
}

function createTempStepImportPath(asset: GeometryAssetRecord) {
  return `/cadara-import-${asset.assetId}-${asset.hash.replace(/^sha256:/, '').slice(0, 12)}.step`
}

function escapeStepString(value: string) {
  return value.replaceAll("'", "''")
}

function createTempStepImportPathForDocument(rootKey: string, documentName: string) {
  const safeName = getStepDocumentBasename(documentName).replace(/[^a-z0-9._-]/gi, '_') || 'source.step'
  return `/cadara-import-${rootKey}-${safeName}`
}

function rewriteStepDocumentReferences(
  bytes: Uint8Array,
  documentPathByName: ReadonlyMap<string, string>,
) {
  if (documentPathByName.size === 0) {
    return bytes
  }

  const text = new TextDecoder().decode(bytes)
  const rewritten = text.replace(
    /DOCUMENT_FILE\s*\(\s*'((?:[^']|'')*)'/gi,
    (match, encodedName: string) => {
      const name = encodedName.replaceAll("''", "'").trim()
      const replacement = documentPathByName.get(getStepDocumentBasename(name))
      return replacement ? match.replace(`'${encodedName}'`, `'${escapeStepString(replacement)}'`) : match
    },
  )

  return new TextEncoder().encode(rewritten)
}

function createTempMeshImportPath(asset: GeometryAssetRecord) {
  return `/cadara-import-${asset.assetId}-${asset.hash.replace(/^sha256:/, '').slice(0, 12)}.stl`
}

function removeTempImportPath(oc: OpenCascadeInstance, path: string) {
  if (oc.FS.analyzePath(path).exists) {
    oc.FS.unlink(path)
  }
}

function findStepImportAsset(
  context: OccFeatureExecutionContext,
  parameters: StepImportFeatureParameters,
) {
  return context.assets.records.find((asset) => asset.assetId === parameters.assetId && asset.format === 'step') ?? null
}

function findMeshImportAsset(
  context: OccFeatureExecutionContext,
  parameters: MeshImportFeatureParameters,
) {
  return context.assets.records.find((asset) => asset.assetId === parameters.assetId && asset.format === 'baked-mesh') ?? null
}

function transferStepImportRoots(
  reader: InstanceType<OpenCascadeInstance['STEPControl_Reader_1']>,
  progress: InstanceType<OpenCascadeInstance['Message_ProgressRange_1']>,
) {
  const rootCount = reader.NbRootsForTransfer()
  let transferredRoots = 0

  for (let rootIndex = 1; rootIndex <= rootCount; rootIndex += 1) {
    if (reader.TransferRoot(rootIndex, progress)) {
      transferredRoots += 1
    }
  }

  if (reader.NbShapes() > 0) {
    return transferredRoots
  }

  reader.ClearShapes()
  return reader.TransferRoots(progress)
}

function formatExternalStepDocumentNames(names: readonly string[]) {
  const visibleNames = names.slice(0, 3).join(', ')
  const remainingCount = names.length - 3

  return remainingCount > 0
    ? `${visibleNames}, and ${remainingCount} more`
    : visibleNames
}

function createDefaultStepSolidLabel(documentName: string, solidOrdinal: number, solidCount: number) {
  const baseName = documentName.split(/[\\/]/).pop()?.replace(/\.(?:step|stp)$/i, '').trim()
  const labelBase = baseName && baseName.length > 0 ? baseName : 'STEP Solid'
  return solidCount === 1 ? labelBase : `${labelBase} ${solidOrdinal}`
}

function resolveReviewStepFiles(files: readonly StepImportReviewFileInput[]) {
  const rootFile = files[0] ?? null
  const diagnostics: ModelingDiagnostic[] = []
  if (!rootFile) {
    diagnostics.push(createStepImportDiagnostic(
      'step-import-empty-selection',
      'Select at least one STEP file to import.',
    ))
    return { rootFile, referencedDocumentNames: [], resolvedSources: [], diagnostics }
  }

  const referencedDocumentNames = findExternalStepDocumentNames(rootFile.bytes)
  const resolvedSources: StepImportReviewResolvedSource[] = [
    {
      role: 'root',
      fileName: rootFile.fileName,
      documentName: rootFile.fileName,
    },
  ]

  for (const documentName of referencedDocumentNames) {
    const basename = getStepDocumentBasename(documentName)
    const matches = files.slice(1).filter((file) => getStepDocumentBasename(file.fileName) === basename)
    if (matches.length === 0) {
      diagnostics.push(createStepImportDiagnostic(
        'step-import-missing-reference',
        `STEP reference ${documentName} was not included in the selected files.`,
        { documentName, severity: 'warning' },
      ))
      continue
    }
    if (matches.length > 1) {
      diagnostics.push(createStepImportDiagnostic(
        'step-import-ambiguous-reference',
        `STEP reference ${documentName} matches multiple selected files.`,
        { documentName },
      ))
      continue
    }

    resolvedSources.push({
      role: 'referenced',
      fileName: matches[0]!.fileName,
      documentName,
    })
  }

  return {
    rootFile,
    referencedDocumentNames,
    resolvedSources,
    diagnostics,
  }
}

export function prepareStepImportReviewWithOpenCascade(
  oc: OpenCascadeInstance,
  files: readonly StepImportReviewFileInput[],
): StepImportReviewResult {
  const resolved = resolveReviewStepFiles(files)
  if (!resolved.rootFile || resolved.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return {
      rootFileName: resolved.rootFile?.fileName ?? '',
      referencedDocumentNames: resolved.referencedDocumentNames,
      resolvedSources: resolved.resolvedSources,
      solids: [],
      diagnostics: resolved.diagnostics,
    }
  }

  const rootKey = `review-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  const pathByFileName = new Map<string, string>()
  const pathByDocumentName = new Map<string, string>()
  const writtenPaths: string[] = []
  for (const source of resolved.resolvedSources) {
    const path = createTempStepImportPathForDocument(rootKey, source.documentName)
    pathByFileName.set(source.fileName, path)
    pathByDocumentName.set(getStepDocumentBasename(source.documentName), path)
  }

  const reader = new oc.STEPControl_Reader_1()
  const progress = new oc.Message_ProgressRange_1()
  try {
    for (const source of resolved.resolvedSources) {
      const file = files.find((entry) => entry.fileName === source.fileName)
      const path = pathByFileName.get(source.fileName)
      if (!file || !path) {
        continue
      }
      const bytes = source.role === 'root'
        ? rewriteStepDocumentReferences(file.bytes, pathByDocumentName)
        : file.bytes
      oc.FS.writeFile(path, bytes)
      writtenPaths.push(path)
    }

    const rootPath = pathByFileName.get(resolved.rootFile.fileName)
    if (!rootPath) {
      throw new Error('STEP review root path was not prepared.')
    }

    const readStatus = reader.ReadFile(rootPath)
    if (!isOccDoneStatus(readStatus)) {
      return {
        rootFileName: resolved.rootFile.fileName,
        referencedDocumentNames: resolved.referencedDocumentNames,
        resolvedSources: resolved.resolvedSources,
        solids: [],
        diagnostics: [
          ...resolved.diagnostics,
          createStepImportDiagnostic(
            'step-import-unreadable-file',
            `STEP file ${resolved.rootFile.fileName} could not be read.`,
            { sourceName: resolved.rootFile.fileName },
          ),
        ],
      }
    }

    const transferredRoots = transferStepImportRoots(reader, progress)
    if (transferredRoots <= 0 || reader.NbShapes() <= 0) {
      return {
        rootFileName: resolved.rootFile.fileName,
        referencedDocumentNames: resolved.referencedDocumentNames,
        resolvedSources: resolved.resolvedSources,
        solids: [],
        diagnostics: [
          ...resolved.diagnostics,
          createStepImportDiagnostic(
            'step-import-unsupported-structure',
            `STEP file ${resolved.rootFile.fileName} contains no transferable shape roots.`,
            { sourceName: resolved.rootFile.fileName },
          ),
        ],
      }
    }

    const shape = reader.OneShape()
    const solids = extractSolidShapes(oc, shape)
    return {
      rootFileName: resolved.rootFile.fileName,
      referencedDocumentNames: resolved.referencedDocumentNames,
      resolvedSources: resolved.resolvedSources,
      solids: solids.map((_solid, index) => {
        const solidOrdinal = index + 1
        return {
          solidKey: createStepSolidKey({
            documentName: resolved.rootFile!.fileName,
            solidOrdinal,
          }),
          label: createDefaultStepSolidLabel(resolved.rootFile!.fileName, solidOrdinal, solids.length),
          sourceFileName: resolved.rootFile!.fileName,
          documentName: resolved.rootFile!.fileName,
          importable: true,
        }
      }),
      diagnostics: solids.length === 0
        ? [
            ...resolved.diagnostics,
            createStepImportDiagnostic(
              'step-import-no-solids',
              `STEP file ${resolved.rootFile.fileName} does not contain supported solid bodies.`,
              { sourceName: resolved.rootFile.fileName },
            ),
          ]
        : resolved.diagnostics,
    }
  } finally {
    for (const path of writtenPaths) {
      removeTempImportPath(oc, path)
    }
    reader.delete()
  }
}

function readStepImportShape(
  context: OccFeatureExecutionContext,
  asset: GeometryAssetRecord,
  parameters: StepImportFeatureParameters,
) {
  const bytes = context.assetBlobs.get(asset.hash)
  if (!bytes) {
    throw createStepImportErrorCode('step-import-missing-asset', `STEP asset ${asset.assetId} bytes are missing.`)
  }

  const oc = context.oc
  const sourceFiles = parameters.sourceFiles
  const rootSource = sourceFiles?.find((source) => source.role === 'root' && source.assetId === asset.assetId)
  const rootDocumentName = rootSource?.documentName ?? asset.provenance.stepDocumentName ?? asset.provenance.sourceName ?? `${asset.assetId}.step`
  const path = sourceFiles
    ? createTempStepImportPathForDocument(`${asset.assetId}-${asset.hash.replace(/^sha256:/, '').slice(0, 12)}`, rootDocumentName)
    : createTempStepImportPath(asset)
  const reader = new oc.STEPControl_Reader_1()
  const progress = new oc.Message_ProgressRange_1()
  const writtenPaths: string[] = []

  try {
    if (sourceFiles) {
      const documentPathByName = new Map<string, string>()
      const sourceAssetById = new Map(context.assets.records.map((sourceAsset) => [sourceAsset.assetId, sourceAsset]))
      const resolvedSources: Array<{
        source: StepImportSourceAssetReference
        asset: GeometryAssetRecord
        bytes: Uint8Array
        path: string
      }> = []

      for (const source of sourceFiles) {
        const sourceAsset = sourceAssetById.get(source.assetId)
        if (!sourceAsset || sourceAsset.format !== 'step') {
          throw createStepImportErrorCode(
            'step-import-missing-reference',
            `STEP reference ${source.documentName} is not in the authored document manifest.`,
          )
        }
        const sourceBytes = context.assetBlobs.get(sourceAsset.hash)
        if (!sourceBytes) {
          throw createStepImportErrorCode(
            source.role === 'root' ? 'step-import-missing-asset' : 'step-import-unreadable-referenced-file',
            `STEP reference ${source.documentName} bytes are missing.`,
          )
        }

        const sourcePath = source.role === 'root'
          ? path
          : createTempStepImportPathForDocument(`${asset.assetId}-${asset.hash.replace(/^sha256:/, '').slice(0, 12)}`, source.documentName)
        documentPathByName.set(getStepDocumentBasename(source.documentName), sourcePath)
        resolvedSources.push({ source, asset: sourceAsset, bytes: sourceBytes, path: sourcePath })
      }

      for (const resolved of resolvedSources) {
        const nextBytes = resolved.source.role === 'root'
          ? rewriteStepDocumentReferences(resolved.bytes, documentPathByName)
          : resolved.bytes
        oc.FS.writeFile(resolved.path, nextBytes)
        writtenPaths.push(resolved.path)
      }
    } else {
      oc.FS.writeFile(path, bytes)
      writtenPaths.push(path)
    }

    const readStatus = reader.ReadFile(path)
    if (!isOccDoneStatus(readStatus)) {
      throw createStepImportErrorCode('step-import-unreadable-file', `STEP asset ${asset.assetId} could not be read.`)
    }

    const transferredRoots = transferStepImportRoots(reader, progress)
    if (transferredRoots <= 0 || reader.NbShapes() <= 0) {
      throw createStepImportErrorCode('step-import-unsupported-structure', `STEP asset ${asset.assetId} contains no transferable shape roots.`)
    }

    return {
      shape: reader.OneShape(),
      topLevelShapeCount: reader.NbShapes(),
      externalDocumentNames: findExternalStepDocumentNames(bytes),
      rootDocumentName,
    }
  } finally {
    for (const writtenPath of writtenPaths) {
      removeTempImportPath(oc, writtenPath)
    }
    reader.delete()
  }
}

function transformShape(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  transform: InstanceType<OpenCascadeInstance['gp_Trsf']>,
  failureMessage: string,
) {
  const builder = new context.oc.BRepBuilderAPI_Transform_2(shape, transform, true)
  builder.Build(new context.oc.Message_ProgressRange_1())

  if (!builder.IsDone()) {
    throw createStepImportErrorCode('step-import-unsupported-structure', failureMessage)
  }

  return builder.Shape()
}

function rotationAxis(
  context: OccFeatureExecutionContext,
  direction: Vec3,
) {
  return new context.oc.gp_Ax1_2(toGpPnt(context.oc, [0, 0, 0]), toGpDir(context.oc, direction))
}

function applyStepImportTransforms(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  parameters: StepImportFeatureParameters,
) {
  let transformed = shape
  const scaleFactor = parameters.unit.scaleToDocument * parameters.placement.scale

  if (scaleFactor !== 1) {
    const scaleTransform = new context.oc.gp_Trsf_1()
    scaleTransform.SetScale(toGpPnt(context.oc, [0, 0, 0]), scaleFactor)
    transformed = transformShape(context, transformed, scaleTransform, 'STEP import scale transform failed.')
  }

  if (parameters.orientation.upAxis === 'y') {
    const upAxisTransform = new context.oc.gp_Trsf_1()
    upAxisTransform.SetRotation_1(rotationAxis(context, [1, 0, 0]), Math.PI / 2)
    transformed = transformShape(context, transformed, upAxisTransform, 'STEP import up-axis transform failed.')
  }

  const [rx, ry, rz] = parameters.placement.rotationEulerRadians
  const rotations: Array<[number, Vec3]> = [
    [rx, [1, 0, 0]],
    [ry, [0, 1, 0]],
    [rz, [0, 0, 1]],
  ]
  for (const [angle, axis] of rotations) {
    if (angle === 0) {
      continue
    }
    const rotation = new context.oc.gp_Trsf_1()
    rotation.SetRotation_1(rotationAxis(context, axis), angle)
    transformed = transformShape(context, transformed, rotation, 'STEP import placement rotation failed.')
  }

  if (parameters.placement.translation.some((component) => component !== 0)) {
    const translation = new context.oc.gp_Trsf_1()
    translation.SetTranslation_1(toGpVec(context.oc, [...parameters.placement.translation] as Vec3))
    transformed = transformShape(context, transformed, translation, 'STEP import placement translation failed.')
  }

  return transformed
}

function countUnsupportedStepShapes(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
): number {
  if ((shape.ShapeType() as unknown as number) === (oc.TopAbs_ShapeEnum.TopAbs_SOLID as unknown as number)) {
    return 0
  }

  const iterator = new oc.TopoDS_Iterator_2(shape, false, false)
  let childCount = 0
  let unsupportedCount = 0
  try {
    while (iterator.More()) {
      childCount += 1
      unsupportedCount += countUnsupportedStepShapes(oc, iterator.Value())
      iterator.Next()
    }
  } finally {
    iterator.delete()
  }

  return childCount === 0 ? 1 : unsupportedCount
}

function createEmptyMeshSurfaceCounts(): MeshUnificationSurfaceTypeCounts {
  return {
    plane: 0,
    cylinder: 0,
    cone: 0,
    sphere: 0,
    torus: 0,
  }
}

function getMeshSurfaceTypeKey(
  oc: OpenCascadeInstance,
  face: InstanceType<OpenCascadeInstance['TopoDS_Face']>,
): keyof MeshUnificationSurfaceTypeCounts | null {
  const surface = new oc.BRepAdaptor_Surface_2(face, true)
  try {
    const surfaceType = surface.GetType() as unknown as number
    if (surfaceType === (oc.GeomAbs_SurfaceType.GeomAbs_Plane as unknown as number)) {
      return 'plane'
    }
    if (surfaceType === (oc.GeomAbs_SurfaceType.GeomAbs_Cylinder as unknown as number)) {
      return 'cylinder'
    }
    if (surfaceType === (oc.GeomAbs_SurfaceType.GeomAbs_Cone as unknown as number)) {
      return 'cone'
    }
    if (surfaceType === (oc.GeomAbs_SurfaceType.GeomAbs_Sphere as unknown as number)) {
      return 'sphere'
    }
    if (surfaceType === (oc.GeomAbs_SurfaceType.GeomAbs_Torus as unknown as number)) {
      return 'torus'
    }
    return null
  } finally {
    surface.delete()
  }
}

function summarizeMeshSolidFaces(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const faceMap = new oc.TopTools_IndexedMapOfShape_1()
  const mergedSurfaceTypes = createEmptyMeshSurfaceCounts()
  try {
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, faceMap)
    for (let index = 1; index <= faceMap.Size(); index += 1) {
      const face = oc.TopoDS.Face_1(faceMap.FindKey(index))
      const surfaceType = getMeshSurfaceTypeKey(oc, face)
      if (surfaceType) {
        mergedSurfaceTypes[surfaceType] += 1
      }
    }

    return {
      faceCount: faceMap.Size(),
      mergedSurfaceTypes,
    }
  } finally {
    faceMap.delete()
  }
}

type BakedMeshPayloadForOcc = {
  vertices: readonly MeshPoint[]
  indices: ReadonlyArray<readonly [number, number, number]>
}

const MESH_SAME_DOMAIN_UNIFICATION_TRIANGLE_LIMIT = 5_000

function findAnalyticCylinderCandidate(
  payload: BakedMeshPayloadForOcc,
  tolerance: number,
) {
  let best: {
    axis: 0 | 1 | 2
    center: readonly [number, number]
    minAxis: number
    height: number
    radius: number
    sideTriangleCount: number
  } | null = null

  for (const axis of [0, 1, 2] as const) {
    const radialAxes = [0, 1, 2].filter((index) => index !== axis) as [number, number]
    const axisValues = payload.vertices.map((vertex) => vertex[axis])
    const minAxis = Math.min(...axisValues)
    const maxAxis = Math.max(...axisValues)
    const height = maxAxis - minAxis
    const sideTriangleIndexes: number[] = []
    let minCapTriangleCount = 0
    let maxCapTriangleCount = 0

    for (const [triangleIndex, triangle] of payload.indices.entries()) {
      const vertices = triangle.map((index) => payload.vertices[index]!)
      const onMinCap = vertices.every((vertex) => Math.abs(vertex[axis] - minAxis) <= tolerance)
      const onMaxCap = vertices.every((vertex) => Math.abs(vertex[axis] - maxAxis) <= tolerance)
      if (onMinCap) {
        minCapTriangleCount += 1
      } else if (onMaxCap) {
        maxCapTriangleCount += 1
      } else {
        sideTriangleIndexes.push(triangleIndex)
      }
    }

    if (
      height <= tolerance
      || sideTriangleIndexes.length < 8
      || minCapTriangleCount === 0
      || maxCapTriangleCount === 0
    ) {
      continue
    }

    const sideVertices = uniqueMeshTriangleVertices(payload, sideTriangleIndexes)
    const center = [
      averageMeshValues(sideVertices.map((vertex) => vertex[radialAxes[0]])),
      averageMeshValues(sideVertices.map((vertex) => vertex[radialAxes[1]])),
    ] as const
    const radii = sideVertices.map((vertex) =>
      Math.hypot(vertex[radialAxes[0]] - center[0], vertex[radialAxes[1]] - center[1]),
    )
    const radius = averageMeshValues(radii)
    const maxDeviation = Math.max(...radii.map((value) => Math.abs(value - radius)))
    const angularBins = new Set(sideVertices.map((vertex) => {
      const angle = Math.atan2(vertex[radialAxes[1]] - center[1], vertex[radialAxes[0]] - center[0])
      return Math.round(angle / (Math.PI / 16))
    }))

    if (radius <= tolerance || maxDeviation > tolerance || angularBins.size < 8) {
      continue
    }

    if (!best || sideTriangleIndexes.length > best.sideTriangleCount) {
      best = {
        axis,
        center,
        minAxis,
        height,
        radius,
        sideTriangleCount: sideTriangleIndexes.length,
      }
    }
  }

  return best
}

function uniqueMeshTriangleVertices(payload: BakedMeshPayloadForOcc, triangleIndexes: readonly number[]) {
  const vertexIndexes = new Set<number>()
  for (const triangleIndex of triangleIndexes) {
    for (const vertexIndex of payload.indices[triangleIndex]!) {
      vertexIndexes.add(vertexIndex)
    }
  }
  return [...vertexIndexes].map((index) => payload.vertices[index]!)
}

function averageMeshValues(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function analyticCylinderLocation(candidate: NonNullable<ReturnType<typeof findAnalyticCylinderCandidate>>): Vec3 {
  switch (candidate.axis) {
    case 0:
      return [candidate.minAxis, candidate.center[0], candidate.center[1]]
    case 1:
      return [candidate.center[0], candidate.minAxis, candidate.center[1]]
    case 2:
      return [candidate.center[0], candidate.center[1], candidate.minAxis]
  }
}

function analyticCylinderDirection(axis: 0 | 1 | 2): Vec3 {
  switch (axis) {
    case 0:
      return [1, 0, 0]
    case 1:
      return [0, 1, 0]
    case 2:
      return [0, 0, 1]
  }
}

function tryBuildAnalyticCylinderMeshSolid(
  oc: OpenCascadeInstance,
  payload: BakedMeshPayloadForOcc,
  settings: MeshReconstructionSettings = DEFAULT_MESH_RECONSTRUCTION_SETTINGS,
) {
  const tolerance = settings.unificationLinearTolerance ?? 0.01
  const candidate = findAnalyticCylinderCandidate(payload, tolerance)
  if (!candidate) {
    return null
  }

  const axes = new oc.gp_Ax2_3(
    toGpPnt(oc, analyticCylinderLocation(candidate)),
    toGpDir(oc, analyticCylinderDirection(candidate.axis)),
  )
  const builder = new oc.BRepPrimAPI_MakeCylinder_3(axes, candidate.radius, candidate.height)
  builder.Build(new oc.Message_ProgressRange_1())
  const solid = builder.Solid()
  const summary = summarizeMeshSolidFaces(oc, solid)

  return {
    solid,
    diagnostics: {
      preFaceCount: payload.indices.length,
      postFaceCount: summary.faceCount,
      mergedSurfaceTypes: summary.mergedSurfaceTypes,
    } satisfies MeshUnificationDiagnostics,
  }
}

function unifyMeshSolidFaces(
  oc: OpenCascadeInstance,
  solid: InstanceType<OpenCascadeInstance['TopoDS_Solid']>,
  settings: MeshReconstructionSettings = DEFAULT_MESH_RECONSTRUCTION_SETTINGS,
) {
  const preFaceCount = summarizeMeshSolidFaces(oc, solid).faceCount
  const unifier = new oc.ShapeUpgrade_UnifySameDomain_2(solid, true, true, true)
  unifier.AllowInternalEdges(false)
  unifier.SetSafeInputMode(true)
  unifier.SetLinearTolerance(settings.unificationLinearTolerance ?? 0.01)
  unifier.SetAngularTolerance(settings.unificationAngularTolerance ?? 0.01)
  unifier.Build()

  const unifiedShape = unifier.Shape()
  const unifiedSolids = extractSolidShapes(oc, unifiedShape)
  unifier.delete()

  if (unifiedSolids.length !== 1) {
    throw createMeshImportErrorCode(
      'mesh-import-conversion-failed',
      `Baked mesh unification produced ${unifiedSolids.length} solids instead of one.`,
    )
  }

  const unifiedSolid = unifiedSolids[0]!
  const postSummary = summarizeMeshSolidFaces(oc, unifiedSolid)

  return {
    solid: unifiedSolid,
    diagnostics: {
      preFaceCount,
      postFaceCount: postSummary.faceCount,
      mergedSurfaceTypes: postSummary.mergedSurfaceTypes,
    } satisfies MeshUnificationDiagnostics,
  }
}

function summarizeMeshSolidWithoutSameDomainUnification(
  oc: OpenCascadeInstance,
  solid: InstanceType<OpenCascadeInstance['TopoDS_Solid']>,
  sourceTriangleCount: number,
) {
  const summary = summarizeMeshSolidFaces(oc, solid)

  return {
    solid,
    diagnostics: {
      preFaceCount: sourceTriangleCount,
      postFaceCount: summary.faceCount,
      mergedSurfaceTypes: summary.mergedSurfaceTypes,
    } satisfies MeshUnificationDiagnostics,
  }
}

function shouldRunSameDomainMeshUnification(
  payload: BakedMeshPayloadForOcc,
  reconstruction?: MeshReconstructionProvenance,
) {
  if (reconstruction?.resultClassification === 'facetedFallback') {
    return false
  }

  return payload.indices.length <= MESH_SAME_DOMAIN_UNIFICATION_TRIANGLE_LIMIT
}

function executeStepImportFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: StepImportFeatureParameters,
): OccFeatureExecutionResult {
  const asset = findStepImportAsset(context, parameters)
  if (!asset) {
    throw createStepImportErrorCode('step-import-missing-asset', `STEP import asset ${parameters.assetId} is not in the authored document manifest.`)
  }

  const imported = readStepImportShape(context, asset, parameters)
  const solids = extractSolidShapes(context.oc, imported.shape)
  if (solids.length === 0) {
    if (imported.externalDocumentNames.length > 0) {
      throw createStepImportErrorCode(
        'step-import-no-solids',
        `STEP asset ${asset.assetId} references external STEP files (${formatExternalStepDocumentNames(imported.externalDocumentNames)}) but contains no embedded solid bodies.`,
      )
    }

    throw createStepImportErrorCode('step-import-no-solids', `STEP asset ${asset.assetId} does not contain supported solid bodies.`)
  }

  const discoveredSolids = solids.map((solid, index) => {
    const solidOrdinal = index + 1
    return {
      solid,
      solidKey: createStepSolidKey({
        documentName: imported.rootDocumentName,
        solidOrdinal,
      }),
      label: createDefaultStepSolidLabel(imported.rootDocumentName, solidOrdinal, solids.length),
    }
  })

  const selectedByKey = new Map(parameters.selectedSolids?.map((solid) => [solid.solidKey, solid]) ?? [])
  const solidsToImport = parameters.selectedSolids
    ? discoveredSolids.filter((solid) => selectedByKey.has(solid.solidKey))
    : discoveredSolids

  if (parameters.selectedSolids && parameters.selectedSolids.length === 0) {
    throw createStepImportErrorCode(
      'step-import-empty-selection',
      'STEP import cannot commit an empty solid selection.',
    )
  }

  if (parameters.selectedSolids) {
    const discoveredKeys = new Set(discoveredSolids.map((solid) => solid.solidKey))
    const missingSelection = parameters.selectedSolids.find((solid) => !discoveredKeys.has(solid.solidKey))
    if (missingSelection) {
      throw createStepImportErrorCode(
        'step-import-stale-selected-solid',
        `STEP selected solid ${missingSelection.solidKey} is no longer present.`,
        { solidKey: missingSelection.solidKey },
      )
    }
  }

  const bodies = solidsToImport.map((entry, index) => {
    const selected = selectedByKey.get(entry.solidKey)
    const transformed = applyStepImportTransforms(context, entry.solid, parameters)
    const bodyId = solidsToImport.length === 1
      ? `body_${ownerFeatureId}` as BodyId
      : `body_${ownerFeatureId}_${index + 1}` as BodyId
    const label = selected?.label ?? (solidsToImport.length === 1 ? parameters.label : `${parameters.label} ${index + 1}`)

    return trackNewSolidBody(context.oc, {
      bodyId,
      label,
      ownerFeatureId,
      shape: transformed,
    })
  })
  const skippedUnsupportedCount = countUnsupportedStepShapes(context.oc, imported.shape)

  return {
    bodies: [...context.bodies, ...bodies],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: bodies.map((body) => ({ kind: 'body' as const, bodyId: body.bodyId })),
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map(),
    diagnostics: skippedUnsupportedCount > 0
      ? [
          createStepImportDiagnostic(
            'step-import-unsupported-structure',
            `STEP import skipped ${skippedUnsupportedCount} unsupported non-solid shape${skippedUnsupportedCount === 1 ? '' : 's'}.`,
            { asset, skippedUnsupportedCount, severity: 'warning' },
          ),
        ]
      : [],
  }
}

function readBakedMeshImportSolid(
  context: OccFeatureExecutionContext,
  asset: GeometryAssetRecord,
  label: string,
  reconstruction?: MeshReconstructionProvenance,
) {
  const bytes = context.assetBlobs.get(asset.hash)
  if (!bytes) {
    throw createMeshImportErrorCode('mesh-import-missing-baked-asset', `Baked mesh asset ${asset.assetId} bytes are missing.`)
  }

  const oc = context.oc
  const path = createTempMeshImportPath(asset)
  const shape = new oc.TopoDS_Shape()

  try {
    const payload = parseBakedMeshGeometry(bytes)
    const settings = reconstruction?.settings ?? DEFAULT_MESH_RECONSTRUCTION_SETTINGS
    const shouldRunUnification = shouldRunSameDomainMeshUnification(payload, reconstruction)
    const analyticCylinder = tryBuildAnalyticCylinderMeshSolid(oc, payload, settings)
    if (analyticCylinder) {
      return analyticCylinder
    }

    oc.FS.writeFile(path, new TextEncoder().encode(bakedMeshGeometryToAsciiStl(payload, label)))

    if (!oc.StlAPI.Read(shape, path)) {
      throw createMeshImportErrorCode('mesh-import-conversion-failed', `Baked mesh asset ${asset.assetId} could not be read.`)
    }

    const solids = extractSolidShapes(oc, shape)
    if (solids.length === 1) {
      return shouldRunUnification
        ? unifyMeshSolidFaces(oc, solids[0]!, settings)
        : summarizeMeshSolidWithoutSameDomainUnification(oc, solids[0]!, payload.indices.length)
    }

    if ((shape.ShapeType() as unknown as number) !== (oc.TopAbs_ShapeEnum.TopAbs_SHELL as unknown as number)) {
      throw createMeshImportErrorCode('mesh-import-conversion-failed', `Baked mesh asset ${asset.assetId} did not restore as a closed shell.`)
    }

    const solidBuilder = new oc.BRepBuilderAPI_MakeSolid_3(oc.TopoDS.Shell_1(shape))
    if (!solidBuilder.IsDone()) {
      throw createMeshImportErrorCode('mesh-import-conversion-failed', `Baked mesh asset ${asset.assetId} could not be converted to a durable solid.`)
    }

    const solid = solidBuilder.Solid()
    return shouldRunUnification
      ? unifyMeshSolidFaces(oc, solid, settings)
      : summarizeMeshSolidWithoutSameDomainUnification(oc, solid, payload.indices.length)
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'Baked mesh geometry could not be restored.'
    throw createMeshImportErrorCode('mesh-import-conversion-failed', message)
  } finally {
    removeTempImportPath(oc, path)
  }
}

function withMeshUnificationDiagnostics(
  reconstruction: MeshReconstructionProvenance | undefined,
  diagnostics: MeshUnificationDiagnostics,
) {
  return reconstruction
    ? {
        ...reconstruction,
        settings: {
          ...reconstruction.settings,
          unificationLinearTolerance: reconstruction.settings.unificationLinearTolerance ?? 0.01,
          unificationAngularTolerance: reconstruction.settings.unificationAngularTolerance ?? 0.01,
        },
        unificationDiagnostics: diagnostics,
      }
    : undefined
}

function updateMeshImportAssetProvenance(
  asset: GeometryAssetRecord,
  diagnostics: MeshUnificationDiagnostics,
) {
  const reconstruction = withMeshUnificationDiagnostics(asset.provenance.reconstruction, diagnostics)
  if (!reconstruction) {
    return asset
  }

  return {
    ...asset,
    provenance: {
      ...asset.provenance,
      reconstruction,
    },
  }
}

function executeMeshImportFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: MeshImportFeatureParameters,
): OccFeatureExecutionResult {
  const asset = findMeshImportAsset(context, parameters)
  if (!asset) {
    throw createMeshImportErrorCode('mesh-import-missing-baked-asset', `Mesh import asset ${parameters.assetId} is not in the authored document manifest.`)
  }

  const restored = readBakedMeshImportSolid(context, asset, parameters.label, parameters.reconstruction)
  const reconstruction = withMeshUnificationDiagnostics(parameters.reconstruction, restored.diagnostics)
  const body = trackNewSolidBody(context.oc, {
    bodyId: `body_${ownerFeatureId}` as BodyId,
    label: parameters.label,
    ownerFeatureId,
    shape: restored.solid,
    seedNaming: parameters.reconstruction?.resultClassification !== 'facetedFallback',
  })

  return {
    bodies: [...context.bodies, body],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    featureDefinition: reconstruction
      ? {
          kind: 'meshImport',
          featureTypeVersion: MESH_IMPORT_FEATURE_SCHEMA_VERSION,
          parameters: {
            ...parameters,
            reconstruction,
          },
        }
      : undefined,
    assetRecords: [updateMeshImportAssetProvenance(asset, restored.diagnostics)],
    producedTargets: [{ kind: 'body', bodyId: body.bodyId }],
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map(),
  }
}

function assertBooleanScopeCompatible(
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
) {
  if (operation === 'newBody' && booleanScope.kind !== 'standalone') {
    throw new Error('Boolean operation newBody requires standalone scope.')
  }

  if (operation !== 'newBody' && booleanScope.kind === 'standalone') {
    throw new Error(`Boolean operation ${operation} requires explicit target bodies.`)
  }
}

function requireUniqueTargetBodies(targetBodyIds: readonly BodyId[]) {
  const seen = new Set<BodyId>()

  for (const bodyId of targetBodyIds) {
    if (seen.has(bodyId)) {
      throw new Error(`Boolean target body ${bodyId} is duplicated in the explicit participant scope.`)
    }

    seen.add(bodyId)
  }
}

function applyBooleanPolicy(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
  featureShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  assertBooleanScopeCompatible(operation, booleanScope)

  if (operation === 'newBody') {
    const newBodies = trackNewBodyResults(context, ownerFeatureId, ownerFeatureId, featureShape)
    return {
      bodies: [
        ...context.bodies,
        ...newBodies,
      ],
      producedTargets: newBodies.map((body) => ({ kind: 'body', bodyId: body.bodyId }) as DurableRef),
      historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
    }
  }

  let targetBodyIds: BodyId[]

  if (booleanScope.kind === 'targetBody') {
    targetBodyIds = [booleanScope.bodyId]
  } else if (booleanScope.kind === 'targetBodies') {
    targetBodyIds = [...booleanScope.bodyIds]
  } else {
    throw new Error(`Boolean operation ${operation} requires explicit target bodies.`)
  }

  if (targetBodyIds.length === 0) {
    throw new Error(`Boolean operation ${operation} requires at least one target body.`)
  }

  requireUniqueTargetBodies(targetBodyIds)

  const policy = getMultiBodyBooleanPolicy(operation, booleanScope)
  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []

  if (!policy) {
    const bodyId = targetBodyIds[0]!
    const targetBody = requireBody(context, bodyId)
    const result = runBoolean(context.oc, operation, targetBody.shape, featureShape)
    const replacementResult = resolveReplacementBodies(context, bodyId, result.shape, ownerFeatureId, {
      allowEmpty: true,
      historySources: result.historySources,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: replacementResult.historyInvalidations,
    }
  }

  if (policy.application === 'sequential') {
    const [firstBodyId, ...restBodyIds] = targetBodyIds
    let currentResult = runBoolean(
      context.oc,
      policy.operation,
      requireBody(context, firstBodyId!).shape,
      featureShape,
    )
    const firstBodyHistorySources: OccTopologyHistorySource[] = [...currentResult.historySources]
    const combinedHistoryInvalidations = new Map<string, OccReferenceInvalidationRecord>()
    const firstBody = requireBody(context, firstBodyId!)
    for (const [key, value] of collectTopologyHistoryInvalidations(firstBody, currentResult.builder)) {
      combinedHistoryInvalidations.set(key, value)
    }

    for (const bodyId of restBodyIds) {
      const body = requireBody(context, bodyId)
      currentResult = runBoolean(context.oc, policy.operation, currentResult.shape, body.shape)
      firstBodyHistorySources.push(...currentResult.historySources)
      for (const [key, value] of collectTopologyHistoryInvalidations(body, currentResult.builder)) {
        combinedHistoryInvalidations.set(key, value)
      }
    }

    const replacementResult = resolveReplacementBodies(context, firstBodyId!, currentResult.shape, ownerFeatureId, {
      allowEmpty: true,
      historySources: firstBodyHistorySources,
    })
    const firstIndex = nextBodies.findIndex((entry) => entry.bodyId === firstBodyId)
    nextBodies.splice(firstIndex, 1, ...replacementResult.replacements)

    for (const bodyId of targetBodyIds.slice(1)) {
      const consumedBody = requireBody(context, bodyId)
      const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
      if (index >= 0) {
        nextBodies.splice(index, 1)
      }
      for (const [key, value] of createDeletedBodyInvalidations(consumedBody)) {
        combinedHistoryInvalidations.set(key, value)
      }
    }

    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value)
    }
    return {
      bodies: nextBodies,
      producedTargets,
      historyInvalidations: combinedHistoryInvalidations,
    }
  }

  const combinedHistoryInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  for (const bodyId of targetBodyIds) {
    const targetBody = requireBody(context, bodyId)
    const result = runBoolean(context.oc, policy.operation, targetBody.shape, featureShape)
    const replacementResult = resolveReplacementBodies(context, bodyId, result.shape, ownerFeatureId, {
      allowEmpty: true,
      historySources: result.historySources,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      combinedHistoryInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    producedTargets,
    historyInvalidations: combinedHistoryInvalidations,
  }
}

function createDeletedBodyInvalidations(body: OccTrackedBody) {
  const invalidations = new Map<string, OccReferenceInvalidationRecord>()
  const register = (target: DurableRef, sourceTarget: DurableRef | null) => {
    invalidations.set(getOccDurableRefKey(target), {
      target,
      reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
      sourceTarget,
    })
  }

  register({ kind: 'body', bodyId: body.bodyId }, null)

  for (const faceId of body.facesById.keys()) {
    register({ kind: 'face', bodyId: body.bodyId, faceId }, { kind: 'body', bodyId: body.bodyId })
  }
  for (const edgeId of body.edgesById.keys()) {
    register({ kind: 'edge', bodyId: body.bodyId, edgeId }, { kind: 'body', bodyId: body.bodyId })
  }
  for (const vertexId of body.verticesById.keys()) {
    register({ kind: 'vertex', bodyId: body.bodyId, vertexId }, { kind: 'body', bodyId: body.bodyId })
  }

  return invalidations
}

function trackBodiesFromShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  label: string,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  suffix: string,
) {
  const solids = extractSolidShapes(context.oc, shape)

  if (solids.length === 0) {
    throw new Error(
      `advanced-feature-unsupported-kernel-case: ${label} for ${ownerFeatureId} produced no solid result bodies.`,
    )
  }

  return solids.map((solid, index) => trackNewSolidBody(context.oc, {
    bodyId: `body_${ownerFeatureId}_${suffix}${solids.length === 1 ? '' : `_${index + 1}`}` as BodyId,
    label: `${ownerFeatureId}_${suffix}${solids.length === 1 ? '' : `_${index + 1}`}`,
    ownerFeatureId,
    shape: solid,
  }))
}

function buildExtrudeFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ExtrudeFeatureParameters,
) {
  if (parameters.startExtent.kind !== 'profilePlane') {
    throw new Error('Extrude startExtent.kind must be profilePlane.')
  }

  const extent = getExtrudeFeatureExtent(parameters)

  const profileKeys = new Set<string>()
  for (const profile of parameters.profiles) {
    const key = getOccDurableRefKey(profile)
    if (profileKeys.has(key)) {
      throw new Error('unsupported-profile-group: OCC extrude does not support duplicate profile references.')
    }
    profileKeys.add(key)
  }

  const extrudedShapes = parameters.profiles.flatMap((profile) => buildExtrudeProfileShapes(context, profile, extent))

  if (extrudedShapes.length === 1) {
    return extrudedShapes[0]!
  }

  const builder = new context.oc.BRep_Builder()
  const compound = new context.oc.TopoDS_Compound()
  builder.MakeCompound(compound)
  for (const shape of extrudedShapes) {
    builder.Add(compound, shape)
  }

  return compound
}

function getShapeProjectionRange(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  direction: Vec3,
) {
  const points = getShapeVertexPoints(oc, shape)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const point of points) {
    const projection = dot(point, direction)
    min = Math.min(min, projection)
    max = Math.max(max, projection)
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC could not resolve target projection extents.')
  }

  return { min, max }
}

function getShapeVertexPoints(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
) {
  const vertexMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never, vertexMap)
  const points: Vec3[] = []

  for (let index = 1; index <= vertexMap.Size(); index += 1) {
    const vertex = oc.TopoDS.Vertex_1(vertexMap.FindKey(index))
    points.push(toVec3FromGpPoint(oc.BRep_Tool.Pnt(vertex)))
  }

  vertexMap.delete()
  return points
}

function selectNearestForwardProjection(
  candidates: Array<{ projection: number; source: string }>,
  tolerance: number,
  label: string,
) {
  const sortedCandidates = [...candidates].sort((left, right) => left.projection - right.projection)
  const nearest = sortedCandidates[0]

  if (!nearest) {
    return null
  }

  const matchingSources = new Set(
    sortedCandidates
      .filter((candidate) => Math.abs(candidate.projection - nearest.projection) <= tolerance)
      .map((candidate) => candidate.source),
  )

  if (matchingSources.size > 1) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC ${label} termination is ambiguous between multiple bodies.`)
  }

  return nearest.projection
}

function getExtrudeTargetProjection(
  context: OccFeatureExecutionContext,
  end: ExtrudeEndCondition,
  direction: Vec3,
  startProjection: number,
) {
  if (end.kind === 'upToNext') {
    const candidates = context.bodies.flatMap((body) => {
      const range = getShapeProjectionRange(context.oc, body.shape, direction)
      return [
        { projection: range.min, source: body.bodyId },
        { projection: range.max, source: body.bodyId },
      ]
    }).filter((candidate) => candidate.projection > startProjection + context.modelingTolerance)

    return selectNearestForwardProjection(candidates, context.modelingTolerance, 'extrude up-to-next')
  }

  if (end.kind === 'upToFace') {
    const body = requireBody(context, end.target.bodyId)
    const face = requireFace(body, end.target.faceId)
    return getShapeProjectionRange(context.oc, face, direction).max
  }

  if (end.kind === 'upToPart') {
    const body = requireBody(context, end.target.bodyId)
    return getShapeProjectionRange(context.oc, body.shape, direction).max
  }

  if (end.kind === 'upToVertex') {
    const body = requireBody(context, end.target.bodyId)
    const vertex = body.verticesById.get(end.target.vertexId)
    if (!vertex) {
      throw new Error(`Vertex ${end.target.vertexId} does not resolve on body ${end.target.bodyId}.`)
    }
    return dot(toVec3FromGpPoint(context.oc.BRep_Tool.Pnt(vertex)), direction)
  }

  return null
}

function getThroughAllDistance(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  direction: Vec3,
) {
  const profileRange = getShapeProjectionRange(context.oc, profileShape, direction)
  const targetMax = context.bodies.reduce((max, body) => {
    const range = getShapeProjectionRange(context.oc, body.shape, direction)
    return Math.max(max, range.max)
  }, profileRange.max)
  return Math.max(targetMax - profileRange.min + 10, 100)
}

function resolveExtrudeDistance(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  direction: Vec3,
  end: ExtrudeEndCondition,
) {
  if (end.kind === 'blind') {
    const distance = end.distance as number
    if (distance <= 0) {
      throw new Error('Extrude endExtent.distance must be positive.')
    }
    return distance
  }

  if (end.kind === 'throughAll') {
    return getThroughAllDistance(context, profileShape, direction)
  }

  const profileRange = getShapeProjectionRange(context.oc, profileShape, direction)
  const targetProjection = getExtrudeTargetProjection(context, end, direction, profileRange.max)
  if (targetProjection === null) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC extrude up-to-next found no terminating geometry.')
  }

  const offset = (end.offset?.distance ?? 0) as number
  const signedOffset = end.offset?.direction === 'extend' ? offset : -offset
  const distance = targetProjection - profileRange.max + signedOffset

  if (distance <= context.modelingTolerance) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC extrude termination is behind, coincident, or bypassed by offset.')
  }

  return distance
}

function buildExtrudeProfileShapes(
  context: OccFeatureExecutionContext,
  profile: ExtrudeFeatureParameters['profiles'][number],
  extent: ReturnType<typeof getExtrudeFeatureExtent>,
) {
  let profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>
  let baseNormal: Vec3

  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)
    const profileFace = buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region)
    profileShape = profileFace.face
    baseNormal = getExtrusionNormalForSketchProfile(profileFace.plane, 'positive')
  } else {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    profileShape = face
    baseNormal = getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
  }

  const ends: ExtrudeEndCondition[] = extent.mode === 'twoSide'
    ? [extent.firstEnd, extent.secondEnd]
    : extent.mode === 'symmetric'
      ? [extent.end, { ...extent.end, direction: extent.end.direction === 'positive' ? 'negative' : 'positive' }]
      : [extent.end]

  return ends.map((end) => buildExtrudeEndShape(context, profileShape, baseNormal, end))
}

function createPlaneFrameForNormal(origin: Vec3, normal: Vec3) {
  const unitNormal = normalize(normal)
  const seed: Vec3 = Math.abs(unitNormal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const xAxis = normalize(cross(seed, unitNormal))
  const yAxis = normalize(cross(unitNormal, xAxis))

  return {
    origin,
    xAxis,
    yAxis,
    normal: unitNormal,
    linearUnit: 'documentLength' as const,
    handedness: 'rightHanded' as const,
  }
}

function collectExtrudeDraftFaces(
  oc: OpenCascadeInstance,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  direction: Vec3,
  startProjection: number,
  distance: number,
  tolerance: number,
) {
  const faceMap = new oc.TopTools_IndexedMapOfShape_1()
  oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, faceMap)
  const faces: Array<InstanceType<OpenCascadeInstance['TopoDS_Face']>> = []
  const minSpan = Math.max(distance * 0.5, tolerance)

  for (let index = 1; index <= faceMap.Size(); index += 1) {
    const face = oc.TopoDS.Face_1(faceMap.FindKey(index))
    const range = getShapeProjectionRange(oc, face, direction)
    const spansExtrusion = range.max - range.min >= minSpan
      && range.min <= startProjection + tolerance
      && range.max >= startProjection + distance - tolerance

    if (spansExtrusion) {
      faces.push(face)
    }
  }

  faceMap.delete()
  return faces
}

function applyExtrudeDraft(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  direction: Vec3,
  startProjection: number,
  distance: number,
  draftAngle: number | undefined,
) {
  if (draftAngle === undefined || Math.abs(draftAngle) <= context.modelingTolerance) {
    return shape
  }

  if (!Number.isFinite(draftAngle)) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC extrude draft angle must be finite.')
  }

  const draftFaces = collectExtrudeDraftFaces(
    context.oc,
    shape,
    direction,
    startProjection,
    distance,
    context.modelingTolerance,
  )

  if (draftFaces.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC extrude draft found no lateral faces to draft.')
  }

  const neutralPlane = toGpPlane(
    context.oc,
    createPlaneFrameForNormal(scale(direction, startProjection), direction),
  )
  const draft = new context.oc.BRepOffsetAPI_DraftAngle_1()
  draft.Init(shape)

  for (const face of draftFaces) {
    draft.Add(face, toGpDir(context.oc, direction), draftAngle, neutralPlane, true)

    if (!draft.AddDone()) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC extrude draft could not add a lateral face.')
    }
  }

  draft.Build(new context.oc.Message_ProgressRange_1())

  if (!draft.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC extrude draft build failed.')
  }

  return draft.Shape()
}

function buildExtrudeEndShape(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  baseNormal: Vec3,
  end: ExtrudeEndCondition,
) {
  const extrusionDirection = normalize(end.direction === 'positive' ? baseNormal : scale(baseNormal, -1))
  const distance = resolveExtrudeDistance(context, profileShape, extrusionDirection, end)
  const profileRange = getShapeProjectionRange(context.oc, profileShape, extrusionDirection)

  const prism = new context.oc.BRepPrimAPI_MakePrism_1(
    profileShape,
    toGpVec(context.oc, scale(extrusionDirection, distance)),
    false,
    true,
  )

  prism.Build(new context.oc.Message_ProgressRange_1())

  if (!prism.IsDone()) {
    throw new Error('OCC extrude prism build failed.')
  }

  return applyExtrudeDraft(
    context,
    prism.Shape(),
    extrusionDirection,
    profileRange.max,
    distance,
    end.draftAngle as number | undefined,
  )
}

function buildRevolveFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: RevolveFeatureParameters,
) {
  if (parameters.axis.kind === 'construction') {
    throw new Error(`${OCC_CONTRACT_GAP_CODES.constructionRevolveAxisUnsupported}: ${getConstructionBackedRevolveAxisRejectionReason()}`)
  }

  if (parameters.profiles.length > 1) {
    throw new Error('unsupported-profile-group: OCC revolve does not support multi-profile groups yet.')
  }

  const profile = parameters.profiles[0]
  let profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>

  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)
    profileShape = buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region).face
  } else {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
    profileShape = face
  }

  const axisBody = requireBody(context, parameters.axis.bodyId)
  const axisEdge = requireEdge(axisBody, parameters.axis.edgeId)
  const axis = buildAxisFromLineEdge(context.oc, axisEdge)

  if (parameters.startAngle !== 0) {
    const rotation = new context.oc.gp_Trsf_1()
    rotation.SetRotation_1(axis, parameters.startAngle)
    const transform = new context.oc.BRepBuilderAPI_Transform_2(profileShape, rotation, true)
    transform.Build(new context.oc.Message_ProgressRange_1())

    if (!transform.IsDone()) {
      throw new Error('OCC revolve pre-rotation transform failed.')
    }

    profileShape = transform.Shape()
  }

  const extent = getRevolveFeatureExtent(parameters)
  const ends: RevolveEndCondition[] = extent.mode === 'twoSide'
    ? [extent.firstEnd, extent.secondEnd]
    : extent.mode === 'symmetric'
      ? [extent.end, { ...extent.end, direction: extent.end.direction === 'counterClockwise' ? 'clockwise' : 'counterClockwise' }]
      : [extent.end]
  const shapes = ends.map((end) => buildRevolveEndShape(context, profileShape, axis, end))

  if (shapes.length === 1) {
    return shapes[0]!
  }

  const builder = new context.oc.BRep_Builder()
  const compound = new context.oc.TopoDS_Compound()
  builder.MakeCompound(compound)
  for (const shape of shapes) {
    builder.Add(compound, shape)
  }

  return compound
}

function getAxisOriginAndDirection(axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>) {
  return {
    origin: toVec3FromGpPoint(axis.Location()),
    direction: normalize(toVec3FromGpPoint(axis.Direction())),
  }
}

function getPerpendicularAxisVector(point: Vec3, axisOrigin: Vec3, axisDirection: Vec3) {
  const relative = subtract(point, axisOrigin)
  const axial = scale(axisDirection, dot(relative, axisDirection))
  return subtract(relative, axial)
}

function getRevolveReferenceVector(
  oc: OpenCascadeInstance,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axisOrigin: Vec3,
  axisDirection: Vec3,
  tolerance: number,
) {
  const points = getShapeVertexPoints(oc, profileShape)

  if (points.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC revolve profile has no vertices for angular target resolution.')
  }

  const centroid = scale(
    points.reduce((sum, point) => [
      sum[0] + point[0],
      sum[1] + point[1],
      sum[2] + point[2],
    ] as Vec3, [0, 0, 0]),
    1 / points.length,
  )
  const centroidVector = getPerpendicularAxisVector(centroid, axisOrigin, axisDirection)

  if (magnitude(centroidVector) > tolerance) {
    return normalize(centroidVector)
  }

  const radialPoint = points.find((point) =>
    magnitude(getPerpendicularAxisVector(point, axisOrigin, axisDirection)) > tolerance,
  )

  if (!radialPoint) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC revolve profile is coincident with the axis.')
  }

  return normalize(getPerpendicularAxisVector(radialPoint, axisOrigin, axisDirection))
}

function getAngleAroundAxis(
  startVector: Vec3,
  targetVector: Vec3,
  axisDirection: Vec3,
  direction: Exclude<RevolveEndCondition, { kind: 'full' }>['direction'],
) {
  const start = normalize(startVector)
  const target = normalize(targetVector)
  const cosine = Math.max(-1, Math.min(1, dot(start, target)))
  let angle = Math.acos(cosine)
  const orientation = dot(cross(start, target), axisDirection)

  if (direction === 'counterClockwise') {
    if (orientation < 0) {
      angle = Math.PI * 2 - angle
    }
  } else if (orientation > 0) {
    angle = Math.PI * 2 - angle
  }

  return angle
}

function getRevolveTargetPointCandidates(
  context: OccFeatureExecutionContext,
  end: Exclude<RevolveEndCondition, { kind: 'blind' | 'full' }>,
) {
  if (end.kind === 'upToNext') {
    return context.bodies.flatMap((body) =>
      getShapeVertexPoints(context.oc, body.shape).map((point) => ({
        point,
        source: body.bodyId,
      })),
    )
  }

  if (end.kind === 'upToFace') {
    const body = requireBody(context, end.target.bodyId)
    const face = requireFace(body, end.target.faceId)
    return getShapeVertexPoints(context.oc, face).map((point) => ({
      point,
      source: `${end.target.bodyId}:${end.target.faceId}`,
    }))
  }

  if (end.kind === 'upToPart') {
    const body = requireBody(context, end.target.bodyId)
    return getShapeVertexPoints(context.oc, body.shape).map((point) => ({
      point,
      source: body.bodyId,
    }))
  }

  const body = requireBody(context, end.target.bodyId)
  const vertex = body.verticesById.get(end.target.vertexId)
  if (!vertex) {
    throw new Error(`Vertex ${end.target.vertexId} does not resolve on body ${end.target.bodyId}.`)
  }

  return [{
    point: toVec3FromGpPoint(context.oc.BRep_Tool.Pnt(vertex)),
    source: `${end.target.bodyId}:${end.target.vertexId}`,
  }]
}

function selectNearestForwardAngle(
  candidates: Array<{ angle: number; source: string }>,
  tolerance: number,
  label: string,
) {
  const sortedCandidates = [...candidates].sort((left, right) => left.angle - right.angle)
  const nearest = sortedCandidates[0]

  if (!nearest) {
    return null
  }

  const matchingSources = new Set(
    sortedCandidates
      .filter((candidate) => Math.abs(candidate.angle - nearest.angle) <= tolerance)
      .map((candidate) => candidate.source),
  )

  if (matchingSources.size > 1) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC ${label} termination is ambiguous between multiple bodies.`)
  }

  return nearest.angle
}

function resolveRevolveTargetAngle(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>,
  end: Exclude<RevolveEndCondition, { kind: 'blind' | 'full' }>,
) {
  const { origin, direction: axisDirection } = getAxisOriginAndDirection(axis)
  const startVector = getRevolveReferenceVector(context.oc, profileShape, origin, axisDirection, context.modelingTolerance)
  const angularTolerance = Math.max(context.modelingTolerance * 0.01, 1e-7)
  const candidates = getRevolveTargetPointCandidates(context, end).flatMap((candidate) => {
    const targetVector = getPerpendicularAxisVector(candidate.point, origin, axisDirection)

    if (magnitude(targetVector) <= context.modelingTolerance) {
      return []
    }

    const angle = getAngleAroundAxis(startVector, targetVector, axisDirection, end.direction)
    if (angle <= angularTolerance || angle >= Math.PI * 2 - angularTolerance) {
      return []
    }

    return [{ angle, source: candidate.source }]
  })

  return selectNearestForwardAngle(candidates, angularTolerance, 'revolve up-to')
}

function resolveRevolveAngle(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>,
  end: RevolveEndCondition,
) {
  if (end.kind === 'full') {
    return Math.PI * 2
  }

  if (end.kind === 'blind') {
    const angle = end.angle as number
    if (angle <= 0) {
      throw new Error('Revolve end angle must be positive.')
    }
    return angle
  }

  const targetAngle = resolveRevolveTargetAngle(context, profileShape, axis, end)
  if (targetAngle === null) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC revolve ${end.kind} found no terminating geometry.`)
  }

  const offset = (end.offset?.angle ?? 0) as number
  const signedOffset = end.offset?.direction === 'extend' ? offset : -offset
  const angle = targetAngle + signedOffset
  if (angle <= context.modelingTolerance || angle > Math.PI * 2 + context.modelingTolerance) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC revolve termination is impossible after offset.')
  }

  return angle
}

function buildRevolveEndShape(
  context: OccFeatureExecutionContext,
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  axis: InstanceType<OpenCascadeInstance['gp_Ax1_2']>,
  end: RevolveEndCondition,
) {
  const angle = resolveRevolveAngle(context, profileShape, axis, end)
  const signedExtent = end.kind !== 'full' && end.direction === 'clockwise'
    ? -angle
    : angle

  const revol = new context.oc.BRepPrimAPI_MakeRevol_1(
    profileShape,
    axis,
    signedExtent,
    false,
  )
  revol.Build(new context.oc.Message_ProgressRange_1())

  if (!revol.IsDone()) {
    throw new Error('OCC revolve build failed.')
  }

  return revol.Shape()
}

function buildSweepProfileShape(
  context: OccFeatureExecutionContext,
  profile: DurableRef,
) {
  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)
    return buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region).face
  }

  if (profile.kind === 'face') {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
    return face
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep profiles must be region or planar face targets.')
}

function buildLoftSectionWire(
  context: OccFeatureExecutionContext,
  profile: DurableRef,
) {
  if (profile.kind === 'region') {
    const sketch = requireSketchSnapshot(context, profile.sketchId)
    const region = requireRegion(sketch, profile.regionId)

    if (region.loops.some((loop) => loop.role === 'inner')) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC loft does not support profiles with inner loops yet.')
    }

    const face = buildRegionProfileFace(context.oc, { plane: sketch.plane, sketch: sketch.sketch }, region).face
    return context.oc.BRepTools.OuterWire(face)
  }

  if (profile.kind === 'face') {
    const body = requireBody(context, profile.bodyId)
    const face = requireFace(body, profile.faceId)
    getExtrusionNormalForPlanarFace(context.oc, face, 'positive')
    return context.oc.BRepTools.OuterWire(face)
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC loft profiles must be region or planar face targets.')
}

function buildSweepPathWire(
  context: OccFeatureExecutionContext,
  path: DurableRef,
) {
  if (path.kind === 'sketchEntity') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep does not support sketch-entity paths yet.')
  }

  if (path.kind !== 'edge') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep path must be a durable edge target.')
  }

  const body = requireBody(context, path.bodyId)
  const edge = requireEdge(body, path.edgeId)
  const wireBuilder = new context.oc.BRepBuilderAPI_MakeWire_1()
  wireBuilder.Add_1(edge)

  if (!wireBuilder.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep failed to build a path wire from the selected edge.')
  }

  return wireBuilder.Wire()
}

type SweepProfileControl = 'none' | 'keepProfileOrientation' | 'lockProfileFaces' | 'lockProfileDirection'
type SweepTwistOption =
  | { type: 'none' }
  | { type: 'turns'; turns: number }
  | { type: 'angle'; angle: number }
  | { type: 'pitch'; pitch: number }

function getSweepOptionLiteral(value: unknown) {
  return getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>)
}

function getSweepProfileControl(definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' }): SweepProfileControl {
  const profileControl = getSweepOptionLiteral(definition.parameters.options?.profileControl)
  if (
    profileControl === undefined
    || profileControl === null
    || profileControl === 'none'
  ) {
    return 'none'
  }

  if (
    profileControl === 'keepProfileOrientation'
    || profileControl === 'lockProfileFaces'
    || profileControl === 'lockProfileDirection'
  ) {
    return profileControl
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep profile control option is invalid.')
}

function getSweepEndScale(definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' }) {
  const endScale = getSweepOptionLiteral(definition.parameters.options?.endScale)
  if (endScale === undefined || endScale === null) {
    return 1
  }

  if (typeof endScale === 'number' && Number.isFinite(endScale) && endScale > 0) {
    return endScale
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep end scale must be a positive number.')
}

function getSweepTwist(definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' }): SweepTwistOption {
  const twist = definition.parameters.options?.twist
  if (!twist) {
    return { type: 'none' }
  }

  if (typeof twist !== 'object' || Array.isArray(twist)) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep twist option must be a discriminated option.')
  }

  const twistRecord = twist as Record<string, unknown>
  switch (twistRecord.type) {
    case 'none':
      return { type: 'none' }
    case 'turns': {
      const turns = getSweepOptionLiteral(twistRecord.turns)
      if (typeof turns === 'number' && Number.isFinite(turns) && turns > 0) {
        return { type: 'turns', turns }
      }
      break
    }
    case 'angle': {
      const angle = getSweepOptionLiteral(twistRecord.angle)
      if (typeof angle === 'number' && Number.isFinite(angle)) {
        return { type: 'angle', angle }
      }
      break
    }
    case 'pitch': {
      const pitch = getSweepOptionLiteral(twistRecord.pitch)
      if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch > 0) {
        return { type: 'pitch', pitch }
      }
      break
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep twist option is invalid.')
}

function getSweepLinearPathData(
  context: OccFeatureExecutionContext,
  path: DurableRef,
) {
  if (path.kind !== 'edge') {
    throw new Error('advanced-feature-unsupported-kernel-case: Advanced OCC sweep controls require a durable linear edge path.')
  }

  const body = requireBody(context, path.bodyId)
  const edge = requireEdge(body, path.edgeId)
  buildAxisFromLineEdge(context.oc, edge)
  const curve = new context.oc.BRepAdaptor_Curve_2(edge)
  const start = toVec3FromGpPoint(curve.Value(curve.FirstParameter()))
  const end = toVec3FromGpPoint(curve.Value(curve.LastParameter()))
  const delta = subtract(end, start)
  const length = magnitude(delta)

  if (length <= context.modelingTolerance) {
    throw new Error('advanced-feature-unsupported-kernel-case: Advanced OCC sweep controls require a non-zero path length.')
  }

  return {
    axis: new context.oc.gp_Ax1_2(toGpPnt(context.oc, start), toGpDir(context.oc, normalize(delta))),
    start,
    delta,
    length,
  }
}

function resolveSweepTwistAngle(twist: SweepTwistOption, pathLength: number) {
  switch (twist.type) {
    case 'turns':
      return twist.turns * Math.PI * 2
    case 'angle':
      return twist.angle
    case 'pitch':
      return (pathLength / twist.pitch) * Math.PI * 2
    default:
      return 0
  }
}

function transformSweepSectionShape(
  context: OccFeatureExecutionContext,
  shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']>,
  transform: InstanceType<OpenCascadeInstance['gp_Trsf']>,
) {
  const builder = new context.oc.BRepBuilderAPI_Transform_2(shape, transform, true)
  builder.Build(new context.oc.Message_ProgressRange_1())

  if (!builder.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep section transform failed.')
  }

  return builder.Shape()
}

function buildTransformedSweepEndWire(input: {
  context: OccFeatureExecutionContext
  profileWire: InstanceType<OpenCascadeInstance['TopoDS_Wire']>
  path: ReturnType<typeof getSweepLinearPathData>
  twistAngle: number
  endScale: number
}) {
  const { context, path } = input
  let shape: InstanceType<OpenCascadeInstance['TopoDS_Shape']> = input.profileWire

  if (Math.abs(input.endScale - 1) > context.modelingTolerance) {
    const scaleTransform = new context.oc.gp_Trsf_1()
    scaleTransform.SetScale(toGpPnt(context.oc, path.start), input.endScale)
    shape = transformSweepSectionShape(context, shape, scaleTransform)
  }

  if (Math.abs(input.twistAngle) > context.modelingTolerance) {
    const rotation = new context.oc.gp_Trsf_1()
    rotation.SetRotation_1(path.axis, input.twistAngle)
    shape = transformSweepSectionShape(context, shape, rotation)
  }

  const translation = new context.oc.gp_Trsf_1()
  translation.SetTranslation_1(toGpVec(context.oc, path.delta))
  shape = transformSweepSectionShape(context, shape, translation)

  return context.oc.TopoDS.Wire_1(shape)
}

function transformLoftSectionWire(input: {
  context: OccFeatureExecutionContext
  wire: InstanceType<OpenCascadeInstance['TopoDS_Wire']>
  translation: Vec3
}) {
  const transform = new input.context.oc.gp_Trsf_1()
  transform.SetTranslation_1(toGpVec(input.context.oc, input.translation))
  const builder = new input.context.oc.BRepBuilderAPI_Transform_2(input.wire, transform, true)
  builder.Build(new input.context.oc.Message_ProgressRange_1())

  if (!builder.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft path section transform failed.')
  }

  return input.context.oc.TopoDS.Wire_1(builder.Shape())
}

function buildAdvancedSweepLoftShape(input: {
  context: OccFeatureExecutionContext
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Face']>
  path: ReturnType<typeof getSweepLinearPathData>
  twistAngle: number
  endScale: number
}) {
  const profileWire = input.context.oc.BRepTools.OuterWire(input.profileShape)
  const endWire = buildTransformedSweepEndWire({
    context: input.context,
    profileWire,
    path: input.path,
    twistAngle: input.twistAngle,
    endScale: input.endScale,
  })
  const loftBuilder = new input.context.oc.BRepOffsetAPI_ThruSections(true, false, input.context.modelingTolerance)
  loftBuilder.CheckCompatibility(true)
  loftBuilder.AddWire(profileWire)
  loftBuilder.AddWire(endWire)
  loftBuilder.Build(new input.context.oc.Message_ProgressRange_1())

  if (!loftBuilder.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC advanced sweep loft build failed.')
  }

  return loftBuilder.Shape()
}

function buildLockProfileDirectionSweepPipe(input: {
  context: OccFeatureExecutionContext
  profileShape: InstanceType<OpenCascadeInstance['TopoDS_Face']>
  pathWire: InstanceType<OpenCascadeInstance['TopoDS_Wire']>
  direction: Vec3
}) {
  const pipe = new input.context.oc.BRepOffsetAPI_MakePipeShell(input.pathWire)
  pipe.SetMode_3(toGpDir(input.context.oc, normalize(input.direction)))
  pipe.Add_1(input.context.oc.BRepTools.OuterWire(input.profileShape), false, false)
  pipe.Build(new input.context.oc.Message_ProgressRange_1())

  if (!pipe.IsDone() || !pipe.MakeSolid()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC lock-profile-direction sweep pipe build failed.')
  }

  return pipe.Shape()
}

function resolveSweepLockDirection(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' },
) {
  const targets = getAdvancedParticipant(definition, 'lockProfileDirection')?.targets ?? []
  if (targets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep lock profile direction requires exactly one reference.')
  }

  const target = targets[0]!
  if (target.kind === 'edge') {
    const axis = buildAxisFromLineEdge(context.oc, requireEdge(requireBody(context, target.bodyId), target.edgeId))
    return normalize(toVec3FromGpPoint(axis.Direction()))
  }

  if (target.kind === 'construction') {
    return normalize(requireConstructionPlaneDefinition(context, target.constructionId).frame.normal)
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep lock profile direction must be an edge or construction reference.')
}

function resolveSweepLockProfileFaceDirection(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' },
) {
  const targets = getAdvancedParticipant(definition, 'lockProfileFace')?.targets ?? []
  if (targets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep lock profile faces requires at least one face reference.')
  }

  let direction: Vec3 | null = null

  for (const target of targets) {
    if (target.kind !== 'face') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep lock profile faces only accepts face references.')
    }

    const normal = getExtrusionNormalForPlanarFace(context.oc, requireFace(requireBody(context, target.bodyId), target.faceId), 'positive')
    direction ??= normal
  }

  return normalize(direction!)
}

function buildSweepFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' },
) {
  const profileTargets = getAdvancedParticipant(definition, 'profile')?.targets ?? []
  const pathTargets = getAdvancedParticipant(definition, 'path')?.targets ?? []
  const guideCurveTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []

  if (profileTargets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep requires exactly one profile target in the initial implementation.')
  }

  if (pathTargets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep requires exactly one path target.')
  }

  if (guideCurveTargets.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep does not support guide curves yet.')
  }

  const profileShape = context.oc.TopoDS.Face_1(buildSweepProfileShape(context, profileTargets[0]!))
  const pathWire = buildSweepPathWire(context, pathTargets[0]!)
  const profileControl = getSweepProfileControl(definition)
  const twist = getSweepTwist(definition)
  const endScale = getSweepEndScale(definition)
  const pathData = twist.type === 'none' && Math.abs(endScale - 1) <= context.modelingTolerance
    ? null
    : getSweepLinearPathData(context, pathTargets[0]!)
  const twistAngle = pathData ? resolveSweepTwistAngle(twist, pathData.length) : 0
  const hasTwistOrScale = pathData !== null && (Math.abs(twistAngle) > context.modelingTolerance || Math.abs(endScale - 1) > context.modelingTolerance)

  if (profileControl === 'lockProfileFaces') {
    const direction = resolveSweepLockProfileFaceDirection(context, definition)
    if (!hasTwistOrScale) {
      return buildLockProfileDirectionSweepPipe({
        context,
        profileShape,
        pathWire,
        direction,
      })
    }
  }

  if (profileControl === 'lockProfileDirection') {
    const direction = resolveSweepLockDirection(context, definition)
    if (!hasTwistOrScale) {
      return buildLockProfileDirectionSweepPipe({
        context,
        profileShape,
        pathWire,
        direction,
      })
    }
  }

  if (hasTwistOrScale) {
    if (profileControl !== 'none') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep does not support combining profile control with twist or scale yet.')
    }

    return buildAdvancedSweepLoftShape({
      context,
      profileShape,
      path: pathData,
      twistAngle,
      endScale,
    })
  }

  const pipe = profileControl === 'keepProfileOrientation' || profileControl === 'lockProfileFaces'
    ? new context.oc.BRepOffsetAPI_MakePipe_2(pathWire, profileShape, context.oc.GeomFill_Trihedron.GeomFill_IsFixed as never, false)
    : new context.oc.BRepOffsetAPI_MakePipe_1(pathWire, profileShape)
  pipe.Build(new context.oc.Message_ProgressRange_1())

  if (!pipe.IsDone()) {
    throw new Error('OCC sweep pipe build failed.')
  }

  return pipe.Shape()
}

function getSweepBooleanPolicy(definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' }): {
  operation: FeatureBooleanOperation
  booleanScope: FeatureBooleanScope
} {
  const intent = definition.parameters.operationIntent ?? 'create'

  if (intent === 'create') {
    return {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC sweep does not support boolean composition yet.')
}

function getLoftOptionLiteral(value: unknown) {
  return getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>)
}

function getLoftPathSectionCount(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  const pathOptions = definition.parameters.options?.path
  const sectionCount = typeof pathOptions === 'object' && pathOptions !== null && !Array.isArray(pathOptions)
    ? getLoftOptionLiteral((pathOptions as { sectionCount?: unknown }).sectionCount)
    : getLoftOptionLiteral(definition.parameters.options?.sectionCount)

  if (sectionCount === undefined || sectionCount === null) {
    return 5
  }

  if (typeof sectionCount === 'number' && Number.isInteger(sectionCount) && sectionCount > 0) {
    return sectionCount
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC loft path section count must be a positive integer.')
}

function getLoftGuideContinuity(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  return getLoftOptionLiteral(definition.parameters.options?.guideContinuity) ?? 'none'
}

function getLoftProfileConditions(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  const value = definition.parameters.options?.profileConditions
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function assertSupportedLoftProfileConditions(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }) {
  const profileConditions = getLoftProfileConditions(definition)
  const startCondition = getLoftOptionLiteral(profileConditions.startCondition) ?? 'none'
  const endCondition = getLoftOptionLiteral(profileConditions.endCondition) ?? 'none'
  const supportedConditions = ['none', 'normal', 'tangent']

  if (!supportedConditions.includes(String(startCondition)) || !supportedConditions.includes(String(endCondition))) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft profile condition option is invalid.')
  }

  for (const [key, value] of [
    ['startMagnitude', profileConditions.startMagnitude],
    ['endMagnitude', profileConditions.endMagnitude],
  ] as const) {
    const literal = getLoftOptionLiteral(value)
    if (literal !== undefined && literal !== null && (typeof literal !== 'number' || !Number.isFinite(literal) || literal <= 0)) {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC loft ${key} must be a positive number.`)
    }
  }
}

function assertLoftGuideTargetsResolve(
  context: OccFeatureExecutionContext,
  guideCurveTargets: readonly DurableRef[],
) {
  for (const target of guideCurveTargets) {
    if (target.kind === 'edge') {
      requireEdge(requireBody(context, target.bodyId), target.edgeId)
      continue
    }

    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft guide curves must be durable edge targets.')
  }
}

function assertSupportedLoftConnections(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'loft' },
  profileTargets: readonly DurableRef[],
) {
  const connections = definition.parameters.options?.matchConnections
  if (connections === undefined) {
    return
  }

  if (!Array.isArray(connections)) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft match connections must be a connection list.')
  }

  if (connections.length === 0) {
    return
  }

  if (connections.length !== 1 || profileTargets.length !== 2) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft currently supports one match connection across two ordered profiles.')
  }

  const [connection] = connections as readonly { from?: DurableRef; to?: DurableRef }[]
  for (const endpoint of [connection?.from, connection?.to]) {
    if (endpoint?.kind === 'edge') {
      requireEdge(requireBody(context, endpoint.bodyId), endpoint.edgeId)
    } else if (endpoint?.kind === 'vertex') {
      requireVertex(requireBody(context, endpoint.bodyId), endpoint.vertexId)
    } else {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC loft match connections require durable edge or vertex endpoints.')
    }
  }
}

function addPathDrivenLoftSections(input: {
  context: OccFeatureExecutionContext
  loftBuilder: InstanceType<OpenCascadeInstance['BRepOffsetAPI_ThruSections']>
  startWire: InstanceType<OpenCascadeInstance['TopoDS_Wire']>
  pathTarget: DurableRef
  sectionCount: number
}) {
  const path = getSweepLinearPathData(input.context, input.pathTarget)

  for (let index = 1; index <= input.sectionCount; index += 1) {
    input.loftBuilder.AddWire(transformLoftSectionWire({
      context: input.context,
      wire: input.startWire,
      translation: scale(path.delta, index / (input.sectionCount + 1)),
    }))
  }
}

function buildLoftFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'loft' },
) {
  const profileTargets = getAdvancedParticipant(definition, 'profile')?.targets ?? []
  const pathTargets = getAdvancedParticipant(definition, 'path')?.targets ?? []
  const guideCurveTargets = getAdvancedParticipant(definition, 'guideCurve')?.targets ?? []

  if (profileTargets.length < 2) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft requires at least two ordered profile targets.')
  }

  if (pathTargets.length > 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft supports at most one path target.')
  }

  if (pathTargets.length > 0 && guideCurveTargets.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft does not support combining path and guide curves yet.')
  }

  const guideContinuity = getLoftGuideContinuity(definition)
  if (guideCurveTargets.length > 0) {
    assertLoftGuideTargetsResolve(context, guideCurveTargets)
    if (guideContinuity !== 'none' && guideContinuity !== 'normalToGuide') {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC loft does not support ${String(guideContinuity)} guide continuity yet.`)
    }
  } else if (guideContinuity !== 'none') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC loft guide continuity requires guide curves.')
  }

  assertSupportedLoftProfileConditions(definition)
  assertSupportedLoftConnections(context, definition, profileTargets)

  if (pathTargets.length > 0 && profileTargets.length !== 2) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC path loft currently supports exactly two ordered profile targets.')
  }

  const loftBuilder = new context.oc.BRepOffsetAPI_ThruSections(true, false, context.modelingTolerance)
  loftBuilder.CheckCompatibility(true)

  if (pathTargets.length > 0) {
    const startWire = buildLoftSectionWire(context, profileTargets[0]!)
    loftBuilder.AddWire(startWire)
    addPathDrivenLoftSections({
      context,
      loftBuilder,
      startWire,
      pathTarget: pathTargets[0]!,
      sectionCount: getLoftPathSectionCount(definition),
    })
    loftBuilder.AddWire(buildLoftSectionWire(context, profileTargets[1]!))
  } else {
    for (const profile of profileTargets) {
      loftBuilder.AddWire(buildLoftSectionWire(context, profile))
    }
  }

  loftBuilder.Build(new context.oc.Message_ProgressRange_1())

  if (!loftBuilder.IsDone()) {
    throw new Error('OCC loft build failed.')
  }

  return loftBuilder.Shape()
}

function getLoftBooleanPolicy(definition: AdvancedSolidFeatureDefinition & { kind: 'loft' }): {
  operation: FeatureBooleanOperation
  booleanScope: FeatureBooleanScope
} {
  const intent = definition.parameters.operationIntent ?? 'create'

  if (intent === 'create') {
    return {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC loft does not support boolean composition yet.')
}

function executeLoftFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'loft' },
): OccFeatureExecutionResult {
  const featureShape = buildLoftFeatureShape(context, definition)
  const policy = getLoftBooleanPolicy(definition)
  const result = applyBooleanPolicy(context, ownerFeatureId, policy.operation, policy.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executeSweepFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'sweep' },
): OccFeatureExecutionResult {
  const featureShape = buildSweepFeatureShape(context, definition)
  const policy = getSweepBooleanPolicy(definition)
  const result = applyBooleanPolicy(context, ownerFeatureId, policy.operation, policy.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executePlaneFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: PlaneFeatureParameters,
): OccFeatureExecutionResult {
  if (parameters.mode !== 'coplanar') {
    throw new Error('Plane feature mode must be coplanar.')
  }

  if (parameters.reference.target.kind === 'construction') {
    const sourceConstructionId = parameters.reference.target.constructionId
    const sourceConstruction = context.constructions.find(
      (entry) => entry.constructionId === sourceConstructionId,
    )

    if (!sourceConstruction) {
      throw new Error(`Construction plane ${sourceConstructionId} does not resolve in the current OCC authoring state.`)
    }
  }

  const constructionId = `construction_${ownerFeatureId}` as ConstructionId
  const plane: SketchPlaneDefinition = parameters.reference.target.kind === 'construction'
    ? {
        support: { kind: 'construction', constructionId },
        frame: requireConstructionPlaneDefinition(context, parameters.reference.target.constructionId).frame,
        key: null,
      }
    : buildConstructionPlaneFromPlanarFace(
        context.oc,
        requireFace(requireBody(context, parameters.reference.target.bodyId), parameters.reference.target.faceId),
        parameters.reference.target.faceId,
        { kind: 'construction', constructionId },
      )

  const construction = {
    ownerDocumentId: context.documentId,
    ownerRevisionId: context.revisionId,
    ownerFeatureId,
    ownerSketchId: null,
    ownerBodyId: null,
    constructionId,
    label: ownerFeatureId,
    constructionType: 'plane',
    plane,
    target: { kind: 'construction', constructionId },
  } satisfies ConstructionSnapshotRecord

  const constructionPlanes = new Map(context.constructionPlanes)
  constructionPlanes.set(constructionId, plane)
  const artifacts = createConstructionPresentationArtifacts(context, construction, plane)

  return {
    bodies: [...context.bodies],
    constructions: [...context.constructions, construction],
    constructionPlanes,
    producedTargets: [{ kind: 'construction', constructionId }],
    entities: artifacts.entities,
    renderRecords: artifacts.renderRecords,
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
  }
}

function executeExtrudeFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ExtrudeFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildExtrudeFeatureShape(context, parameters)
  const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executeRevolveFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: RevolveFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildRevolveFeatureShape(context, parameters)
  const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function executeFilletFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: FilletFeatureParameters,
): OccFeatureExecutionResult {
  if (parameters.radius <= 0) {
    throw new Error('Fillet radius must be positive.')
  }

  if (parameters.edgeTargets.length === 0) {
    throw new Error('Fillet requires at least one target edge.')
  }

  const targetsByBody = new Map<BodyId, FilletFeatureParameters['edgeTargets']>()

  for (const target of parameters.edgeTargets) {
    const list = targetsByBody.get(target.bodyId) ?? []
    targetsByBody.set(target.bodyId, [...list, target])
  }

  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []
  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireBody(context, bodyId)
    const fillet = new context.oc.BRepFilletAPI_MakeFillet(
      body.shape,
      context.oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
    )

    for (const target of targets) {
      fillet.Add_2(parameters.radius, requireEdge(body, target.edgeId))
    }

    fillet.Build(new context.oc.Message_ProgressRange_1())

    if (!fillet.IsDone()) {
      throw new Error(`OCC fillet build failed for body ${bodyId}.`)
    }

    const replacementResult = resolveReplacementBodies(context, bodyId, fillet.Shape(), ownerFeatureId, {
      allowEmpty: false,
      historySource: fillet,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getChamferDistance(definition: AdvancedSolidFeatureDefinition & { kind: 'chamfer' }) {
  const distance = definition.parameters.options?.distance

  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer requires a positive constant distance option.')
  }

  return distance
}

function getChamferEdgeTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'chamfer' }) {
  const edgeTargets = getAdvancedParticipant(definition, 'edge')?.targets ?? []

  if (edgeTargets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer requires at least one edge target.')
  }

  for (const target of edgeTargets) {
    if (target.kind !== 'edge') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer edge participants must be durable edge targets.')
    }
  }

  return edgeTargets as readonly Extract<DurableRef, { kind: 'edge' }>[]
}

function requireAdjacentFaceForChamfer(
  context: OccFeatureExecutionContext,
  body: OccTrackedBody,
  edge: InstanceType<OpenCascadeInstance['TopoDS_Edge']>,
  edgeId: `edge_${string}`,
) {
  const edgeFaceMap = new context.oc.TopTools_IndexedDataMapOfShapeListOfShape_1()
  context.oc.TopExp.MapShapesAndAncestors(
    body.shape,
    context.oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    context.oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    edgeFaceMap,
  )

  const index = edgeFaceMap.FindIndex(edge)
  if (index <= 0) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC chamfer could not find adjacent faces for edge ${edgeId}.`)
  }

  const faces = edgeFaceMap.FindFromIndex(index)
  if (faces.Size() <= 0) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC chamfer edge ${edgeId} has no adjacent faces.`)
  }

  return context.oc.TopoDS.Face_1(faces.First_1())
}

function executeChamferFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'chamfer' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined && definition.parameters.operationIntent !== 'create') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC chamfer does not support boolean operation intents.')
  }

  const distance = getChamferDistance(definition)
  const edgeTargets = getChamferEdgeTargets(definition)
  const targetsByBody = new Map<BodyId, typeof edgeTargets>()

  for (const target of edgeTargets) {
    const list = targetsByBody.get(target.bodyId) ?? []
    targetsByBody.set(target.bodyId, [...list, target])
  }

  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []
  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()

  for (const [bodyId, targets] of targetsByBody.entries()) {
    const body = requireBody(context, bodyId)
    const chamfer = new context.oc.BRepFilletAPI_MakeChamfer(body.shape)

    for (const target of targets) {
      const edge = requireEdge(body, target.edgeId)
      chamfer.Add_3(distance, distance, edge, requireAdjacentFaceForChamfer(context, body, edge, target.edgeId))
    }

    chamfer.Build(new context.oc.Message_ProgressRange_1())

    if (!chamfer.IsDone()) {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC chamfer build failed for body ${bodyId}.`)
    }

    const replacementResult = resolveReplacementBodies(context, bodyId, chamfer.Shape(), ownerFeatureId, {
      allowEmpty: false,
      historySource: chamfer,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getThickenThickness(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const thickness = definition.parameters.options?.thickness

  if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires a positive thickness option.')
  }

  return thickness
}

function getThickenSide(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const side = definition.parameters.options?.side

  if (side === undefined || side === 'oneSide') {
    return 'oneSide'
  }

  if (side === 'symmetric') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken does not support symmetric side mode yet.')
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken side must be oneSide.')
}

function getThickenDirection(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const direction = definition.parameters.options?.direction

  if (direction === undefined || direction === 'positive') {
    return 'positive'
  }

  if (direction === 'negative') {
    return 'negative'
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken direction must be positive or negative.')
}

function getThickenFaceTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }) {
  const faceTargets = getAdvancedParticipant(definition, 'face')?.targets ?? []

  if (faceTargets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires exactly one face target in the initial implementation.')
  }

  for (const target of faceTargets) {
    if (target.kind !== 'face') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken face participants must be durable face targets.')
    }
  }

  return faceTargets as readonly Extract<DurableRef, { kind: 'face' }>[]
}

function buildThickenFeatureShape(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' },
) {
  const [faceTarget] = getThickenFaceTargets(definition)
  const thickness = getThickenThickness(definition)
  getThickenSide(definition)
  const direction = getThickenDirection(definition)
  const body = requireBody(context, faceTarget!.bodyId)
  const face = requireFace(body, faceTarget!.faceId)

  let extrusionNormal: Vec3
  try {
    extrusionNormal = getExtrusionNormalForPlanarFace(
      context.oc,
      face,
      direction,
    )
  } catch {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken requires a planar face target.')
  }

  const profileShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']> = face

  const prism = new context.oc.BRepPrimAPI_MakePrism_1(
    profileShape,
    toGpVec(context.oc, scale(normalize(extrusionNormal), thickness)),
    false,
    true,
  )
  prism.Build(new context.oc.Message_ProgressRange_1())

  if (!prism.IsDone()) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken prism build failed.')
  }

  return prism.Shape()
}

function getThickenBooleanPolicy(definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' }): {
  operation: FeatureBooleanOperation
  booleanScope: FeatureBooleanScope
} {
  const intent = definition.parameters.operationIntent ?? 'create'

  if (intent === 'create') {
    return {
      operation: 'newBody',
      booleanScope: { kind: 'standalone' },
    }
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC thicken does not support boolean composition yet.')
}

function executeThickenFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'thicken' },
): OccFeatureExecutionResult {
  const featureShape = buildThickenFeatureShape(context, definition)
  const policy = getThickenBooleanPolicy(definition)
  const result = applyBooleanPolicy(context, ownerFeatureId, policy.operation, policy.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

function getCombineBodyTargets(
  definition: AdvancedSolidFeatureDefinition & { kind: 'combine' },
  role: 'targetBody' | 'toolBody',
) {
  const targets = getAdvancedParticipant(definition, role)?.targets ?? []

  if (targets.length === 0) {
    throw new Error(`advanced-feature-unsupported-kernel-case: OCC combine requires at least one ${role} participant.`)
  }

  for (const target of targets) {
    if (target.kind !== 'body') {
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC combine ${role} participants must be durable body targets.`)
    }
  }

  return targets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function getCombineBooleanOperation(definition: AdvancedSolidFeatureDefinition & { kind: 'combine' }): Exclude<FeatureBooleanOperation, 'newBody'> {
  const intent = definition.parameters.operationIntent

  switch (intent) {
    case 'add':
      return 'join'
    case 'subtract':
      return 'cut'
    case 'intersect':
      return 'intersect'
    default:
      throw new Error('advanced-feature-unsupported-kernel-case: OCC combine requires add, subtract, or intersect operation intent.')
  }
}

function mergeHistoryInvalidations(
  target: Map<string, OccReferenceInvalidationRecord>,
  source: Map<string, OccReferenceInvalidationRecord>,
) {
  for (const [key, value] of source) {
    target.set(key, value)
  }
}

function markSplitAmbiguousInvalidations(
  source: Map<string, OccReferenceInvalidationRecord>,
) {
  const ambiguous = new Map<string, OccReferenceInvalidationRecord>()

  for (const [key, value] of source) {
    ambiguous.set(key, {
      ...value,
      reason: value.reason === OCC_REFERENCE_INVALIDATION_REASONS.topologyModified
        ? OCC_REFERENCE_INVALIDATION_REASONS.topologyAmbiguous
        : value.reason,
    })
  }

  return ambiguous
}

function executeCombineFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'combine' },
): OccFeatureExecutionResult {
  const targetBodies = getCombineBodyTargets(definition, 'targetBody')
  const toolBodies = getCombineBodyTargets(definition, 'toolBody')
  const operation = getCombineBooleanOperation(definition)
  const targetBodyIds = targetBodies.map((target) => target.bodyId)
  const toolBodyIds = toolBodies.map((target) => target.bodyId)
  requireUniqueTargetBodies(targetBodyIds)
  requireUniqueTargetBodies(toolBodyIds)

  if (targetBodyIds.some((bodyId) => toolBodyIds.includes(bodyId))) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC combine target and tool bodies must be distinct.')
  }

  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  const nextBodies = [...context.bodies]
  const producedTargets: DurableRef[] = []

  if (operation === 'join') {
    const [firstTargetBodyId, ...remainingTargetBodyIds] = targetBodyIds
    const firstTargetBody = requireBody(context, firstTargetBodyId!)
    let currentShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']> = firstTargetBody.shape
    const firstTargetHistorySources: OccTopologyHistorySource[] = []

    for (const bodyId of [...remainingTargetBodyIds, ...toolBodyIds]) {
      const body = requireBody(context, bodyId)
      const result = runBoolean(context.oc, 'join', currentShape, body.shape)
      currentShape = result.shape
      firstTargetHistorySources.push(...result.historySources)
    }

    const replacementResult = resolveReplacementBodies(context, firstTargetBodyId!, currentShape, ownerFeatureId, {
      allowEmpty: true,
      historySources: firstTargetHistorySources,
    })
    const firstIndex = nextBodies.findIndex((entry) => entry.bodyId === firstTargetBodyId)
    nextBodies.splice(firstIndex, 1, ...replacementResult.replacements)
    mergeHistoryInvalidations(historyInvalidations, replacementResult.historyInvalidations)

    for (const bodyId of [...remainingTargetBodyIds, ...toolBodyIds]) {
      const body = requireBody(context, bodyId)
      const index = nextBodies.findIndex((entry) => entry.bodyId === bodyId)
      if (index >= 0) {
        nextBodies.splice(index, 1)
      }
      mergeHistoryInvalidations(historyInvalidations, createDeletedBodyInvalidations(body))
    }

    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
  } else {
    for (const targetBodyId of targetBodyIds) {
      const targetBody = requireBody(context, targetBodyId)
      let currentShape: InstanceType<OpenCascadeInstance['TopoDS_Shape']> = targetBody.shape
      const targetHistorySources: OccTopologyHistorySource[] = []

      for (const toolBodyId of toolBodyIds) {
        const toolBody = requireBody(context, toolBodyId)
        const result = runBoolean(context.oc, operation, currentShape, toolBody.shape)
        currentShape = result.shape
        targetHistorySources.push(...result.historySources)
      }

      const replacementResult = resolveReplacementBodies(context, targetBodyId, currentShape, ownerFeatureId, {
        allowEmpty: true,
        historySources: targetHistorySources,
      })
      const targetIndex = nextBodies.findIndex((entry) => entry.bodyId === targetBodyId)
      nextBodies.splice(targetIndex, 1, ...replacementResult.replacements)
      mergeHistoryInvalidations(historyInvalidations, replacementResult.historyInvalidations)

      for (const replacement of replacementResult.replacements) {
        producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
      }
    }

    for (const toolBodyId of toolBodyIds) {
      const toolBody = requireBody(context, toolBodyId)
      const index = nextBodies.findIndex((entry) => entry.bodyId === toolBodyId)
      if (index >= 0) {
        nextBodies.splice(index, 1)
      }
      mergeHistoryInvalidations(historyInvalidations, createDeletedBodyInvalidations(toolBody))
    }
  }

  if (producedTargets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC combine produced no solid result bodies.')
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getSplitTargetBody(definition: AdvancedSolidFeatureDefinition & { kind: 'split' }) {
  const targets = getAdvancedParticipant(definition, 'targetBody')?.targets ?? []

  if (targets.length !== 1 || targets[0]?.kind !== 'body') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires exactly one targetBody participant.')
  }

  return targets[0]
}

function getSplitToolBody(definition: AdvancedSolidFeatureDefinition & { kind: 'split' }) {
  const toolBodies = getAdvancedParticipant(definition, 'toolBody')?.targets ?? []
  const planes = getAdvancedParticipant(definition, 'plane')?.targets ?? []

  if (planes.length > 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split does not support plane split tools yet.')
  }

  if (toolBodies.length !== 1 || toolBodies[0]?.kind !== 'body') {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires exactly one toolBody participant in the initial implementation.')
  }

  return toolBodies[0]
}

function executeSplitFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'split' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split does not support operation intents.')
  }

  const targetBodyRef = getSplitTargetBody(definition)
  const toolBodyRef = getSplitToolBody(definition)

  if (targetBodyRef.bodyId === toolBodyRef.bodyId) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC split requires distinct target and tool bodies.')
  }

  const targetBody = requireBody(context, targetBodyRef.bodyId)
  const toolBody = requireBody(context, toolBodyRef.bodyId)
  const cutResult = runBoolean(context.oc, 'cut', targetBody.shape, toolBody.shape)
  const intersectResult = runBoolean(context.oc, 'intersect', targetBody.shape, toolBody.shape)
  const remainderBodies = trackBodiesFromShape(context, ownerFeatureId, 'Split remainder', cutResult.shape, 'remainder')
  const toolSideBodies = trackBodiesFromShape(context, ownerFeatureId, 'Split tool-side result', intersectResult.shape, 'tool-side')
  const nextBodies = context.bodies
    .filter((body) => body.bodyId !== targetBody.bodyId)
    .concat([...remainderBodies, ...toolSideBodies])
  const historyInvalidations = createDeletedBodyInvalidations(targetBody)

  for (const [key, value] of markSplitAmbiguousInvalidations(collectTopologyHistoryInvalidations(targetBody, cutResult.builder))) {
    historyInvalidations.set(key, value)
  }
  for (const [key, value] of markSplitAmbiguousInvalidations(collectTopologyHistoryInvalidations(targetBody, intersectResult.builder))) {
    historyInvalidations.set(key, value)
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [...remainderBodies, ...toolSideBodies].map((body) => ({ kind: 'body' as const, bodyId: body.bodyId })),
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function getDeleteSolidBodyTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' }) {
  const bodyTargets = getAdvancedParticipant(definition, 'body')?.targets ?? []

  if (bodyTargets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid requires at least one body participant.')
  }

  for (const target of bodyTargets) {
    if (target.kind !== 'body') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid body participants must be durable body targets.')
    }
  }

  return bodyTargets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function executeDeleteSolidFeature(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC delete-solid does not support operation intents.')
  }

  const bodyTargets = getDeleteSolidBodyTargets(definition)
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId))

  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  for (const target of bodyTargets) {
    const body = requireBody(context, target.bodyId)
    for (const [key, value] of createDeletedBodyInvalidations(body)) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: context.bodies.filter((body) => !bodyTargets.some((target) => target.bodyId === body.bodyId)),
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: [],
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function resolvePlanarReferencePlane(
  context: OccFeatureExecutionContext,
  target: DurableRef,
  supportConstructionId: ConstructionId,
) {
  if (target.kind === 'construction') {
    const plane = requireConstructionPlaneDefinition(context, target.constructionId)
    return {
      support: { kind: 'construction' as const, constructionId: supportConstructionId },
      frame: plane.frame,
      key: null,
    } satisfies SketchPlaneDefinition
  }

  if (target.kind === 'face') {
    return buildConstructionPlaneFromPlanarFace(
      context.oc,
      requireFace(requireBody(context, target.bodyId), target.faceId),
      target.faceId,
      { kind: 'construction', constructionId: supportConstructionId },
    )
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC transform-family references must be planar face or construction targets.')
}

function buildMirrorAxisPlane(
  context: OccFeatureExecutionContext,
  plane: SketchPlaneDefinition,
) {
  return new context.oc.gp_Ax2_2(
    toGpPnt(context.oc, plane.frame.origin),
    toGpDir(context.oc, plane.frame.normal),
    toGpDir(context.oc, plane.frame.xAxis),
  )
}

function getMirrorBodyTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' }) {
  const targets = getAdvancedParticipant(definition, 'body')?.targets ?? []

  if (targets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror requires at least one body participant.')
  }

  for (const target of targets) {
    if (target.kind !== 'body') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror body participants must be durable body targets.')
    }
  }

  return targets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function getMirrorPlaneTarget(definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' }) {
  const targets = getAdvancedParticipant(definition, 'plane')?.targets ?? []

  if (targets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror requires exactly one plane participant.')
  }

  const [planeTarget] = targets
  if (!planeTarget || (planeTarget.kind !== 'construction' && planeTarget.kind !== 'face')) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror plane participants must be planar face or construction targets.')
  }

  return planeTarget
}

function getMirrorCopyOption(definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' }) {
  if (definition.parameters.options?.copy !== true) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror currently supports copy=true only.')
  }

  return true
}

function executeMirrorFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'mirror' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror does not support operation intents.')
  }

  getMirrorCopyOption(definition)
  const bodyTargets = getMirrorBodyTargets(definition)
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId))
  const planeTarget = getMirrorPlaneTarget(definition)
  const plane = resolvePlanarReferencePlane(context, planeTarget, `construction_${ownerFeatureId}_mirror` as ConstructionId)
  const mirror = new context.oc.gp_Trsf_1()
  mirror.SetMirror_3(buildMirrorAxisPlane(context, plane))

  const mirroredBodies: OccTrackedBody[] = []
  for (const [index, bodyTarget] of bodyTargets.entries()) {
    const body = requireBody(context, bodyTarget.bodyId)
    const transform = new context.oc.BRepBuilderAPI_Transform_2(body.shape, mirror, true)
    transform.Build(new context.oc.Message_ProgressRange_1())

    if (!transform.IsDone()) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC mirror transform build failed.')
    }

    mirroredBodies.push(...trackBodiesFromShape(
      context,
      ownerFeatureId,
      'Mirror result',
      transform.Shape(),
      `mirror_${index + 1}`,
    ))
  }

  return {
    bodies: [...context.bodies, ...mirroredBodies],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: mirroredBodies.map((body) => ({ kind: 'body' as const, bodyId: body.bodyId })),
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map<string, OccReferenceInvalidationRecord>(),
  }
}

function getTransformBodyTargets(definition: AdvancedSolidFeatureDefinition & { kind: 'transform' }) {
  const targets = getAdvancedParticipant(definition, 'body')?.targets ?? []

  if (targets.length === 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform requires at least one body participant.')
  }

  for (const target of targets) {
    if (target.kind !== 'body') {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC transform body participants must be durable body targets.')
    }
  }

  return targets as readonly Extract<DurableRef, { kind: 'body' }>[]
}

function getTransformReferenceTarget(definition: AdvancedSolidFeatureDefinition & { kind: 'transform' }) {
  const targets = getAdvancedParticipant(definition, 'transformReference')?.targets ?? []

  if (targets.length !== 1) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform requires exactly one transformReference participant.')
  }

  const [referenceTarget] = targets
  if (!referenceTarget || (referenceTarget.kind !== 'construction' && referenceTarget.kind !== 'face')) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform references must be planar face or construction targets.')
  }

  return referenceTarget
}

function getTransformDistance(definition: AdvancedSolidFeatureDefinition & { kind: 'transform' }) {
  const distance = definition.parameters.options?.distance

  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform requires a positive distance option.')
  }

  return distance
}

function getTransformDirection(definition: AdvancedSolidFeatureDefinition & { kind: 'transform' }) {
  const direction = definition.parameters.options?.direction

  if (direction === undefined || direction === 'positive') {
    return 'positive'
  }

  if (direction === 'negative') {
    return 'negative'
  }

  throw new Error('advanced-feature-unsupported-kernel-case: OCC transform direction must be positive or negative.')
}

function executeTransformFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: 'transform' },
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    throw new Error('advanced-feature-unsupported-kernel-case: OCC transform does not support operation intents.')
  }

  const bodyTargets = getTransformBodyTargets(definition)
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId))
  const referenceTarget = getTransformReferenceTarget(definition)
  const distance = getTransformDistance(definition)
  const direction = getTransformDirection(definition)
  const plane = resolvePlanarReferencePlane(context, referenceTarget, `construction_${ownerFeatureId}_transform` as ConstructionId)
  const signedDistance = direction === 'positive' ? distance : -distance
  const translation = new context.oc.gp_Trsf_1()
  translation.SetTranslation_1(toGpVec(context.oc, scale(normalize(plane.frame.normal), signedDistance)))

  const nextBodies = [...context.bodies]
  const historyInvalidations = new Map<string, OccReferenceInvalidationRecord>()
  const producedTargets: DurableRef[] = []

  for (const bodyTarget of bodyTargets) {
    const body = requireBody(context, bodyTarget.bodyId)
    const transform = new context.oc.BRepBuilderAPI_Transform_2(body.shape, translation, true)
    transform.Build(new context.oc.Message_ProgressRange_1())

    if (!transform.IsDone()) {
      throw new Error('advanced-feature-unsupported-kernel-case: OCC transform build failed.')
    }

    const replacementResult = resolveReplacementBodies(context, body.bodyId, transform.Shape(), ownerFeatureId, {
      allowEmpty: false,
      historySource: transform,
    })
    const index = nextBodies.findIndex((entry) => entry.bodyId === body.bodyId)
    nextBodies.splice(index, 1, ...replacementResult.replacements)
    for (const replacement of replacementResult.replacements) {
      producedTargets.push({ kind: 'body', bodyId: replacement.bodyId })
    }
    for (const [key, value] of replacementResult.historyInvalidations) {
      historyInvalidations.set(key, value)
    }
  }

  return {
    bodies: nextBodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations,
  }
}

function buildShellFeatureShape(
  context: OccFeatureExecutionContext,
  parameters: ShellFeatureParameters,
) {
  if (parameters.thickness <= 0) {
    throw new Error('Shell thickness must be positive.')
  }

  if (parameters.faceTargets.length === 0) {
    throw new Error('Shell requires at least one removable face.')
  }

  const sourceBody = requireBody(context, parameters.bodyTarget.bodyId)
  const closingFaces = new context.oc.TopTools_ListOfShape_1()

  for (const target of parameters.faceTargets) {
    if (target.bodyId !== parameters.bodyTarget.bodyId) {
      throw new Error('Shell removable faces must belong to the selected source body.')
    }

    closingFaces.Append_1(requireFace(sourceBody, target.faceId))
  }

  const signedThickness = parameters.direction === 'outside'
    ? parameters.thickness
    : -parameters.thickness
  const shell = new context.oc.BRepOffsetAPI_MakeThickSolid()
  shell.MakeThickSolidByJoin(
    sourceBody.shape,
    closingFaces,
    signedThickness,
    context.modelingTolerance,
    context.oc.BRepOffset_Mode.BRepOffset_Skin as never,
    false,
    false,
    context.oc.GeomAbs_JoinType.GeomAbs_Arc as never,
    false,
    new context.oc.Message_ProgressRange_1(),
  )
  shell.Build(new context.oc.Message_ProgressRange_1())

  if (!shell.IsDone()) {
    throw new Error('OCC shell build failed.')
  }

  return shell.Shape()
}

function executeShellFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: ShellFeatureParameters,
): OccFeatureExecutionResult {
  const featureShape = buildShellFeatureShape(context, parameters)
  const result = applyBooleanPolicy(context, ownerFeatureId, parameters.operation, parameters.booleanScope, featureShape)

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
  }
}

export function executeOccFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: FeatureDefinition,
): OccFeatureExecutionResult {
  switch (definition.kind) {
    case 'plane':
      return executePlaneFeature(context, ownerFeatureId, definition.parameters)
    case 'extrude':
      return executeExtrudeFeature(context, ownerFeatureId, definition.parameters)
    case 'revolve':
      return executeRevolveFeature(context, ownerFeatureId, definition.parameters)
    case 'fillet':
      return executeFilletFeature(context, ownerFeatureId, definition.parameters)
    case 'shell':
      return executeShellFeature(context, ownerFeatureId, definition.parameters)
    case 'stepImport':
      return executeStepImportFeature(context, ownerFeatureId, definition.parameters)
    case 'meshImport':
      return executeMeshImportFeature(context, ownerFeatureId, definition.parameters)
    case 'sweep':
      return executeSweepFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'sweep' })
    case 'loft':
      return executeLoftFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'loft' })
    case 'chamfer':
      return executeChamferFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'chamfer' })
    case 'thicken':
      return executeThickenFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'thicken' })
    case 'combine':
      return executeCombineFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'combine' })
    case 'split':
      return executeSplitFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'split' })
    case 'deleteSolid':
      return executeDeleteSolidFeature(context, definition as AdvancedSolidFeatureDefinition & { kind: 'deleteSolid' })
    case 'mirror':
      return executeMirrorFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'mirror' })
    case 'transform':
      return executeTransformFeature(context, ownerFeatureId, definition as AdvancedSolidFeatureDefinition & { kind: 'transform' })
    default:
      throw new Error(`advanced-feature-unsupported-kernel-case: OCC adapter does not implement ${definition.kind} yet.`)
  }
}

function constructionEntityId(constructionId: ConstructionId) {
  return `snapshot_entity_${constructionId}` as SnapshotEntityId
}

function constructionRenderableId(constructionId: ConstructionId) {
  return `renderable_${constructionId}` as RenderableId
}

function constructionPickId(constructionId: ConstructionId) {
  return `pick_${constructionId}` as PickId
}

function buildConstructionOutlinePoints(plane: SketchPlaneDefinition, size = 10) {
  const { origin, xAxis, yAxis } = plane.frame
  const cornerOffsets = [
    [-size, -size],
    [size, -size],
    [size, size],
    [-size, size],
  ] as const

  return cornerOffsets.map(([x, y]) => [
    origin[0] + xAxis[0] * x + yAxis[0] * y,
    origin[1] + xAxis[1] * x + yAxis[1] * y,
    origin[2] + xAxis[2] * x + yAxis[2] * y,
  ] as const)
}

export function createConstructionPresentationArtifacts(
  context: Pick<OccFeatureExecutionContext, 'documentId' | 'revisionId'>,
  construction: ConstructionSnapshotRecord,
  plane: SketchPlaneDefinition,
): OccFeaturePresentationArtifacts {
  const entity: SnapshotEntityRecord = {
    ownerDocumentId: context.documentId,
    ownerRevisionId: context.revisionId,
    ownerFeatureId: construction.ownerFeatureId,
    ownerSketchId: null,
    ownerBodyId: null,
    id: constructionEntityId(construction.constructionId),
    label: construction.label,
    target: { kind: 'construction', constructionId: construction.constructionId },
    relatedTargets: [],
    consumedByFeatureIds: [],
    selectionSemantics: ['constructionPlane', 'planarReference'],
  }

  const renderRecord: RenderableEntityRecord = {
    id: constructionRenderableId(construction.constructionId),
    label: construction.label,
    ownerBodyId: null,
    ownerFeatureId: construction.ownerFeatureId,
    binding: {
      pickId: constructionPickId(construction.constructionId),
      pickPriority: 40,
      target: { kind: 'construction', constructionId: construction.constructionId },
      topology: null,
      semanticClass: 'construction',
    },
    geometry: {
      kind: 'polyline',
      points: buildConstructionOutlinePoints(plane),
      isClosed: true,
    },
  }

  return {
    entities: [entity],
    renderRecords: [renderRecord],
  }
}

export function createEmptyOccRenderExport() {
  return {
    schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
    records: [],
  } as const
}
