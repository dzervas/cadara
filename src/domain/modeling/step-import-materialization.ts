import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { GeometryAssetPoint3, GeometryAssetRecord } from '@/contracts/modeling/geometry-assets'
import type {
  BodySnapshotRecord,
  FeatureSnapshotRecord,
  ObjectTreeNodeRecord,
  SnapshotEntityRecord,
  WorkspaceSnapshot,
} from '@/contracts/modeling/schema'
import type {
  StepImportFeatureParameters,
  StepImportMaterializationFeatureStatus,
  StepImportMaterializationStage,
  StepImportMaterializationStatus,
} from '@/contracts/modeling/step-import'
import { createStepImportDiagnostic } from '@/contracts/modeling/step-import'
import type { RenderMeshGeometry, RenderableEntityRecord } from '@/contracts/render/schema'
import type {
  BodyId,
  FaceId,
  ObjectTreeNodeId,
  PickId,
  RenderableId,
  SnapshotEntityId,
} from '@/contracts/shared/ids'
import type { BodyRef, FaceRef } from '@/contracts/shared/references'

export const DEFAULT_STEP_IMPORT_MATERIALIZATION_TIMEOUT_MS = 60_000

type CadaraBrepAsset = GeometryAssetRecord & {
  data: Extract<NonNullable<GeometryAssetRecord['data']>, { kind: 'cadaraBrep' }>
}

type CadaraBrepBody = CadaraBrepAsset['data']['bodies'][number]
type CadaraBrepFace = CadaraBrepBody['topology']['faces'][number]

function isCadaraBrepAsset(asset: GeometryAssetRecord): asset is CadaraBrepAsset {
  return asset.data?.kind === 'cadaraBrep'
}

function getDocumentHistoryOrder(document: AuthoredModelDocument) {
  return document.historyOrder ?? [
    ...document.sketches.map((sketch) => ({ kind: 'sketch' as const, sketchId: sketch.sketchId })),
    ...document.features.map((feature) => ({ kind: 'feature' as const, featureId: feature.featureId })),
  ]
}

function createAppliedFeatureIds(document: AuthoredModelDocument) {
  const historyOrder = getDocumentHistoryOrder(document)
  if (document.cursor.kind === 'empty') {
    return new Set<string>()
  }

  const cursorIndex = historyOrder.findIndex((item) =>
    document.cursor.kind === 'sketch'
      ? item.kind === 'sketch' && item.sketchId === document.cursor.sketchId
      : document.cursor.kind === 'feature' && item.kind === 'feature' && item.featureId === document.cursor.featureId,
  )
  if (cursorIndex < 0) {
    return document.cursor.kind === 'feature'
      ? new Set(document.features.map((feature) => feature.featureId))
      : new Set<string>()
  }

  return new Set(
    historyOrder
      .slice(0, cursorIndex + 1)
      .filter((item): item is Extract<(typeof historyOrder)[number], { kind: 'feature' }> => item.kind === 'feature')
      .map((item) => item.featureId),
  )
}

function getStepImportAsset(document: AuthoredModelDocument, parameters: StepImportFeatureParameters) {
  return document.assets.records.find((asset): asset is CadaraBrepAsset =>
    asset.assetId === parameters.assetId && isCadaraBrepAsset(asset),
  ) ?? null
}

function createStepImportBodyId(featureId: FeatureSnapshotRecord['featureId'], count: number, index: number) {
  return (count === 1
    ? `body_${featureId}`
    : `body_${featureId}_${index + 1}`) as BodyId
}

function createStepImportImportedBodies(
  feature: AuthoredModelDocument['features'][number],
  asset: CadaraBrepAsset,
) {
  const parameters = feature.definition.parameters as StepImportFeatureParameters
  const selectedByKey = new Map(parameters.selectedSolids?.map((selected) => [selected.solidKey, selected]) ?? [])
  const importedBodies = parameters.selectedSolids
    ? asset.data.bodies.filter((body) => body.solidKey && selectedByKey.has(body.solidKey))
    : asset.data.bodies

  return importedBodies.map((body, index) => {
    const selected = body.solidKey ? selectedByKey.get(body.solidKey) : undefined
    return {
      body,
      bodyId: createStepImportBodyId(feature.featureId, importedBodies.length, index),
      label: selected?.label ?? (importedBodies.length === 1 ? parameters.label : `${parameters.label} ${index + 1}`),
    }
  })
}

