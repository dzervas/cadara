import type { AppError } from '@/contracts/errors'
import type { EditorEvent } from '@/contracts/editor/state-machine'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { RequestId, RevisionId, SketchId } from '@/contracts/shared/ids'
import {
  appendReferenceImageOperations,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import type {
  ModelingCommitSketchCorrelation,
  ModelingCommitSketchResult,
  ModelingService,
} from '@/domain/modeling/modeling-service'
import { createReferenceImageOperation } from '@/domain/reference-image/operations'
import {
  encodeBytesToBase64,
  inferReferenceImageMediaType,
  readRasterImageDimensions,
  supportedReferenceImageFileTypes,
} from '@/domain/reference-image/raster'
import {
  showOpenImportFilePicker,
  type ImportFilePickerResult,
} from '@/lib/import-file-picker'

export async function readReferenceImagePayload(file: File): Promise<ReferenceImagePayload> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { width, height } = readRasterImageDimensions(bytes)
  const mediaType = file.type.trim() || inferReferenceImageMediaType(file.name)

  if (!mediaType) {
    throw new Error(`Unsupported reference image type for ${file.name}.`)
  }

  return {
    mediaType,
    fileName: file.name.trim() || undefined,
    pixelWidth: width,
    pixelHeight: height,
    base64Data: encodeBytesToBase64(bytes),
  }
}

export type SketchImageImportFlowResult =
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string; error?: AppError }
  | {
      kind: 'committed'
      payloads: readonly ReferenceImagePayload[]
      sketchId: SketchId
      snapshot: DocumentSnapshot
      commitResult: ModelingCommitSketchResult
      reopenRequest: Extract<EditorEvent, { type: 'authoring.reopenRequested' }>
    }

type SketchImageImportCommitInput = NonNullable<SketchSessionState['commitRequest']> & {
  requestId: RequestId
  baseRevisionId: RevisionId
  baseRepositoryHeads?: readonly string[]
  solverCorrelation: ModelingCommitSketchCorrelation | null
}

type SketchImageImportModelingService = Pick<ModelingService, 'getCurrentDocumentSnapshot' | 'sketchSolver'> & {
  commitSketch(input: SketchImageImportCommitInput): ReturnType<ModelingService['commitSketch']>
}

function resolveSketchImageImportCommitBasis(input: {
  snapshot: DocumentSnapshot
  baseRevisionId?: RevisionId
  baseRepositoryHeads?: readonly string[]
}) {
  if (
    input.baseRevisionId !== undefined
    && input.baseRevisionId === input.snapshot.document.revisionId
  ) {
    return {
      baseRevisionId: input.baseRevisionId,
      baseRepositoryHeads: input.baseRepositoryHeads ?? input.snapshot.provenance?.repositoryHeads,
    }
  }

  return {
    baseRevisionId: input.snapshot.document.revisionId,
    baseRepositoryHeads: input.snapshot.provenance?.repositoryHeads,
  }
}

function getSketchImageImportFailureMessage(result: ModelingCommitSketchResult) {
  return result.diagnostics[0]?.message ?? 'Reference-image import failed.'
}

export async function runSketchImageImportFlow(input: {
  requestId?: RequestId
  baseRevisionId?: RevisionId
  baseRepositoryHeads?: readonly string[]
  session: SketchSessionState
  snapshot: DocumentSnapshot
  modelingService: SketchImageImportModelingService
  payloads?: readonly ReferenceImagePayload[]
  pickFiles?: (input: {
    acceptedFileTypes: typeof supportedReferenceImageFileTypes
    multiple?: boolean
  }) => Promise<ImportFilePickerResult>
  readPayload?: (file: File) => Promise<ReferenceImagePayload>
}): Promise<SketchImageImportFlowResult> {
  const requestId = input.requestId ?? ('request_sketch-reference-image-import' as RequestId)
  let payloads: readonly ReferenceImagePayload[]
  if (input.payloads) {
    payloads = input.payloads
  } else {
    const pickFiles = input.pickFiles ?? showOpenImportFilePicker
    const readPayload = input.readPayload ?? readReferenceImagePayload
    const pickerResult = await pickFiles({
      acceptedFileTypes: supportedReferenceImageFileTypes,
      multiple: true,
    })

    if (!pickerResult.ok) {
      return pickerResult.reason === 'failed'
        ? { kind: 'failed', message: 'Reference-image selection failed.' }
        : { kind: 'cancelled' }
    }

    if (pickerResult.files.length === 0) {
      return { kind: 'cancelled' }
    }

    try {
      payloads = await Promise.all(pickerResult.files.map((file) => readPayload(file)))
    } catch (error: unknown) {
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Reference-image import failed.',
      }
    }
  }

  const sketchId = (input.session.sketchId ?? 'sketch_draft') as SketchId
  const nextSession = appendReferenceImageOperations(
    input.session,
    payloads.map((payload, index) => createReferenceImageOperation({
      sequence: input.session.sequence + index + 1,
      sketchId,
      payload,
    })),
  )
  const commitRequest = nextSession.commitRequest

  if (!commitRequest) {
    return {
      kind: 'failed',
      message: 'The active sketch could not be committed.',
    }
  }

  let snapshot = input.snapshot
  let commitBasis = resolveSketchImageImportCommitBasis({
    snapshot,
    baseRevisionId: input.baseRevisionId,
    baseRepositoryHeads: input.baseRepositoryHeads,
  })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await input.modelingService.commitSketch({
      requestId,
      baseRevisionId: commitBasis.baseRevisionId,
      baseRepositoryHeads: commitBasis.baseRepositoryHeads,
      ...commitRequest,
      solverCorrelation: input.modelingService.sketchSolver
        ? input.modelingService.sketchSolver.createCommitCorrelation(requestId)
        : null,
    })

    if (result.isErr()) {
      return {
        kind: 'failed',
        message: result.error.message,
        error: result.error,
      }
    }

    if (result.value.revisionState.kind === 'accepted') {
      return {
        kind: 'committed',
        payloads,
        sketchId: result.value.sketchId,
        snapshot: await input.modelingService.getCurrentDocumentSnapshot(),
        commitResult: result.value,
        reopenRequest: {
          type: 'authoring.reopenRequested',
          target: {
            kind: 'sketch',
            sketchId: result.value.sketchId,
          },
          toolId: 'sketch',
        },
      }
    }

    if (result.value.revisionState.kind !== 'conflict' || attempt === 1) {
      return {
        kind: 'failed',
        message: getSketchImageImportFailureMessage(result.value),
      }
    }

    snapshot = await input.modelingService.getCurrentDocumentSnapshot()
    commitBasis = resolveSketchImageImportCommitBasis({ snapshot })
  }

  return {
    kind: 'failed',
    message: 'Reference-image import failed.',
  }
}
