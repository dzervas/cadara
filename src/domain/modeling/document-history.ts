import type {
  DocumentSnapshot,
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  FeatureDefinition,
  FeatureSnapshotRecord,
  FeatureTreeNodeRecord,
  SketchSnapshotRecord,
} from '@/contracts/modeling/schema'
import type { DocumentHistoryItemId, FeatureId } from '@/contracts/shared/ids'

export type DocumentHistoryOrderEntry =
  | { kind: 'sketch'; sketchId: NonNullable<DocumentHistoryItemRecord['sketchId']> }
  | { kind: 'feature'; featureId: NonNullable<DocumentHistoryItemRecord['featureId']> }

export interface DocumentHistoryDependencyOrderViolation {
  featureId: FeatureId
  featureKey: string
  dependencyKey: string
}

export function getDocumentHistoryOrderEntryKey(entry: DocumentHistoryOrderEntry) {
  return entry.kind === 'sketch'
    ? `sketch:${entry.sketchId}`
    : `feature:${entry.featureId}`
}

export function documentHistoryOrderEntriesEqual(
  left: DocumentHistoryOrderEntry,
  right: DocumentHistoryOrderEntry,
) {
  return getDocumentHistoryOrderEntryKey(left) === getDocumentHistoryOrderEntryKey(right)
}

function createDocumentHistoryItemId(kind: DocumentHistoryItemRecord['kind'], id: string) {
  return `document_history_item_${kind}_${id}` as DocumentHistoryItemId
}

export function createDocumentHistoryItems(input: {
  featureTree: readonly FeatureTreeNodeRecord[]
  features: readonly FeatureSnapshotRecord[]
  sketches: readonly SketchSnapshotRecord[]
  historyOrder?: readonly DocumentHistoryOrderEntry[]
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

  for (const item of input.historyOrder ?? []) {
    if (item.kind === 'sketch') {
      const sketch = sketchesById.get(item.sketchId)
      if (sketch) {
        pushSketch(sketch)
      }
      continue
    }

    const feature = featuresById.get(item.featureId)
    if (feature) {
      pushFeature(feature)
    }
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

export function createDocumentHistoryOrder(
  items: readonly DocumentHistoryItemRecord[],
): DocumentHistoryOrderEntry[] {
  return items.map((item) =>
    item.kind === 'sketch'
      ? { kind: 'sketch' as const, sketchId: item.sketchId }
      : { kind: 'feature' as const, featureId: item.featureId },
  )
}

export function insertDocumentHistoryOrderEntryAfterCursor(
  items: readonly DocumentHistoryItemRecord[],
  cursor: DocumentFeatureCursor,
  entry: DocumentHistoryOrderEntry,
): DocumentHistoryOrderEntry[] {
  const entryKey = entry.kind === 'sketch'
    ? `sketch:${entry.sketchId}`
    : `feature:${entry.featureId}`
  const order = createDocumentHistoryOrder(items).filter((item) =>
    item.kind === 'sketch'
      ? `sketch:${item.sketchId}` !== entryKey
      : `feature:${item.featureId}` !== entryKey,
  )
  const cursorIndex = getDocumentHistoryCursorIndex(items, cursor)
  order.splice(cursorIndex < 0 ? order.length : cursorIndex + 1, 0, entry)
  return order
}

export function reorderDocumentHistoryOrder(
  order: readonly DocumentHistoryOrderEntry[],
  item: DocumentHistoryOrderEntry,
  beforeItem: DocumentHistoryOrderEntry | null,
): DocumentHistoryOrderEntry[] | null {
  const itemKey = getDocumentHistoryOrderEntryKey(item)
  const beforeKey = beforeItem === null ? null : getDocumentHistoryOrderEntryKey(beforeItem)
  const currentIndex = order.findIndex((entry) => getDocumentHistoryOrderEntryKey(entry) === itemKey)

  if (currentIndex < 0) {
    return null
  }

  if (beforeKey !== null && !order.some((entry) => getDocumentHistoryOrderEntryKey(entry) === beforeKey)) {
    return null
  }

  const nextOrder = order.filter((entry) => getDocumentHistoryOrderEntryKey(entry) !== itemKey)
  const insertIndex = beforeKey === null
    ? nextOrder.length
    : nextOrder.findIndex((entry) => getDocumentHistoryOrderEntryKey(entry) === beforeKey)
  nextOrder.splice(insertIndex < 0 ? nextOrder.length : insertIndex, 0, item)
  return nextOrder
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectFeatureDefinitionDependencyKeys(value: unknown, dependencyKeys: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFeatureDefinitionDependencyKeys(item, dependencyKeys)
    }
    return
  }

  if (!isRecord(value)) {
    return
  }

  if (typeof value.sketchId === 'string') {
    dependencyKeys.add(`sketch:${value.sketchId}`)
  }

  if (typeof value.featureId === 'string') {
    dependencyKeys.add(`feature:${value.featureId}`)
  }

  for (const child of Object.values(value)) {
    collectFeatureDefinitionDependencyKeys(child, dependencyKeys)
  }
}

export function findDocumentHistoryOrderDependencyViolations(
  features: readonly { featureId: FeatureId; definition: FeatureDefinition }[],
  historyOrder: readonly DocumentHistoryOrderEntry[],
): DocumentHistoryDependencyOrderViolation[] {
  const indexByKey = new Map(
    historyOrder.map((entry, index) => [getDocumentHistoryOrderEntryKey(entry), index]),
  )
  const violations: DocumentHistoryDependencyOrderViolation[] = []

  for (const feature of features) {
    const featureKey = getDocumentHistoryOrderEntryKey({ kind: 'feature', featureId: feature.featureId })
    const featureIndex = indexByKey.get(featureKey)

    if (featureIndex === undefined) {
      continue
    }

    const dependencyKeys = new Set<string>()
    collectFeatureDefinitionDependencyKeys(feature.definition, dependencyKeys)

    for (const dependencyKey of dependencyKeys) {
      if (dependencyKey === featureKey) {
        continue
      }

      const dependencyIndex = indexByKey.get(dependencyKey)
      if (dependencyIndex !== undefined && dependencyIndex > featureIndex) {
        violations.push({
          featureId: feature.featureId,
          featureKey,
          dependencyKey,
        })
      }
    }
  }

  return violations
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

export function getDocumentHistoryCursorBeforeTarget(
  items: readonly DocumentHistoryItemRecord[],
  target: DocumentHistoryOrderEntry,
): DocumentFeatureCursor | null {
  const targetIndex = items.findIndex((item) =>
    target.kind === 'sketch'
      ? item.kind === 'sketch' && item.sketchId === target.sketchId
      : item.kind === 'feature' && item.featureId === target.featureId,
  )

  return targetIndex < 0 ? null : getDocumentHistoryCursorForIndex(items, targetIndex - 1)
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
