import type { ReactNode } from "react";
import { Alert, Group, Paper, Stack, Text, Title } from "@mantine/core";

export function SettingsSection({
  title,
  description,
  danger = false,
  error = null,
  onDismissError,
  children,
}: {
  title: string;
  description?: string;
  danger?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Title order={2} size={13} mb={4} c={danger ? "red.4" : undefined}>
        {title}
      </Title>
      {description && (
        <Text size="xs" c="dimmed" mb="sm">
          {description}
        </Text>
      )}
      <Paper
        withBorder
        radius="md"
        p="md"
        bg="transparent"
        style={
          danger ? { borderColor: "var(--mantine-color-red-9)" } : undefined
        }
      >
        <Stack gap="md">
          {error && (
            <Alert
              color="red"
              role="alert"
              withCloseButton
              onClose={onDismissError}
            >
              {error}
            </Alert>
          )}
          {children}
        </Stack>
      </Paper>
    </section>
  );
}

/** A labelled list row with trailing actions. */
export function SettingsRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      gap="sm"
      py={6}
      className="border-b border-[var(--workbench-shell-border)] last:border-b-0"
    >
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" truncate>
          {label}
        </Text>
        {detail && (
          <Text size="xs" c="dimmed" truncate>
            {detail}
          </Text>
        )}
      </Stack>
      {children}
    </Group>
  );
}
