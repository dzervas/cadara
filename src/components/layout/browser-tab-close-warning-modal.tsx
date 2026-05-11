import { Button, Group, Modal, SimpleGrid, Stack, Text } from "@mantine/core";

import { WorkbenchIcon } from "@/components/ui/workbench-icon";

export const BROWSER_TAB_CLOSE_WARNING_TITLE = "Save before closing?";
export const BROWSER_TAB_CLOSE_WARNING_MESSAGE =
  "This document is stored only in this browser. If you close the tab without saving, it will be lost forever.";

interface BrowserTabCloseWarningModalProps {
  opened: boolean;
  documentTitle: string;
  pending?: boolean;
  withinPortal?: boolean;
  onCancel: () => void;
  onCloseWithoutSaving: () => void;
  onDownloadCopy: () => void;
  onSaveLinked: () => void;
}

export function BrowserTabCloseWarningModal({
  opened,
  documentTitle,
  pending = false,
  withinPortal,
  onCancel,
  onCloseWithoutSaving,
  onDownloadCopy,
  onSaveLinked,
}: BrowserTabCloseWarningModalProps) {
  const actionButtonProps = {
    fullWidth: true,
    styles: {
      inner: {
        whiteSpace: "normal",
        lineHeight: 1.2,
      },
      label: {
        whiteSpace: "normal",
      },
      root: {
        minHeight: 36,
        height: "auto",
      },
    },
  } as const;

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={BROWSER_TAB_CLOSE_WARNING_TITLE}
      centered
      withinPortal={withinPortal}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Stack gap={6}>
          <Text size="sm" fw={600} c="var(--workbench-shell-text)">
            {documentTitle}
          </Text>
          <Text
            size="sm"
            c="var(--workbench-shell-text-dim)"
            className="whitespace-normal break-words"
          >
            {BROWSER_TAB_CLOSE_WARNING_MESSAGE}
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
          <Button
            {...actionButtonProps}
            variant="default"
            leftSection={<WorkbenchIcon name="download" size={14} />}
            onClick={onDownloadCopy}
            loading={pending}
          >
            Download a copy
          </Button>
          <Button
            {...actionButtonProps}
            color="workbench"
            leftSection={<WorkbenchIcon name="file" size={14} />}
            onClick={onSaveLinked}
            loading={pending}
          >
            Save and keep linked
          </Button>
        </SimpleGrid>

        <Group gap="xs" justify="flex-end">
          <Button
            variant="subtle"
            color="workbench"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="subtle"
            color="red"
            onClick={onCloseWithoutSaving}
            disabled={pending}
          >
            Close without saving
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
