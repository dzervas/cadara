import { test } from 'bun:test'

import type { EditorEffectRuntime, EditorState } from '@/contracts/editor/state-machine'
import {
  createEditorRuntimeActor,
  getEditorRuntimeState,
  type EditorRuntimeActor,
} from '@/contracts/editor/runtime-machine'
import { createTestErrorReporter } from '@/contracts/errors'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/contracts/editor/runtime-machine.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function waitForState(
    actor: EditorRuntimeActor,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = getEditorRuntimeState(actor)

    if (predicate(current)) {
      return Promise.resolve(current)
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe()
        reject(new Error('Timed out waiting for editor runtime state.'))
      }, 2_000)
      const subscription = actor.subscribe(() => {
        const state = getEditorRuntimeState(actor)

        if (!predicate(state)) {
          return
        }

        clearTimeout(timeoutId)
        subscription.unsubscribe()
        resolve(state)
      })
    })
  }

  const adapter = new MockKernelAdapter()
  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      return (await adapter.getDocumentSnapshot({
        contractVersion: 'modeling-contract/v1alpha1',
        documentId: 'doc_workspace',
      })).snapshot
    },
    async commitSketch() {
      return null
    },
    async evaluatePreview() {
      throw new Error('Feature preview is not used by this test.')
    },
    async commitFeature() {
      throw new Error('Feature commit is not used by this test.')
    },
  }
  const actor = createEditorRuntimeActor(runtime)

  actor.start()

  try {
    await waitForState(actor, (state) => state.document.revisionId !== null)

    actor.send({ type: 'tool.activated', toolId: 'sketch' })
    actor.send({
      type: 'viewport.selectionRequested',
      target: { kind: 'construction', constructionId: 'construction_plane-xy' },
    })
    await waitForState(actor, (state) => state.kind === 'editingSketch')

    actor.send({ type: 'tool.activated', toolId: 'line' })
    actor.send({ type: 'sketch.pointerReleased', point: [0, 0] })
    actor.send({ type: 'sketch.pointerReleased', point: [1, 0.3] })

    const beforeDrag = getEditorRuntimeState(actor)
    assert(beforeDrag.kind === 'editingSketch', 'Expected active sketch session before drag.')
    const point = beforeDrag.session.definition.points[0]
    assert(point, 'Expected a point to drag after drawing a line.')

    actor.send({ type: 'sketch.geometryDragStarted', target: point.target, point: point.position })
    actor.send({ type: 'sketch.geometryDragMoved', point: [2, 3] })
    actor.send({ type: 'sketch.geometryDragEnded', point: [2, 3] })

    const afterDrag = getEditorRuntimeState(actor)
    assert(afterDrag.kind === 'editingSketch', 'Expected sketch session to remain active after drag.')

    const movedPoint = afterDrag.session.definition.points.find((entry) => entry.pointId === point.pointId)
    assert(movedPoint, 'Expected dragged point to remain in the sketch definition.')
    assert(movedPoint.position[0] === 2, 'Runtime should forward geometry drag move events to the editor reducer.')
    assert(movedPoint.position[1] === 3, 'Runtime should forward geometry drag end events to the editor reducer.')
  } finally {
    actor.stop()
  }
})

test('src/contracts/editor/runtime-machine.spec.ts reports escaped effect invocation failures', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function waitForState(
    actor: EditorRuntimeActor,
    predicate: (state: EditorState) => boolean,
  ): Promise<EditorState> {
    const current = getEditorRuntimeState(actor)

    if (predicate(current)) {
      return Promise.resolve(current)
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        subscription.unsubscribe()
        reject(new Error('Timed out waiting for editor runtime state.'))
      }, 2_000)
      const subscription = actor.subscribe(() => {
        const state = getEditorRuntimeState(actor)

        if (!predicate(state)) {
          return
        }

        clearTimeout(timeoutId)
        subscription.unsubscribe()
        resolve(state)
      })
    })
  }

  const runtime: EditorEffectRuntime = {
    async getCurrentDocumentSnapshot() {
      throw new Error('Snapshot fetch should be replaced by the rejected effect runner.')
    },
    async commitSketch() {
      return null
    },
    async evaluatePreview() {
      throw new Error('Feature preview is not used by this test.')
    },
    async commitFeature() {
      throw new Error('Feature commit is not used by this test.')
    },
  }
  const reporter = createTestErrorReporter()
  const actor = createEditorRuntimeActor(
    runtime,
    reporter,
    async () => {
      throw new Error('Actor invocation escaped.')
    },
  )

  actor.start()

  try {
    const state = await waitForState(actor, (candidate) => candidate.pendingSnapshotRequestId === null)

    assert(reporter.reports.length === 1, 'Escaped invocation failures should be reported.')
    assert(reporter.reports[0]?.error.code === 'editor/invocation-failed', 'Escaped failures should use invocation failure codes.')
    assert(reporter.reports[0]?.metadata.source === 'editor-runtime', 'Escaped failures should identify the runtime source.')
    assert(state.preview?.kind === 'selection', 'Escaped failures should become UI-visible editor failure state.')
  } finally {
    actor.stop()
  }
})
