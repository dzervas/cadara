import { useRef, type ChangeEvent } from 'react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'

import { DOCUMENT_FILE_MENU_ITEMS } from '@/components/layout/document-file-menu-model'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import { WorkbenchIcon } from '@/components/ui/workbench-icon'

interface DocumentFileMenuHandlers {
  onNewDocument: () => void
  onImportDocument: (file: File) => void
  onExportDocument: () => void
}

interface DocumentFileMenuProps extends DocumentFileMenuHandlers {
  defaultOpened?: boolean
}

export function DocumentFileMenu({
  defaultOpened = false,
  onNewDocument,
  onImportDocument,
  onExportDocument,
}: DocumentFileMenuProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const openImportPicker = () => {
    importInputRef.current?.click()
  }

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (file) {
      onImportDocument(file)
    }
  }

  const handleMenuItemSelect = (itemId: (typeof DOCUMENT_FILE_MENU_ITEMS)[number]['id']) => {
    switch (itemId) {
      case 'new':
        onNewDocument()
        return
      case 'import':
        openImportPicker()
        return
      case 'export':
        onExportDocument()
        return
    }
  }

  return (
    <>
      <Menu
        defaultOpened={defaultOpened}
        position="bottom-start"
        transitionProps={{ duration: 0 }}
        width={180}
      >
        <Menu.Target>
          <Tooltip
            label={
              <ToolbarTooltipContent
                title="File"
                description="Create, import, or export the current document."
              />
            }
          >
            <ActionIcon
              type="button"
              variant="subtle"
              color="workbench"
              aria-label="File"
              data-workbench-file-menu
            >
              <WorkbenchIcon name="file" className="h-4 w-4" />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>

        <Menu.Dropdown
          aria-label="Document file menu"
          style={{
            backgroundColor: 'var(--workbench-shell-overlay-strong)',
            borderColor: 'var(--workbench-shell-border)',
            boxShadow: 'var(--workbench-panel-shadow)',
          }}
        >
          {DOCUMENT_FILE_MENU_ITEMS.map((item) => (
            <Menu.Item
              key={item.id}
              leftSection={<WorkbenchIcon name={item.icon} className="h-4 w-4" />}
              onClick={() => handleMenuItemSelect(item.id)}
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      <input
        ref={importInputRef}
        aria-label="Import document file"
        type="file"
        accept=".cadara,application/json,application/vnd.cadara+json"
        hidden
        onChange={handleImportFileChange}
      />
    </>
  )
}
