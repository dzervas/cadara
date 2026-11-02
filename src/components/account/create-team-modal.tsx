import { Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import { teamSlugFromName } from "@/core/account/account-teams";
import type { CreateTeamInput } from "@/application/account/create-team";

export interface CreateTeamFormProps {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: CreateTeamInput) => void;
}

export function CreateTeamForm({
  busy,
  error,
  onCancel,
  onSubmit,
}: CreateTeamFormProps) {
  const [name, setName] = useState("");
  // The URL name follows the name until the user edits it.
  const [editedSlug, setEditedSlug] = useState<string | null>(null);
  const slug = editedSlug ?? teamSlugFromName(name);
  const canSubmit = Boolean(name.trim()) && Boolean(slug) && !busy;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit({ name: name.trim(), slug });
      }}
    >
      <Stack gap="sm">
        <TextInput
          label="Team name"
          size="xs"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          maxLength={100}
          data-autofocus
          disabled={busy}
        />
        <TextInput
          label="URL name"
          description="Lowercase letters, numbers and dashes."
          size="xs"
          value={slug}
          onChange={(event) =>
            setEditedSlug(
              event.currentTarget.value
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, ""),
            )
          }
          maxLength={63}
          disabled={busy}
        />
        <Text size="xs" c="dimmed">
          Teams are on the Team plan, billed per editor seat. You confirm seats
          and payment at checkout.
        </Text>
        {error && (
          <Text role="alert" size="xs" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button
            variant="subtle"
            size="compact-sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="compact-sm"
            loading={busy}
            disabled={!canSubmit}
          >
            Continue to checkout
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function CreateTeamModal({
  opened,
  ...form
}: CreateTeamFormProps & { opened: boolean }) {
  return (
    <Modal
      opened={opened}
      // A team being created cannot be abandoned halfway.
      onClose={form.busy ? () => undefined : form.onCancel}
      title="Create team"
      size="md"
    >
      <CreateTeamForm {...form} />
    </Modal>
  );
}
