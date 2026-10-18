import { Modal, Stack, Text } from "@mantine/core";

import { appVersion, gitCommit } from "@/build-info";

interface AboutModalProps {
  opened: boolean;
  withinPortal?: boolean;
  onClose: () => void;
}

export function AboutModal({ opened, withinPortal, onClose }: AboutModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="About CADara"
      closeButtonProps={{ "aria-label": "Close modal" }}
      size="sm"
      centered
      withinPortal={withinPortal}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="xs">
        <Text size="sm">Version {appVersion}</Text>
        <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
          Build {gitCommit}
        </Text>
        <Text size="xs" c="dimmed">
          GNU Affero General Public License v3
        </Text>
      </Stack>
    </Modal>
  );
}
