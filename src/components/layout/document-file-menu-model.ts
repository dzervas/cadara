import type { WorkbenchIconName } from '@/components/ui/workbench-icon'

export interface DocumentFileMenuItem {
  id: 'new' | 'import' | 'export'
  label: string
  icon: WorkbenchIconName
}

export const DOCUMENT_FILE_MENU_ITEMS: readonly DocumentFileMenuItem[] = [
  {
    id: 'new',
    label: 'New',
    icon: 'newDocument',
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
