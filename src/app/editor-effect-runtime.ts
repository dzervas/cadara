import {
  createModelingServiceEditorEffectRuntime,
  type EditorEffectRuntime,
} from '@/contracts/editor/state-machine'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import type { ModelingService } from '@/domain/modeling/modeling-service'
import { supportedReferenceImageFileTypes } from '@/domain/reference-image/raster'
import { showOpenImportFilePicker } from '@/lib/import-file-picker'

import {
  readReferenceImagePayload,
  runSketchImageImportFlow,
} from '@/app/sketch-image-import-flow'

async function pickReferenceImagePayload(): Promise<ReferenceImagePayload | null> {
  const pickerResult = await showOpenImportFilePicker({
    acceptedFileTypes: supportedReferenceImageFileTypes,
  })

  if (!pickerResult.ok) {
    if (pickerResult.reason === 'failed') {
      throw new Error('Reference-image selection failed.')
    }
    return null
  }

  const file = pickerResult.files[0]
  return file ? readReferenceImagePayload(file) : null
}

async function runSketchSpecialModeAppEffect(input: {
  effectId: string
  kind: string
}): Promise<{
  effectId: string
  payload: Record<string, unknown>
}> {
  switch (input.kind) {
    case 'reference-image-replace-image': {
      const image = await pickReferenceImagePayload()
      return {
        effectId: input.effectId,
        payload: image ? { image } : {},
      }
    }
    default:
      throw new Error(`No sketch special mode effect runtime is registered for ${input.kind}.`)
  }
}

export function createAppEditorEffectRuntime(
  modelingService: ModelingService,
): EditorEffectRuntime {
  const baseRuntime = createModelingServiceEditorEffectRuntime(modelingService)

  return {
    ...baseRuntime,
    async importSketchReferenceImages(input) {
      const snapshot = await modelingService.getCurrentDocumentSnapshot()
      const result = await runSketchImageImportFlow({
        requestId: input.requestId,
        baseRevisionId: input.baseRevisionId,
        baseRepositoryHeads: input.baseRepositoryHeads,
        session: input.session,
        snapshot,
        modelingService,
        payloads: input.payloads,
      })

      if (result.kind === 'cancelled') {
        return {
          status: 'cancelled',
          revisionId: input.baseRevisionId,
        }
      }

      if (result.kind === 'failed') {
        throw result.error ?? new Error(result.message)
      }

      const session = openSketchSessionFromSelection([{
        kind: 'sketch',
        sketchId: result.sketchId,
      }], result.snapshot)
      if (!session) {
        throw new Error(`Sketch ${result.sketchId} could not be reopened after importing reference images.`)
      }

      return {
        status: 'committed',
        revisionId: result.snapshot.document.revisionId,
        snapshot: result.snapshot,
        selectionCatalog: buildSelectionTargetCatalog(result.snapshot),
        session,
        importedCount: result.payloads.length,
      }
    },
    async runSketchSpecialModeEffect(input) {
      return runSketchSpecialModeAppEffect({
        effectId: input.effectId,
        kind: input.kind,
      })
    },
  }
}
