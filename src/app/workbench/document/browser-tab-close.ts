import type { DocumentId } from '@/contracts/shared/ids'
import type { WorkbenchTab, WorkbenchTabsState } from '@/domain/workspace/workbench-tabs'

export function getBrowserOnlyTabCloseWarning(
  state: WorkbenchTabsState,
  documentId: DocumentId,
): WorkbenchTab | null {
  if (state.tabs.length <= 1) {
    return null
  }

  const tab = state.tabs.find((entry) => entry.documentId === documentId)
  if (!tab || tab.storageKind !== 'browser') {
    return null
  }

  return tab
}
