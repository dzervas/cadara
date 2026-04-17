import type {
  DocumentSnapshot,
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  FeatureSnapshotRecord,
  FeatureTreeNodeRecord,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type { DocumentHistoryItemId } from '@/contracts/shared/ids'

function createDocumentHistoryItemId(kind: DocumentHistoryItemRecord['kind'], id: string) {
  return `document_history_item_${kind}_${id}` as DocumentHistoryItemId
}

export function createDocumentHistoryItems(input: {
  featureTree: readonly FeatureTreeNodeRecord[]
  features: readonly FeatureSnapshotRecord[]
  sketches: readonly SketchSnapshotRecord[]
}): DocumentHistoryItemRecord[] {
  const featuresById = new Map(input.features.map((feature) => [feature.featureId, feature]))
  const sketchesById = new Map(input.sketches.map((sketch) => [sketch.sketchId, sketch]))
  const seen = new Set<string>()
  const items: DocumentHistoryItemRecord[] = []

  const pushSketch = (sketch: SketchSnapshotRecord) => {
    const key = `sketch:${sketch.sketchId}`
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    items.push({
      id: createDocumentHistoryItemId('sketch', sketch.sketchId),
      label: sketch.label,
      description: 'Authored sketch',
      kind: 'sketch',
      target: { kind: 'sketch', sketchId: sketch.sketchId },
      sketchId: sketch.sketchId,
      featureId: null,
    })
  }

  const pushFeature = (feature: FeatureSnapshotRecord) => {
    const key = `feature:${feature.featureId}`
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    items.push({
      id: createDocumentHistoryItemId('feature', feature.featureId),
      label: feature.label,
      description: `${feature.definition.kind} feature`,
      kind: 'feature',
      target: { kind: 'feature', featureId: feature.featureId },
      sketchId: null,
      featureId: feature.featureId,
    })
  }

  for (const node of input.featureTree) {
    if (node.kind === 'sketch' && node.ownerSketchId) {
      const sketch = sketchesById.get(node.ownerSketchId)
      if (sketch) {
        pushSketch(sketch)
      }
      continue
    }

    if (node.kind === 'feature' && node.ownerFeatureId) {
      const feature = featuresById.get(node.ownerFeatureId)
      if (feature) {
        pushFeature(feature)
      }
    }
  }

  for (const sketch of input.sketches) {
    pushSketch(sketch)
  }

  for (const feature of input.features) {
    pushFeature(feature)
  }

  return items
}

export function createTailDocumentCursor(items: readonly DocumentHistoryItemRecord[]): DocumentFeatureCursor {
  const tail = items.at(-1)

  if (!tail) {
    return { kind: 'empty' }
  }

  return tail.kind === 'sketch'
    ? { kind: 'sketch', sketchId: tail.sketchId }
    : { kind: 'feature', featureId: tail.featureId }
}

export function getDocumentHistoryCursorIndex(
  items: readonly DocumentHistoryItemRecord[],
  cursor: DocumentFeatureCursor,
) {
  if (cursor.kind === 'empty') {
    return -1
  }

  return items.findIndex((item) =>
    cursor.kind === 'sketch'
      ? item.kind === 'sketch' && item.sketchId === cursor.sketchId
      : item.kind === 'feature' && item.featureId === cursor.featureId,
  )
}

export function getDocumentHistoryCursorForIndex(
  items: readonly DocumentHistoryItemRecord[],
  index: number,
): DocumentFeatureCursor {
  if (index < 0) {
    return { kind: 'empty' }
  }

  const item = items[index]
  if (!item) {
    return { kind: 'empty' }
  }

  return item.kind === 'sketch'
    ? { kind: 'sketch', sketchId: item.sketchId }
    : { kind: 'feature', featureId: item.featureId }
}

export function getPreviousDocumentHistoryCursor(snapshot: DocumentSnapshot): DocumentFeatureCursor | null {
  const items = snapshot.presentation.documentHistory
  const cursor = snapshot.document.cursor
  const cursorIndex = getDocumentHistoryCursorIndex(items, cursor)

  if (cursor.kind !== 'empty' && cursorIndex < 0) {
    return null
  }

  return cursorIndex > -1 ? getDocumentHistoryCursorForIndex(items, cursorIndex - 1) : null
}

export function getNextDocumentHistoryCursor(snapshot: DocumentSnapshot): DocumentFeatureCursor | null {
  const items = snapshot.presentation.documentHistory
  const cursor = snapshot.document.cursor
  const cursorIndex = getDocumentHistoryCursorIndex(items, cursor)

  if (cursor.kind !== 'empty' && cursorIndex < 0) {
    return null
  }

  const nextIndex = cursorIndex + 1
  return nextIndex < items.length ? getDocumentHistoryCursorForIndex(items, nextIndex) : null
}

export function isValidDocumentHistoryCursor(
  items: readonly DocumentHistoryItemRecord[],
  cursor: DocumentFeatureCursor,
) {
  return cursor.kind === 'empty' || getDocumentHistoryCursorIndex(items, cursor) >= 0
}

export function getAppliedFeatureIdsForDocumentCursor(
  items: readonly DocumentHistoryItemRecord[],
  cursor: DocumentFeatureCursor,
) {
  const cursorIndex = getDocumentHistoryCursorIndex(items, cursor)
  const appliedItems = cursor.kind === 'empty' ? [] : items.slice(0, cursorIndex + 1)

  return new Set(
    appliedItems
      .filter((item): item is Extract<DocumentHistoryItemRecord, { kind: 'feature' }> => item.kind === 'feature')
      .map((item) => item.featureId),
  )
}

export function getFeatureInsertionIndexForDocumentCursor(
  items: readonly DocumentHistoryItemRecord[],
  cursor: DocumentFeatureCursor,
) {
  const cursorIndex = getDocumentHistoryCursorIndex(items, cursor)
  const precedingItems = cursor.kind === 'empty' ? [] : items.slice(0, cursorIndex + 1)

  return precedingItems.filter((item) => item.kind === 'feature').length
}
