import {
  getFeaturePrimarySelectionTarget,
  getFeatureSessionPreviewLabel,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import {
  primitiveRefEquals,
  resolveSelectionCandidate,
  type CommandPreview,
  type PrimitiveRef,
  type SelectionFilter,
  type SelectionTargetCatalog,
} from '@/core/editor/schema'
import type { EditorExtensionDependencies } from './dependencies'
import type { EditorState, ImportSessionState } from './types'

export function adoptOrderedSelection(
  currentSelection: readonly PrimitiveRef[],
  tryAppend: (
    adoptedSelection: readonly PrimitiveRef[],
    target: PrimitiveRef,
  ) => PrimitiveRef[] | null,
): PrimitiveRef[] {
  const adoptedSelection: PrimitiveRef[] = []

  for (const target of currentSelection) {
    const nextSelection = tryAppend(adoptedSelection, target)

    if (!nextSelection || nextSelection.length !== adoptedSelection.length + 1) {
      return []
    }

    if (
      adoptedSelection.some((selectedTarget, index) =>
        !primitiveRefEquals(selectedTarget, nextSelection[index]!),
      )
    ) {
      return []
    }

    if (!primitiveRefEquals(nextSelection[adoptedSelection.length]!, target)) {
      return []
    }

    adoptedSelection.push(target)
  }

  return adoptedSelection
}

export function adoptSelectionForFilter(
  currentSelection: readonly PrimitiveRef[],
  selectionFilter: SelectionFilter | null,
  selectionCatalog: SelectionTargetCatalog | null,
): PrimitiveRef[] {
  return adoptOrderedSelection(
    currentSelection,
    (adoptedSelection, target) => {
      const candidate = resolveSelectionCandidate(
        selectionFilter,
        [...adoptedSelection],
        target,
        selectionCatalog,
      )

      return candidate.accepted ? candidate.nextSelection : null
    },
  )
}

export function createSelectionPreview(state: EditorState, filter: SelectionFilter | null): CommandPreview | null {
  return createSelectionPreviewForSelection(state.selection, filter)
}

export function createSelectionPreviewForSelection(
  selection: PrimitiveRef[],
  filter: SelectionFilter | null,
): CommandPreview | null {
  if (!filter) {
    return null
  }

  return {
    kind: 'selection',
    label: `Awaiting ${filter.label.toLowerCase()}`,
    target: selection[0] ?? null,
  }
}

export function createFeatureSelectionPreview(
  session: FeatureEditSessionState,
  prefix = 'Draft',
): CommandPreview {
  return {
    kind: 'selection',
    label: getFeatureSessionPreviewLabel(session, prefix),
    target: getFeaturePrimarySelectionTarget(session),
  }
}

export function createImportSelectionPreview(
  session: ImportSessionState,
  dependencies: EditorExtensionDependencies,
  prefix = 'Import',
): CommandPreview {
  const provider = dependencies.importProviders.getById(session.providerId)

  return {
    kind: 'selection',
    label: provider ? `${prefix} ${provider.label}` : `${prefix} session`,
    target: null,
  }
}
