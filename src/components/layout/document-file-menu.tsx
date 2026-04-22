import { useRef, type ChangeEvent } from 'react'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'

import {
  DOCUMENT_FILE_MENU_ITEMS,
  getDocumentFileMenuCommand,
  type DocumentFileMenuItemId,
} from '@/components/layout/document-file-menu-model'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import { WorkbenchIcon } from '@/components/ui/workbench-icon'

export const BROWSER_STORAGE_WARNING_TOOLTIP =
  "The data are currently saved within the browser, which might result in data loss. Please use the local file functionality to make sure that all changes are saved on your computer's disk so you can back them up"

function BrowserStorageWarningTooltipLabel() {
  return (
    <span className="block max-w-64 whitespace-normal break-words text-xs leading-relaxed text-[var(--workbench-tooltip-description)]">
      {BROWSER_STORAGE_WARNING_TOOLTIP}
    </span>
  )
}

interface DocumentFileMenuHandlers {
  onNewDocument: () => void
  onOpenLocalFile: () => void
  onSaveLocalFile: () => void
  onImportDocument: (file: File) => void
  onExportDocument: () => void
}

interface DocumentFileMenuProps extends DocumentFileMenuHandlers {
  defaultOpened?: boolean
  showBrowserStorageWarning?: boolean
}

export function DocumentFileMenu({
  defaultOpened = false,
  showBrowserStorageWarning = false,
  onNewDocument,
  onOpenLocalFile,
  onSaveLocalFile,
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

  const handleMenuItemSelect = (itemId: DocumentFileMenuItemId) => {
    switch (getDocumentFileMenuCommand(itemId)) {
      case 'newDocument':
        onNewDocument()
        return
      case 'openLocalFile':
        onOpenLocalFile()
        return
      case 'saveLocalFile':
        onSaveLocalFile()
        return
      case 'importDocument':
        openImportPicker()
        return
      case 'exportDocument':
        onExportDocument()
        return
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
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
                  description="Create, open, save, import, or export the current document."
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
        {showBrowserStorageWarning ? (
          <Tooltip label={<BrowserStorageWarningTooltipLabel />}>
            <span
              role="img"
              aria-label={BROWSER_STORAGE_WARNING_TOOLTIP}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--workbench-shell-warning-text)]"
              data-workbench-browser-storage-warning
              style={{
                backgroundColor: 'var(--workbench-shell-warning-surface)',
                border: '1px solid var(--workbench-shell-warning-border)',
              }}
            >
              <WorkbenchIcon name="warning" className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        ) : null}
      </div>
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