function hasRenderableCadaraBrepFaceGeometry(
  face: CadaraBrepFace,
) {
  return face.triangles.every((triangle) =>
    triangle.every((vertexIndex) =>
      Number.isInteger(vertexIndex)
      && vertexIndex >= 0
      && vertexIndex < face.meshVertices.length
      && face.meshVertices[vertexIndex] !== undefined,
    ),
  )
}

function createRenderableFaceMesh(
  bodyLabel: string,
  bodyId: BodyId,
  ownerFeatureId: FeatureSnapshotRecord['featureId'],
  faceIndex: number,
  face: CadaraBrepFace,
) {
  const target = {
    kind: 'face',
    bodyId,
    faceId: `face_${bodyId}_faceted_${faceIndex + 1}` as FaceId,
  } satisfies FaceRef
  const vertexPositions = face.meshVertices
  const triangleIndices = face.triangles
  const vertexNormals = createCadaraBrepFaceVertexNormals(face, vertexPositions)
  const geometry: RenderMeshGeometry = {
    kind: 'mesh',
    vertexPositions,
    vertexNormals,
    triangleIndices,
  }
  const semanticClass = face.surface.kind === 'plane' ? 'planarFace' : 'bodyFace'

  return {
    target,
    renderRecord: {
      id: `renderable_${target.faceId}` as RenderableId,
      label: `${bodyLabel} ${target.faceId}`,
      ownerBodyId: bodyId,
      ownerFeatureId,
      binding: {
        pickId: `pick_${target.faceId}` as PickId,
        pickPriority: 50,
        target,
        topology: 'face',
        semanticClass,
      },
      geometry,
    } satisfies RenderableEntityRecord,
    entity: {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId,
      ownerSketchId: null,
      ownerBodyId: bodyId,
      id: `entity_${target.faceId}` as SnapshotEntityId,
      label: `${bodyLabel} ${target.faceId}`,
      target,
      relatedTargets: [{ kind: 'body', bodyId } satisfies BodyRef],
      consumedByFeatureIds: [],
      selectionSemantics: semanticClass === 'planarFace' ? ['face', 'planarFace'] : ['face'],
    } satisfies SnapshotEntityRecord,
  }
}

function createCadaraBrepFaceVertexNormals(
  face: CadaraBrepFace,
  vertexPositions: readonly GeometryAssetPoint3[],
) {
  switch (face.surface.kind) {
    case 'bezier':
    case 'bSpline':
    case 'surfaceOfRevolution':
    case 'surfaceOfLinearExtrusion':
      return null
    default:
      return vertexPositions.map((position) => normalForCadaraBrepSurface(face, position))
  }
}

function normalForCadaraBrepSurface(
  face: CadaraBrepFace,
  position: GeometryAssetPoint3,
): GeometryAssetPoint3 {
  switch (face.surface.kind) {
    case 'plane':
      return normalizeVector(face.surface.frame.zDirection)
    case 'cylinder':
      return cylinderNormal(face.surface.frame, position)
    case 'cone':
      return coneNormal(face.surface.frame, position, face.surface.radius, face.surface.semiAngleRadians)
    case 'sphere':
      return sphereNormal(face.surface.frame.origin, position)
    case 'torus':
      return torusNormal(face.surface.frame, position, face.surface.majorRadius)
    case 'bezier':
    case 'bSpline':
    case 'surfaceOfRevolution':
    case 'surfaceOfLinearExtrusion':
      return [0, 0, 1]
  }
}

function cylinderNormal(frame: { origin: GeometryAssetPoint3; zDirection: GeometryAssetPoint3; xDirection: GeometryAssetPoint3 }, position: GeometryAssetPoint3) {
  const axisPoint = add(frame.origin, scale(frame.zDirection, dot(subtract(position, frame.origin), frame.zDirection)))
  return normalizeVector(subtract(position, axisPoint))
}

function coneNormal(
  frame: { origin: GeometryAssetPoint3; zDirection: GeometryAssetPoint3 },
  position: GeometryAssetPoint3,
  radius: number,
  semiAngleRadians: number,
) {
  if (Math.abs(semiAngleRadians) <= 1e-9 || radius <= 1e-9) {
    return normalizeVector(frame.zDirection)
  }
  const apex = subtract(frame.origin, scale(frame.zDirection, radius / Math.tan(semiAngleRadians)))
  const axisProjection = add(apex, scale(frame.zDirection, dot(subtract(position, apex), frame.zDirection)))
  const radial = normalizeVector(subtract(position, axisProjection))
  return normalizeVector(subtract(scale(radial, Math.cos(semiAngleRadians)), scale(frame.zDirection, Math.sin(semiAngleRadians))))
}

