import type { AppError } from '@/contracts/errors'
import type { EditorEvent } from '@/contracts/editor/state-machine'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { SketchId } from '@/contracts/shared/ids'
import {
  appendReferenceImageOperations,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import type { ModelingService, ModelingCommitSketchResult } from '@/domain/modeling/modeling-service'
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

export async function runSketchImageImportFlow(input: {
  session: SketchSessionState
  snapshot: DocumentSnapshot
  modelingService: Pick<ModelingService, 'commitSketch' | 'getCurrentDocumentSnapshot'>
  pickFiles?: (input: {
    acceptedFileTypes: typeof supportedReferenceImageFileTypes
    multiple?: boolean
  }) => Promise<ImportFilePickerResult>
  readPayload?: (file: File) => Promise<ReferenceImagePayload>
}): Promise<SketchImageImportFlowResult> {
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

  let payloads: ReferenceImagePayload[]
  try {
    payloads = await Promise.all(pickerResult.files.map((file) => readPayload(file)))
  } catch (error: unknown) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Reference-image import failed.',
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

  const result = await input.modelingService.commitSketch({
    baseRevisionId: input.snapshot.document.revisionId,
    ...commitRequest,
  })

  if (result.isErr()) {
    return {
      kind: 'failed',
      message: result.error.message,
      error: result.error,
    }
  }

  if (result.value.revisionState.kind !== 'accepted') {
    return {
      kind: 'failed',
      message: 'Reference-image import failed.',
    }
  }

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
