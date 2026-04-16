import { test } from 'bun:test'

import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
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
  assert(fullItems.length === 2, 'Sketch history should include ordered authored entities.')
  assert(getSketchHistoryCursorIndex(fullItems, session.historyCursor) === 1, 'Sketch cursor should advance to the newest item.')

  const rolledBack = moveSketchHistoryCursor(session, getSketchHistoryCursorForIndex(fullItems, 0))
  assert(rolledBack.definition.entityIds.length === 1, 'Rolling back should filter displayed sketch entities after the cursor.')
  assert(session.fullDefinition.entityIds.length === 2, 'Rolling back must not mutate the prior full draft definition.')

  const inserted = addLine(rolledBack, [0, 2], [1, 2])
  const insertedItems = getSketchHistoryItems(inserted.fullDefinition)
  assert(inserted.fullDefinition.entityIds.length === 2, 'Inserting after a rolled-back cursor should replace after-cursor sketch items.')
  assert(inserted.definition.entityIds.length === 2, 'Displayed sketch definition should include the inserted tail item.')
  assert(
    getSketchHistoryCursorIndex(insertedItems, inserted.historyCursor) === insertedItems.length - 1,
    'Sketch cursor should advance to the newly inserted item.',
  )
})