function sphereNormal(center: GeometryAssetPoint3, position: GeometryAssetPoint3) {
  return normalizeVector(subtract(position, center))
}

function torusNormal(
  frame: { origin: GeometryAssetPoint3; zDirection: GeometryAssetPoint3 },
  position: GeometryAssetPoint3,
  majorRadius: number,
) {
  const toPoint = subtract(position, frame.origin)
  const axisProjection = scale(frame.zDirection, dot(toPoint, frame.zDirection))
  const planar = subtract(toPoint, axisProjection)
  const ringDirection = normalizeVector(planar)
  const ringCenter = add(frame.origin, scale(ringDirection, majorRadius))
  return normalizeVector(subtract(position, ringCenter))
}

function add(left: GeometryAssetPoint3, right: GeometryAssetPoint3): GeometryAssetPoint3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function subtract(left: GeometryAssetPoint3, right: GeometryAssetPoint3): GeometryAssetPoint3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function scale(value: GeometryAssetPoint3, factor: number): GeometryAssetPoint3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function dot(left: GeometryAssetPoint3, right: GeometryAssetPoint3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function normalizeVector(value: GeometryAssetPoint3): GeometryAssetPoint3 {
  const length = Math.hypot(value[0], value[1], value[2])
  if (length <= 1e-12) {
    return [0, 0, 1]
  }
  return [value[0] / length, value[1] / length, value[2] / length]
}

function createStepImportMaterializationDiagnostic(status: StepImportMaterializationFeatureStatus) {
  const code = status.state === 'failed'
    ? 'step-import-materialization-failed'
    : status.state === 'degraded'
      ? 'step-import-materialization-timeout'
      : 'step-import-materialization-pending'
  const severity = status.state === 'pending' ? 'info' : 'warning'

  return createStepImportDiagnostic(
    code,
    status.message,
    {
      featureId: status.featureId,
      selectedFileName: status.rootFileName,
      severity,
      materializationState: status.state,
      materializationStage: status.currentStage,
      materializationTimeoutMs: status.timeoutMs,
      materializationElapsedMs: status.elapsedMs,
      stageDurationsMs: status.stageDurationsMs,
    },
  )
}

function uniqueDiagnostics(snapshot: WorkspaceSnapshot['document']['diagnostics']) {
  const seen = new Set<string>()
  return snapshot.filter((diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.featureId ?? ''}|${diagnostic.message}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function getStepImportMaterializationStageLabel(stage: StepImportMaterializationStage | null) {
  switch (stage) {
    case 'bridgePayload':
      return 'Preparing bridge payload'
    case 'occReadRestore':
      return 'Reading OCC bridge'
    case 'solidConstruction':
      return 'Constructing solids'
    case 'trackedBodySetup':
      return 'Tracking bodies'
    case 'topologyNaming':
      return 'Finalizing topology naming'
    case 'snapshotRender':
      return 'Refreshing snapshot'
    default:
      return 'Queued'
  }
}

export function augmentWorkspaceSnapshotWithStepImportPresentation(
  snapshot: WorkspaceSnapshot,
  document: AuthoredModelDocument,
  materializationStatus: StepImportMaterializationStatus | null,
) {
  const appliedFeatureIds = createAppliedFeatureIds(document)
  const bodyRecords = [...snapshot.document.bodies]
  const objectRecords = [...snapshot.presentation.objects]
  const entities = [...snapshot.presentation.entities]
  const renderRecords = [...snapshot.document.render.records]
  const features = snapshot.document.features.map((feature) => ({ ...feature, producedTargets: [...feature.producedTargets] }))
  const provisionalDiagnostics = [...snapshot.document.diagnostics]
  let augmented = false

  for (const feature of document.features) {
    if (feature.definition.kind !== 'stepImport' || !appliedFeatureIds.has(feature.featureId)) {
      continue
    }

    if (bodyRecords.some((body) => body.ownerFeatureId === feature.featureId)) {
      continue
    }

    const asset = getStepImportAsset(document, feature.definition.parameters)
    if (!asset) {
      continue
    }

    const importedBodies = createStepImportImportedBodies(feature, asset)
    if (importedBodies.length === 0) {
      continue
    }

    const featureSnapshot = features.find((entry) => entry.featureId === feature.featureId)
    const nextProducedTargets = featureSnapshot?.producedTargets ?? []
    let featureHasInvalidFacetedGeometry = false
    for (const importedBody of importedBodies) {
      if (importedBody.body.topology.faces.some((face) => !hasRenderableCadaraBrepFaceGeometry(face))) {
        featureHasInvalidFacetedGeometry = true
        continue
      }

      const bodyTarget = { kind: 'body', bodyId: importedBody.bodyId } satisfies BodyRef
      const bodyFaceIds: FaceId[] = []

      bodyRecords.push({
        ownerDocumentId: snapshot.document.documentId,
        ownerRevisionId: snapshot.document.revisionId,
        ownerFeatureId: feature.featureId,
        ownerSketchId: null,
        ownerBodyId: importedBody.bodyId,
        bodyId: importedBody.bodyId,
        label: importedBody.label,
        topology: {
          faceIds: bodyFaceIds,
          edgeIds: [],
          vertexIds: [],
        },
      } satisfies BodySnapshotRecord)
      objectRecords.push({
        id: `object_body_${importedBody.bodyId}` as ObjectTreeNodeId,
        label: importedBody.label,
        description: 'Imported body (faceted presentation)',
        kind: 'body',
        target: bodyTarget,
        ownerBodyId: importedBody.bodyId,
        ownerFeatureId: feature.featureId,
        ownerSketchId: null,
      } satisfies ObjectTreeNodeRecord)
      entities.push({
        ownerDocumentId: snapshot.document.documentId,
        ownerRevisionId: snapshot.document.revisionId,
        ownerFeatureId: feature.featureId,
        ownerSketchId: null,
        ownerBodyId: importedBody.bodyId,
        id: `entity_body_${importedBody.bodyId}` as SnapshotEntityId,
        label: importedBody.label,
        target: bodyTarget,
        relatedTargets: [],
        consumedByFeatureIds: [],
        selectionSemantics: ['body'],
      } satisfies SnapshotEntityRecord)
      nextProducedTargets.push(bodyTarget)

      for (const [faceIndex, face] of importedBody.body.topology.faces.entries()) {
        const { target, renderRecord, entity } = createRenderableFaceMesh(
          importedBody.label,
          importedBody.bodyId,
          feature.featureId,
          faceIndex,
          face,
        )
        bodyFaceIds.push(target.faceId)
        renderRecords.push(renderRecord)
        entities.push({
          ...entity,
          ownerDocumentId: snapshot.document.documentId,
          ownerRevisionId: snapshot.document.revisionId,
        })
        nextProducedTargets.push(target)
      }

      augmented = true
    }

    if (featureHasInvalidFacetedGeometry) {
      provisionalDiagnostics.push(createStepImportDiagnostic(
        'step-import-unreadable-file',
        `${feature.label}: persisted faceted STEP presentation is corrupt and could not be rendered before OCC materialization.`,
        {
          asset,
          featureId: feature.featureId,
          selectedFileName: asset.provenance.selectedFileName,
          sourceName: asset.provenance.sourceName,
        },
      ))
    }

    if (featureSnapshot) {
      featureSnapshot.producedTargets = nextProducedTargets
    }
  }

  const materializationDiagnostics = materializationStatus?.features.map(createStepImportMaterializationDiagnostic) ?? []
  if (!augmented && materializationDiagnostics.length === 0) {
    return snapshot
  }

  const nextDocument = {
    ...snapshot.document,
    bodies: bodyRecords,
    features,
    objects: objectRecords,
    entities,
    diagnostics: uniqueDiagnostics([...provisionalDiagnostics, ...materializationDiagnostics]),
    render: {
      ...snapshot.document.render,
      records: renderRecords,
    },
  }
  const nextPresentation = {
    ...snapshot.presentation,
    objects: objectRecords,
    entities,
  }

  return {
    ...snapshot,
    document: nextDocument,
    presentation: nextPresentation,
    bodies: nextDocument.bodies,
    features: nextDocument.features,
    objects: nextPresentation.objects,
    entities: nextPresentation.entities,
    diagnostics: nextDocument.diagnostics,
    render: nextDocument.render,
  } satisfies WorkspaceSnapshot
}
