import type { ImportCapabilities } from '@/contracts/import/capabilities'
import type { ImportPreparedActions } from '@/contracts/import/actions'
import type { ImportProvider } from '@/contracts/import/provider'
import type { ImportResult } from '@/contracts/import/result'
import type { ImportReviewEnvelope } from '@/contracts/import/review'
import type { ResolvedImportSource } from '@/contracts/import/source'
import type { ModelingDiagnostic, DocumentSnapshot } from '@/contracts/modeling/schema'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { hashGeometryAssetBytes } from '@/domain/modeling/geometry-asset-store'
import { registerEmbeddedBinaryAsset } from '@/domain/modeling/embedded-binary-asset-registry'
import type { ModelingService } from '@/domain/modeling/modeling-service'

export async function resolveLocalFileImportSource(file: File): Promise<ResolvedImportSource> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const fingerprint = await hashGeometryAssetBytes(bytes)

  return {
    name: file.name,
    origin: {
      kind: 'localFile',
      fileName: file.name,
    },
    mediaType: file.type.trim().length > 0 ? file.type : null,
    bytes,
    fingerprint,
  }
}

export function createImportCapabilities(
  _modelingService: ModelingService,
  snapshot: DocumentSnapshot,
): ImportCapabilities {
  return {
    context: {
      contractVersion: CONTRACT_VERSION,
      documentId: snapshot.documentId,
      baseRevisionId: snapshot.revisionId,
    },
    modeling: {
      async bakeGeometry() {
        throw new Error('Geometry import baking is not implemented yet.')
      },
      async reconstructMeshToBrep() {
        throw new Error('Mesh-to-B-rep reconstruction is not implemented yet.')
      },
    },
    sketch: {
      async convertVectorToSketch() {
        throw new Error('Vector-to-sketch conversion is not implemented yet.')
      },
    },
    assets: {
      async registerGeometryAsset() {
        throw new Error('Geometry asset registration is not implemented yet.')
      },
      async storeEmbeddedBinary(input) {
        const hash = await hashGeometryAssetBytes(input.bytes)
        const assetId = `asset_embedded_${hash.slice('sha256:'.length, 'sha256:'.length + 16)}`
        registerEmbeddedBinaryAsset({
          assetId,
          bytes: input.bytes,
          mediaType: input.mediaType,
        })
        return assetId
      },
    },
  }
}

export function toImportModelingDiagnostics(
  diagnostics: readonly { severity: ModelingDiagnostic['severity']; message: string; code?: string }[],
): ModelingDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code ?? 'import-diagnostic',
    severity: diagnostic.severity,
    message: diagnostic.message,
    target: null,
    detail: null,
  }))
}

export async function createImportSession(input: {
  provider: ImportProvider<unknown, unknown>
  source: ResolvedImportSource
  capabilities: ImportCapabilities
}) {
  const review = await input.provider.review({
    source: input.source,
    capabilities: input.capabilities,
  })
  const selections = input.provider.createDefaultSelections(review)

  return {
    providerId: input.provider.id,
    resolvedSource: input.source,
    review,
    selections,
    formSchema: input.provider.getReviewFormSchema(review, selections),
    diagnostics: [],
  }
}

export async function applyImportPreparedActions(input: {
  modelingService: ModelingService
  baseRevisionId: DocumentSnapshot['revisionId']
  actions: ImportPreparedActions
}) {
  let revisionId = input.baseRevisionId
  const diagnostics: ModelingDiagnostic[] = [...toImportModelingDiagnostics(input.actions.diagnostics ?? [])]
  const createdEntityIds: ImportResult['createdEntityIds'] = {
    featureIds: [],
    sketchIds: [],
    variableIds: [],
  }

  for (const request of input.actions.addDocumentVariables ?? []) {
    const result = await input.modelingService.addDocumentVariable({
      ...request,
      baseRevisionId: revisionId,
    })

    if (result.isErr()) {
      throw result.error
    }

    revisionId = result.value.revisionId
    createdEntityIds.variableIds.push(result.value.variableId)
    diagnostics.push(...result.value.diagnostics)
  }

  for (const request of input.actions.createFeatures ?? []) {
    const result = await input.modelingService.createFeature({
      ...request,
      baseRevisionId: revisionId,
    })

    if (result.isErr()) {
      throw result.error
    }

    revisionId = result.value.revisionId
    createdEntityIds.featureIds.push(result.value.featureId)
    diagnostics.push(...result.value.diagnostics)
  }

  for (const request of input.actions.commitSketches ?? []) {
    const result = await input.modelingService.commitSketch({
      ...request,
      baseRevisionId: revisionId,
    })

    if (result.isErr()) {
      throw result.error
    }

    revisionId = result.value.revisionId
    createdEntityIds.sketchIds.push(result.value.sketchId)
    diagnostics.push(...result.value.diagnostics)
  }

  return {
    revisionId,
    createdEntityIds,
    diagnostics,
  }
}

export async function prepareImportActions<TReview, TSelections>(input: {
  provider: ImportProvider<TReview, TSelections>
  source: ResolvedImportSource
  review: ImportReviewEnvelope<TReview>
  selections: TSelections
  capabilities: ImportCapabilities
}) {
  return input.provider.prepare({
    source: input.source,
    review: input.review,
    selections: input.selections,
    capabilities: input.capabilities,
  })
}
