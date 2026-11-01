import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Portal,
  Stack,
  Text,
  Transition,
} from "@mantine/core";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";

/** The quiet "only on this device" card, first in the notifications column. */
export function LocalDocumentAccountBar({
  slot,
  visible,
  onMove,
  onDismiss,
  onDontAsk,
}: {
  slot: HTMLElement;
  visible: boolean;
  onMove(): void;
  onDismiss(): void;
  onDontAsk(): void;
}) {
  return (
    <Portal target={slot}>
      <Transition mounted={visible} transition="slide-down" duration={160}>
        {(styles) => (
          <Paper
            role="region"
            aria-label="Local document account offer"
            px="sm"
            py={6}
            radius="md"
            className="max-w-sm"
            style={{
              ...styles,
              background: "var(--workbench-glass-fill-strong)",
              border: "1px solid var(--workbench-glass-border-strong)",
              boxShadow: "var(--workbench-shell-elevation-md)",
              backdropFilter: "var(--workbench-glass-blur)",
            }}
          >
            <Group gap={6} wrap="nowrap" align="flex-start">
              <Stack gap={2} className="min-w-0">
                <Text size="xs">This document is only on this device.</Text>
                <Group gap={4}>
                  <Button size="compact-xs" variant="subtle" onClick={onMove}>
                    Move to your account →
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    c="dimmed"
                    onClick={onDontAsk}
                  >
                    Don't ask for this document
                  </Button>
                </Group>
              </Stack>
              <ActionIcon
                size={22}
                variant="subtle"
                aria-label="Dismiss account move offer"
                onClick={onDismiss}
              >
                <WorkbenchIcon name="close" size={12} />
              </ActionIcon>
            </Group>
          </Paper>
        )}
      </Transition>
    </Portal>
  );
}
