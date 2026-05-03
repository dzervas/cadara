import type { DocumentId } from '@/contracts/shared/ids'

/**
 * Where the document behind this tab lives.
 *
 * - `browser`  — automerge db stored in IndexedDB only. Survives reload, lost on browser data clear.
 * - `filesystem` — bound to a local file via the File System Access API. Authoritative copy on disk.
 * - `cloud` — synced through a remote backend. Reserved for a future provider; not wired today.
 */
export type WorkbenchTabStorageKind = 'browser' | 'filesystem' | 'cloud'

export interface WorkbenchTab {
  documentId: DocumentId
  title: string
  storageKind: WorkbenchTabStorageKind
  /**
   * Storage-specific display detail surfaced in the tooltip
   * (e.g. the filename for `filesystem`, the provider for `cloud`).
   * `null` for `browser`.
   */
  storageDescriptor: string | null
}

export interface WorkbenchTabsState {
  tabs: readonly WorkbenchTab[]
  activeDocumentId: DocumentId
}

export type WorkbenchTabsAction =
  | { type: 'open'; tab: WorkbenchTab; activate?: boolean }
  | { type: 'close'; documentId: DocumentId }
  | { type: 'activate'; documentId: DocumentId }
  | { type: 'reorder'; documentId: DocumentId; toIndex: number }
  | { type: 'rename'; documentId: DocumentId; title: string }
  | {
      type: 'updateStorage'
      documentId: DocumentId
      storageKind: WorkbenchTabStorageKind
      storageDescriptor: string | null
    }

export function createInitialWorkbenchTabsState(seed: WorkbenchTab): WorkbenchTabsState {
  return { tabs: [seed], activeDocumentId: seed.documentId }
}

/**
 * Pure reducer. The UI layer wraps this with persistence and side effects.
 *
 * Invariants enforced:
 *   - The tab list is never empty.
 *   - `activeDocumentId` always references a tab in the list.
 *   - Closing the active tab promotes the right-hand neighbor (or left if rightmost).
 *   - Closing the only tab is a no-op; the strip never goes empty.
 *   - `open` with an existing documentId updates the existing tab in place rather than duplicating.
 */
export function reduceWorkbenchTabs(
  state: WorkbenchTabsState,
  action: WorkbenchTabsAction,
): WorkbenchTabsState {
  switch (action.type) {
    case 'open': {
      const existingIndex = state.tabs.findIndex((tab) => tab.documentId === action.tab.documentId)
      if (existingIndex >= 0) {
        const nextTabs = state.tabs.map((tab, index) => (index === existingIndex ? action.tab : tab))
        return {
          tabs: nextTabs,
          activeDocumentId: action.activate ? action.tab.documentId : state.activeDocumentId,
        }
      }

      return {
        tabs: [...state.tabs, action.tab],
        activeDocumentId: action.activate ? action.tab.documentId : state.activeDocumentId,
      }
    }

    case 'close': {
      if (state.tabs.length <= 1) {
        return state
      }

      const closedIndex = state.tabs.findIndex((tab) => tab.documentId === action.documentId)
      if (closedIndex < 0) {
        return state
      }

      const nextTabs = state.tabs.filter((_, index) => index !== closedIndex)
      const wasActive = state.activeDocumentId === action.documentId
      if (!wasActive) {
        return { tabs: nextTabs, activeDocumentId: state.activeDocumentId }
      }

      const successorIndex = Math.min(closedIndex, nextTabs.length - 1)
      return { tabs: nextTabs, activeDocumentId: nextTabs[successorIndex].documentId }
    }

    case 'activate': {
      if (!state.tabs.some((tab) => tab.documentId === action.documentId)) {
        return state
      }
      if (state.activeDocumentId === action.documentId) {
        return state
      }
      return { tabs: state.tabs, activeDocumentId: action.documentId }
    }

    case 'reorder': {
      const fromIndex = state.tabs.findIndex((tab) => tab.documentId === action.documentId)
      if (fromIndex < 0) {
        return state
      }

      const clampedTo = Math.max(0, Math.min(state.tabs.length - 1, action.toIndex))
      if (clampedTo === fromIndex) {
        return state
      }

      const next = state.tabs.slice()
      const [moved] = next.splice(fromIndex, 1)
      next.splice(clampedTo, 0, moved)
      return { tabs: next, activeDocumentId: state.activeDocumentId }
    }

    case 'rename': {
      const nextTabs = state.tabs.map((tab) =>
        tab.documentId === action.documentId ? { ...tab, title: action.title } : tab,
      )
      if (nextTabs === state.tabs) {
        return state
      }
      return { tabs: nextTabs, activeDocumentId: state.activeDocumentId }
    }

    case 'updateStorage': {
      const nextTabs = state.tabs.map((tab) =>
        tab.documentId === action.documentId
          ? {
              ...tab,
              storageKind: action.storageKind,
              storageDescriptor: action.storageDescriptor,
            }
          : tab,
      )
      return { tabs: nextTabs, activeDocumentId: state.activeDocumentId }
    }
  }
}

/**
 * Boot-time reconciliation: take whatever the persistence layer gave us
 * and ensure the actually-loaded document is present and active.
 *
 * If the loaded document is missing from the persisted set, we prepend it.
 * This guarantees the strip always reflects the truth of the modeling service
 * even if persistence was wiped, partial, or pre-dates a documentId migration.
 */
export function reconcileWorkbenchTabsForActiveDocument(
  persisted: WorkbenchTabsState | null,
  active: WorkbenchTab,
): WorkbenchTabsState {
  if (!persisted || persisted.tabs.length === 0) {
    return createInitialWorkbenchTabsState(active)
  }

  const hasActive = persisted.tabs.some((tab) => tab.documentId === active.documentId)
  if (hasActive) {
    return { tabs: persisted.tabs, activeDocumentId: active.documentId }
  }

  return { tabs: [active, ...persisted.tabs], activeDocumentId: active.documentId }
}

export function workbenchTabsStorageDescriptor(
  storageKind: WorkbenchTabStorageKind,
  descriptor: string | null,
): string {
  switch (storageKind) {
    case 'browser':
      return 'Stored in this browser only'
    case 'filesystem':
      return descriptor ? `Synced to ${descriptor}` : 'Synced to a local file'
    case 'cloud':
      return descriptor ? `Cloud-synced — ${descriptor}` : 'Cloud-synced'
  }
}
