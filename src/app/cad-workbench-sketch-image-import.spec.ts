import { test } from 'bun:test'

import { runSketchImageImportFlow } from '@/app/sketch-image-import-flow'
import { ResultAsync, createAppError } from '@/contracts/errors'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import { createSketchSessionFromSnapshot } from '@/domain/editor/sketch-session'
import { createModelingService, type ModelingCommitSketchInput, type ModelingService } from '@/domain/modeling/modeling-service'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/app/cad-workbench-sketch-image-import.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const seedService = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: 'doc_workspace',
  })
  const snapshot = await seedService.getCurrentDocumentSnapshot()
  const sourceSketch = snapshot.sketches[0]
  assert(sourceSketch, 'Seed sketch should exist for sketch image-import coverage.')

  const session = createSketchSessionFromSnapshot(sourceSketch)
  assert(session.commitRequest, 'Active sketch sessions should expose a commit request.')

  const expectedPayload: ReferenceImagePayload = {
    mediaType: 'image/png',
    fileName: 'reference.png',
    pixelWidth: 640,
    pixelHeight: 480,
    base64Data: 'cG5n',
  }
  const callOrder: string[] = []
  const pickerCalls: Array<{
    multiple?: boolean
    acceptedFileTypes: ReadonlyArray<{ extension: string; mediaType: string }>
  }> = []
  let capturedCommitInput: ModelingCommitSketchInput | null = null

  const wrappedModelingService: Pick<ModelingService, 'commitSketch' | 'getCurrentDocumentSnapshot'> = {
    commitSketch(input) {
      callOrder.push('commitSketch')
      capturedCommitInput = input
      return ResultAsync.fromPromise(Promise.resolve({
        revisionId: 'rev_0002',
        sketchId: input.sketchId ?? sourceSketch.sketchId,
        revisionState: { kind: 'accepted' as const },
        rebuildResult: 'reused' as const,
        changedTargets: [],
        diagnostics: [],
      }), (error) => createAppError({
        code: 'test/commit-sketch',
        message: String(error),
      }))
    },
    getCurrentDocumentSnapshot() {
      callOrder.push('getCurrentDocumentSnapshot')
      assert(capturedCommitInput, 'Committed sketch input should exist before refreshing the snapshot.')
      const nextSketches = snapshot.document.sketches.map((sketch) =>
        sketch.sketchId === sourceSketch.sketchId
          ? {
            ...sketch,
            sketch: {
              ...sketch.sketch,
              definition: capturedCommitInput.definition,
            },
          }
          : sketch,
      )

      return Promise.resolve({
        ...snapshot,
        revisionId: 'rev_0002',
        sketches: nextSketches,
        document: {
          ...snapshot.document,
          revisionId: 'rev_0002',
          sketches: nextSketches,
        },
      })
    },
  }

  const result = await runSketchImageImportFlow({
    session,
    snapshot,
    modelingService: wrappedModelingService,
    pickFiles: async (input) => {
      callOrder.push('pickFiles')
      pickerCalls.push(input)
      return {
        ok: true,
        files: [new File(['png'], 'reference.png', { type: 'image/png' })],
      }
    },
    readPayload: async () => {
      callOrder.push('readPayload')
      return expectedPayload
    },
  })

  assert(
    pickerCalls[0]?.multiple === true && pickerCalls[0]?.acceptedFileTypes.length > 0,
    'Sketch image import should open the direct reference-image picker with multi-file support.',
  )
  const pickFilesIndex = callOrder.indexOf('pickFiles')
  const readPayloadIndex = callOrder.indexOf('readPayload')
  const commitSketchIndex = callOrder.indexOf('commitSketch')
  const snapshotRefreshIndex = callOrder.indexOf('getCurrentDocumentSnapshot')
  assert(
    pickFilesIndex === 0
      && readPayloadIndex > pickFilesIndex
      && commitSketchIndex > readPayloadIndex
      && snapshotRefreshIndex > commitSketchIndex,
    'Sketch image import should read inline payloads, commit the sketch, then refresh the snapshot.',
  )
  assert(result.kind === 'committed', 'Sketch image import should commit accepted inline reference images.')
  assert(capturedCommitInput, 'Sketch image import should commit through modelingService.commitSketch.')
  const committedInput = capturedCommitInput

  const baselineDefinition = session.commitRequest.definition
  assert(
    committedInput.definition.pointIds.length === baselineDefinition.pointIds.length
      && committedInput.definition.entityIds.length === baselineDefinition.entityIds.length
      && committedInput.definition.constraintIds.length === baselineDefinition.constraintIds.length
      && committedInput.definition.dimensionIds.length === baselineDefinition.dimensionIds.length,
    'Sketch image import should not route through sketch point/entity/constraint materialization.',
  )

  const importedOperation = committedInput.definition.authoringOperations?.find((operation) => operation.kind === 'referenceImage')
  assert(
    importedOperation?.kind === 'referenceImage',
    'Sketch image import should commit a reference-image authoring operation in the sketch payload.',
  )
  assert(
    JSON.stringify(importedOperation) === JSON.stringify({
      operationId: importedOperation?.operationId,
      label: 'reference.png',
      kind: 'referenceImage',
      targets: {
        created: [{
          kind: 'operation',
          operationId: importedOperation?.operationId,
        }],
      },
      ownedState: {
        kind: 'referenceImage',
        image: expectedPayload,
        placement: {
          center: [0, 0],
          width: 200,
          height: 150,
          rotationRadians: 0,
        },
      },
    }),
    'Sketch image import should commit the full inline reference-image payload and centered placement state.',
  )
  assert(
    result.reopenRequest.type === 'authoring.reopenRequested'
      && result.reopenRequest.target.kind === 'sketch'
      && result.reopenRequest.target.sketchId === result.sketchId
      && result.reopenRequest.toolId === 'sketch',
    'Sketch image import should return the sketch reopen request needed to keep the editor in sketch mode after commit.',
  )
  assert(
    result.snapshot.sketches.some((sketch) =>
      sketch.sketchId === result.sketchId
        && sketch.sketch.definition.authoringOperations?.some((operation) =>
          operation.kind === 'referenceImage'
          && operation.ownedState?.kind === 'referenceImage'
          && operation.ownedState.image.base64Data === expectedPayload.base64Data,
        ),
    ),
    'Sketch image import should refresh to a snapshot that preserves the committed inline reference-image payload.',
  )
})
