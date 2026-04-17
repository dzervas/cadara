import { test } from 'bun:test'

import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
  moveSketchHistoryCursor,
  startSketchDraw,
} from '@/domain/editor/sketch-session'

test('src/domain/editor/sketch-session-history.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function addLine(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    start: readonly [number, number],
    end: readonly [number, number],
  ) {
    const withTool = beginSketchTool(session, 'line')
    const started = startSketchDraw(withTool, start)
    return acceptSketchDraw(started, end)
  }

  let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
  session = addLine(session, [0, 0], [1, 0])
  session = addLine(session, [0, 1], [1, 1])

  const fullItems = getSketchHistoryItems(session.fullDefinition)
  assert(fullItems.length === 4, 'Sketch history should include ordered authored entities and inferred constraints.')
  assert(getSketchHistoryCursorIndex(fullItems, session.historyCursor) === 3, 'Sketch cursor should advance to the newest item.')
  assert(
    getPreviousSketchHistoryCursor(session)?.kind === 'item' &&
      getPreviousSketchHistoryCursor(session)?.itemId === fullItems[1]?.id,
    'Previous sketch cursor should step back one authored sequence.',
  )
  assert(getNextSketchHistoryCursor(session) === null, 'Next sketch cursor should be unavailable at the tail.')

  const rolledBack = moveSketchHistoryCursor(session, getSketchHistoryCursorForIndex(fullItems, 1))
  assert(rolledBack.definition.entityIds.length === 1, 'Rolling back should filter displayed sketch entities after the cursor.')
  assert(session.fullDefinition.entityIds.length === 2, 'Rolling back must not mutate the prior full draft definition.')
  assert(
    getPreviousSketchHistoryCursor(rolledBack)?.kind === 'empty',
    'Previous sketch cursor should move to the before-first position.',
  )
  assert(
    getNextSketchHistoryCursor(rolledBack)?.kind === 'item' &&
      getNextSketchHistoryCursor(rolledBack)?.itemId === fullItems[3]?.id,
    'Next sketch cursor should step toward after-cursor authored items.',
  )

  const beforeFirst = moveSketchHistoryCursor(session, { kind: 'empty' })
  assert(getPreviousSketchHistoryCursor(beforeFirst) === null, 'Undo should be unavailable before the first sketch item.')
  assert(
    getNextSketchHistoryCursor(beforeFirst)?.kind === 'item' &&
      getNextSketchHistoryCursor(beforeFirst)?.itemId === fullItems[1]?.id,
    'Redo should be available from the before-first sketch cursor position.',
  )

  const inserted = addLine(rolledBack, [0, 2], [1, 2])
  const insertedItems = getSketchHistoryItems(inserted.fullDefinition)
  assert(inserted.fullDefinition.entityIds.length === 2, 'Inserting after a rolled-back cursor should replace after-cursor sketch items.')
  assert(inserted.definition.entityIds.length === 2, 'Displayed sketch definition should include the inserted tail item.')
  assert(
    getSketchHistoryCursorIndex(insertedItems, inserted.historyCursor) === insertedItems.length - 1,
    'Sketch cursor should advance to the newly inserted item.',
  )
})
