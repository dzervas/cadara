import { describe, expect, it } from 'bun:test'

import type { DocumentId } from '@/contracts/shared/ids'
import type { WorkbenchTab, WorkbenchTabsState } from '@/domain/workspace/workbench-tabs'

import { getBrowserOnlyTabCloseWarning } from './browser-tab-close'

const docA = 'doc_a' as DocumentId
const docB = 'doc_b' as DocumentId

function tab(documentId: DocumentId, overrides: Partial<WorkbenchTab> = {}): WorkbenchTab {
  return {
    documentId,
    title: documentId,
    storageKind: 'browser',
    storageDescriptor: null,
    ...overrides,
  }
}

function state(tabs: WorkbenchTab[], activeDocumentId = tabs[0].documentId): WorkbenchTabsState {
  return { tabs, activeDocumentId }
}

describe('getBrowserOnlyTabCloseWarning', () => {
  it('requires confirmation before closing a browser-only tab when another tab remains open', () => {
    expect(getBrowserOnlyTabCloseWarning(state([tab(docA), tab(docB)]), docB)).toEqual(tab(docB))
  })

  it('does not warn for filesystem tabs or the only remaining tab', () => {
    expect(
      getBrowserOnlyTabCloseWarning(
        state([tab(docA), tab(docB, { storageKind: 'filesystem', storageDescriptor: 'part.cadara' })]),
        docB,
      ),
    ).toBeNull()
    expect(getBrowserOnlyTabCloseWarning(state([tab(docA)]), docA)).toBeNull()
  })
})
