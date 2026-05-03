import { describe, expect, test } from 'bun:test'

import {
  advanceCursorPhase,
  getCursorPhaseAction,
} from './cursor-lifecycle'
import type { EditSessionCursorContext } from './types'

function makeCursorContext(
  phase: EditSessionCursorContext['phase'],
  target: EditSessionCursorContext['target'] = {
    kind: 'sketch',
    sketchId: 'sketch_1',
  },
  sessionKind: EditSessionCursorContext['sessionKind'] = 'sketchAuthoring',
): EditSessionCursorContext {
  return {
    target,
    sessionKind,
    rollbackCursor: {
      kind: 'document',
      featureId: null,
    },
    restoreCursor: {
      kind: 'feature',
      featureId: 'feature_restore',
    },
    phase,
  }
}

describe('cursor lifecycle', () => {
  test('maps rollback refresh to opening and sketch reopen', () => {
    const context = makeCursorContext('rollingBack')

    expect(getCursorPhaseAction(context)).toBe('openSketchSession')
    expect(advanceCursorPhase(context, 'snapshotRefreshed')).toEqual({
      ...context,
      phase: 'opening',
    })
  })

  test('maps rollback refresh to feature hydration for feature targets', () => {
    const context = makeCursorContext('rollingBack', {
      kind: 'feature',
      featureId: 'feature_1',
    }, 'featureEdit')

    expect(getCursorPhaseAction(context)).toBe('hydrateFeature')
    expect(advanceCursorPhase(context, 'snapshotRefreshed')).toEqual({
      ...context,
      phase: 'opening',
    })
  })

  test('maps rollback refresh to sketch-plane editing for sketch-plane sessions', () => {
    const context = makeCursorContext('rollingBack', {
      kind: 'sketch',
      sketchId: 'sketch_1',
    }, 'sketchPlaneEdit')

    expect(getCursorPhaseAction(context)).toBe('openSketchPlaneEdit')
    expect(advanceCursorPhase(context, 'snapshotRefreshed')).toEqual({
      ...context,
      phase: 'opening',
    })
  })

  test('advances opening sessions to active after the workflow opens', () => {
    const context = makeCursorContext('opening')

    expect(getCursorPhaseAction(context)).toBeNull()
    expect(advanceCursorPhase(context, 'sessionOpened')).toEqual({
      ...context,
      phase: 'active',
    })
  })

  test('advances active sessions to restore-pending after commit', () => {
    const context = makeCursorContext('active')

    expect(advanceCursorPhase(context, 'commitCompleted')).toEqual({
      ...context,
      phase: 'restorePending',
    })
  })

  test('maps restore-pending to restore-started and then clears after refresh', () => {
    const context = makeCursorContext('restorePending')
    const restoring = advanceCursorPhase(context, 'restoreStarted')

    expect(getCursorPhaseAction(context)).toBe('restore')
    expect(restoring).toEqual({
      ...context,
      phase: 'restoring',
    })
    expect(restoring && getCursorPhaseAction(restoring)).toBe('complete')
    expect(restoring && advanceCursorPhase(restoring, 'snapshotRefreshed')).toBeNull()
  })
})
