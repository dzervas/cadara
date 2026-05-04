import { useRef, type ChangeEvent, type ReactElement } from 'react'
import { ActionIcon, Button, Group, Menu, Modal, Stack, Text, Tooltip } from '@mantine/core'

import {
  DOCUMENT_FILE_MENU_ITEMS,
  getDocumentFileMenuCommand,
  type DocumentFileMenuItemId,
} from '@/components/layout/document-file-menu-model'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import { WorkbenchIcon, type WorkbenchIconName } from '@/components/ui/workbench-icon'

export const OPEN_COPY_DOCUMENT_DESCRIPTION =
  'Choose a .cadara file; CADara opens it in a new tab, and future changes stay in browser storage until you save again.'
export const OPEN_LINKED_DOCUMENT_DESCRIPTION =
  'Choose a .cadara file; CADara opens it in a new tab and keeps future changes saving to that same file on your computer.'
export const DOWNLOAD_COPY_DOCUMENT_DESCRIPTION =
  'CADara downloads a portable .cadara file; future changes stay in browser storage until you save again.'
export const SAVE_LINKED_DOCUMENT_DESCRIPTION =
  'Choose where to save; CADara writes this document there and keeps future changes saving to that same file on your computer.'
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
  onOpenDocument: () => void
  onSaveDocumentAs: () => void
}

interface DocumentFileMenuProps extends DocumentFileMenuHandlers {
  defaultOpened?: boolean
  showBrowserStorageWarning?: boolean
  /**
   * Custom Menu.Target trigger. When provided, the file menu opens from this element
   * instead of the default file ActionIcon. Used by the floating toolbar to attach the
   * file menu to the spark-orange logo.
   */
  trigger?: ReactElement
}

export function DocumentFileMenu({
  defaultOpened = false,
  showBrowserStorageWarning = false,
  onNewDocument,
  onOpenDocument,
  onSaveDocumentAs,
  trigger,
}: DocumentFileMenuProps) {
  const handleMenuItemSelect = (itemId: DocumentFileMenuItemId) => {
    switch (getDocumentFileMenuCommand(itemId)) {
      case 'newDocument':
        onNewDocument()
        return
      case 'openDocument':
        onOpenDocument()
        return
      case 'saveDocumentAs':
        onSaveDocumentAs()
        return
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 px-2.5 py-2">
        <Menu
          defaultOpened={defaultOpened}
          position="bottom-start"
          transitionProps={{ duration: 0 }}
          width={180}
        >
          <Menu.Target>
            {trigger ?? (
              <Tooltip
                label={
                  <ToolbarTooltipContent
                    title="File"
                    description="Create, open, or save the current document."
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
            )}
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
        {showBrowserStorageWarning && !trigger ? (
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
    </>
  )
}

interface OpenDocumentModalProps {
  opened: boolean
  withinPortal?: boolean
  onClose: () => void
  onOpenCopy: (file: File) => void
  onOpenLinked: () => void
}

export function OpenDocumentModal({
  opened,
  withinPortal,
  onClose,
  onOpenCopy,
  onOpenLinked,
}: OpenDocumentModalProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const openImportPicker = () => {
    importInputRef.current?.click()
  }

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''

    if (file) {
      onOpenCopy(file)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Open Document"
      centered
      withinPortal={withinPortal}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        <DocumentChoiceButton
          label="Open a copy"
          description={OPEN_COPY_DOCUMENT_DESCRIPTION}
          icon="import"
          onClick={openImportPicker}
        />
        <DocumentChoiceButton
          label="Open and keep linked"
          description={OPEN_LINKED_DOCUMENT_DESCRIPTION}
          icon="file"
          onClick={onOpenLinked}
        />
      </Stack>
      <input
        ref={importInputRef}
        aria-label="Open document copy file"
        type="file"
        accept=".cadara,application/json,application/vnd.cadara+json"
        hidden
        onChange={handleImportFileChange}
      />
    </Modal>
  )
}

interface SaveAsDocumentModalProps {
  opened: boolean
  withinPortal?: boolean
  onClose: () => void
  onDownloadCopy: () => void
  onSaveLinked: () => void
}

export function SaveAsDocumentModal({
  opened,
  withinPortal,
  onClose,
  onDownloadCopy,
  onSaveLinked,
}: SaveAsDocumentModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Save As"
      centered
      withinPortal={withinPortal}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        <DocumentChoiceButton
          label="Download a copy"
          description={DOWNLOAD_COPY_DOCUMENT_DESCRIPTION}
          icon="download"
          onClick={onDownloadCopy}
        />
        <DocumentChoiceButton
          label="Save and keep linked"
          description={SAVE_LINKED_DOCUMENT_DESCRIPTION}
          icon="file"
          onClick={onSaveLinked}
        />
      </Stack>
    </Modal>
  )
}

interface DocumentChoiceButtonProps {
  label: string
  description: string
  icon: WorkbenchIconName
  onClick: () => void
}

function DocumentChoiceButton({
  label,
  description,
  icon,
  onClick,
}: DocumentChoiceButtonProps) {
  return (
    <Button
      type="button"
      variant="subtle"
      color="workbench"
      justify="flex-start"
      fullWidth
      h="auto"
      py="sm"
      onClick={onClick}
      styles={{
        inner: {
          justifyContent: 'flex-start',
          width: '100%',
        },
        label: {
          minWidth: 0,
          overflow: 'visible',
          textOverflow: 'clip',
          whiteSpace: 'normal',
          width: '100%',
        },
        root: {
          textAlign: 'left',
        },
      }}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <WorkbenchIcon name={icon} className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="grid min-w-0 flex-1 gap-1 text-left">
          <Text component="span" size="sm" fw={600} c="var(--workbench-shell-text)">
            {label}
          </Text>
          <Text
            component="span"
            size="xs"
            c="var(--workbench-shell-text-dim)"
            className="whitespace-normal break-words"
          >
            {description}
          </Text>
        </span>
      </Group>
    </Button>
  )
}
