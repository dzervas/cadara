import type { WorkbenchIconName } from '@/components/ui/workbench-icon'

export interface DocumentFileMenuItem {
  id: DocumentFileMenuItemId
  label: string
  icon: WorkbenchIconName
}

export type DocumentFileMenuItemId = 'new' | 'openLocal' | 'saveLocal' | 'import' | 'export'
export type DocumentFileMenuCommand =
  | 'newDocument'
  | 'openLocalFile'
  | 'saveLocalFile'
  | 'importDocument'
  | 'exportDocument'

export const DOCUMENT_FILE_MENU_ITEMS: readonly DocumentFileMenuItem[] = [
  {
    id: 'new',
    label: 'New',
    icon: 'newDocument',
  },
  {
    id: 'openLocal',
    label: 'Open local file',
    icon: 'import',
  },
  {
    id: 'saveLocal',
    label: 'Save local file',
    icon: 'download',
  },
  {
    id: 'import',
    label: 'Import',
    icon: 'import',
  },
  {
    id: 'export',
    label: 'Export',
    icon: 'download',
  },
]

export function getDocumentFileMenuCommand(itemId: DocumentFileMenuItemId): DocumentFileMenuCommand {
  switch (itemId) {
    case 'new':
      return 'newDocument'
    case 'openLocal':
      return 'openLocalFile'
    case 'saveLocal':
      return 'saveLocalFile'
    case 'import':
      return 'importDocument'
    case 'export':
      return 'exportDocument'
  }
}
