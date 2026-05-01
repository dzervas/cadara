import { test } from 'bun:test'

import { createWorkbenchDocumentOwner } from '@/application/workbench/document-owner'
import { ok } from '@/contracts/errors'
import type { EditorEvent, EditorState } from '@/domain/editor/state-machine'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'
import type {
  ModelingCommitSketchCorrelation,
  ModelingService,
} from '@/domain/modeling/modeling-service'

test('src/application/workbench/document-owner.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  const machineState = { snapshot } as EditorState
  const dispatched: EditorEvent[] = []
  const nextSnapshot = await createSeedDocumentSnapshot()

  {
    const addCalls: Array<{ baseRevisionId: string; name: string; valueText: string }> = []
    const modelingService = {
      currentDocumentId: snapshot.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        return nextSnapshot
      },
      async addDocumentVariable(input) {
        addCalls.push(input)
        return ok({
          revisionState: { kind: 'accepted' as const },
          diagnostics: [],
        })
      },
    } as unknown as ModelingService

    const owner = createWorkbenchDocumentOwner({
      machineState,
      dispatch: (event) => dispatched.push(event),
      modelingService,
      runtimeExtensionRegistries: {
        importProviders: { getById: () => null },
      } as never,
    })

    const result = await owner.addDocumentVariable({
      operation: 'Add variable',
      fallbackMessage: 'Add variable failed.',
    })

    assert(result.isOk(), 'Accepted variable mutations should resolve successfully through the document owner seam.')
    assert(
      addCalls[0]?.baseRevisionId === snapshot.document.revisionId
        && addCalls[0]?.name === `var${snapshot.document.variables.length + 1}`
        && addCalls[0]?.valueText === '0',
      'Document owner should derive variable mutations from the active snapshot revision and default naming rules.',
    )
    assert(
      dispatched[0]?.type === 'document.snapshotLoaded' && dispatched[0].snapshot === nextSnapshot,
      'Accepted variable mutations should refresh and dispatch the next snapshot through the editor event seam.',
    )
  }

  {
    const sketch = snapshot.document.sketches[0]
    assert(sketch, 'Seed snapshot should expose a sketch for rename orchestration coverage.')

    const correlations: ModelingCommitSketchCorrelation[] = []
    const commitCalls: Array<{ sketchId: string; sketchLabel: string; solverCorrelation: ModelingCommitSketchCorrelation | null }> = []
    const modelingService = {
      currentDocumentId: snapshot.documentId,
      sketchSolver: {
        createCommitCorrelation(requestId) {
          const correlation = {
            requestId,
            projectionRequestId: `${requestId}_project`,
            validationRequestId: `${requestId}_validate`,
            solveRequestId: `${requestId}_solve`,
            regionRequestId: `${requestId}_regions`,
          } as ModelingCommitSketchCorrelation
          correlations.push(correlation)
          return correlation
        },
      },
      async getCurrentDocumentSnapshot() {
        return nextSnapshot
      },
      async commitSketch(input) {
        commitCalls.push({
          sketchId: input.sketchId,
          sketchLabel: input.sketchLabel,
          solverCorrelation: input.solverCorrelation,
        })
        return ok({
          revisionState: { kind: 'accepted' as const },
          diagnostics: [],
        })
      },
    } as unknown as ModelingService

    const owner = createWorkbenchDocumentOwner({
      machineState,
      dispatch: (event) => dispatched.push(event),
      modelingService,
      runtimeExtensionRegistries: {
        importProviders: { getById: () => null },
      } as never,
    })

    const result = await owner.renameTarget(
      { kind: 'sketch', sketchId: sketch.sketchId },
      'Renamed sketch',
      { operation: 'Rename sketch', fallbackMessage: 'Rename sketch failed.' },
    )

    assert(result.isOk(), 'Accepted sketch renames should resolve successfully through the document owner seam.')
    assert(
      commitCalls[0]?.sketchId === sketch.sketchId
        && commitCalls[0]?.sketchLabel === 'Renamed sketch'
        && commitCalls[0]?.solverCorrelation === correlations[0],
      'Sketch renames should hand the selected sketch and solver correlation through the modeling-service port.',
    )
  }

  {
    const modelingService = {
      currentDocumentId: snapshot.documentId,
      sketchSolver: null,
      async getCurrentDocumentSnapshot() {
        throw new Error('Rejected mutations should not refresh the snapshot.')
      },
      async addDocumentVariable() {
        return ok({
          revisionState: { kind: 'rejected' as const, reasonCode: 'invalid-variable' },
          diagnostics: [{
            code: 'document-variable-invalid-value',
            severity: 'error' as const,
            message: 'Variable expressions must stay valid.',
            target: null,
            detail: null,
          }],
        })
      },
    } as unknown as ModelingService

    const owner = createWorkbenchDocumentOwner({
      machineState,
      dispatch: (event) => dispatched.push(event),
      modelingService,
      runtimeExtensionRegistries: {
        importProviders: { getById: () => null },
      } as never,
    })

    const dispatchCount = dispatched.length
    const result = await owner.addDocumentVariable({
      operation: 'Add variable',
      fallbackMessage: 'Add variable failed.',
    })

    assert(result.isErr(), 'Rejected modeling results should propagate as workbench errors through the document owner seam.')
    assert(
      dispatched.length === dispatchCount,
      'Rejected mutations should not dispatch a replacement snapshot when the modeling layer rejects the request.',
    )
  }
})
