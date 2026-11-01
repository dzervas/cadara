import {
  Anchor,
  Button,
  Group,
  Modal,
  Paper,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import type { Account } from "@/contracts/account/account";
import {
  preselectProjectLocation,
  projectLocationOptions,
  projectOwners,
  type NewProjectChoice,
  type ProjectLocation,
} from "@/core/account/project-location-options";

export interface NewProjectInput extends NewProjectChoice {
  name: string;
}

export interface NewProjectFormProps {
  account: Account | null;
  offline: boolean;
  lastChoice: NewProjectChoice | null;
  busy: boolean;
  error: string | null;
  /** Hides Local: the project is created to receive a move into the account. */
  accountOnly?: boolean;
  onSignIn: () => void;
  onCancel: () => void;
  onSubmit: (input: NewProjectInput) => void;
}

export function NewProjectForm({
  account,
  offline,
  lastChoice,
  busy,
  error,
  accountOnly = false,
  onSignIn,
  onCancel,
  onSubmit,
}: NewProjectFormProps) {
  const owners = projectOwners(account);
  // The account can arrive after the form opens: until the user picks,
  // the owner and location follow the preselection.
  const [chosenOwnerId, setChosenOwnerId] = useState<string | null>(null);
  const ownerId =
    owners.find((owner) => owner.id === chosenOwnerId)?.id ??
    owners.find((owner) => owner.id === lastChoice?.ownerId)?.id ??
    owners[0]?.id ??
    "";
  const options = projectLocationOptions(account, ownerId, offline).filter(
    (option) => !accountOnly || option.value !== "local",
  );
  const [chosenLocation, setChosenLocation] = useState<ProjectLocation | null>(
    null,
  );
  const location =
    chosenLocation &&
    options.some(
      (option) =>
        option.value === chosenLocation && option.disabledReason === null,
    )
      ? chosenLocation
      : preselectProjectLocation(options, lastChoice?.location ?? null);
  const [name, setName] = useState("");
  const locationAvailable = options.some(
    (option) => option.value === location && option.disabledReason === null,
  );
  const canSubmit = Boolean(name.trim()) && !busy && locationAvailable;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit({ name: name.trim(), location, ownerId });
      }}
    >
      <Stack gap="sm">
        <TextInput
          label="Project name"
          size="xs"
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);
            // Typing freezes the preselection: an account answer arriving
            // meanwhile must not change what Enter creates.
            if (chosenLocation === null) setChosenLocation(location);
            if (chosenOwnerId === null && ownerId) setChosenOwnerId(ownerId);
          }}
          data-autofocus
          disabled={busy}
        />
        {owners.length > 1 && (
          <Select
            label="Owner"
            size="xs"
            data={owners.map((owner) => ({
              value: owner.id,
              label: owner.name,
            }))}
            value={ownerId}
            onChange={(value) => setChosenOwnerId(value)}
            allowDeselect={false}
            disabled={busy}
          />
        )}
        <Radio.Group
          label="Location"
          size="xs"
          value={location}
          onChange={(value) => setChosenLocation(value as ProjectLocation)}
        >
          <Stack gap="xs" mt={4}>
            {options.map((option) => (
              <Paper key={option.value} withBorder p="xs">
                <Stack gap={4}>
                  <Radio
                    value={option.value}
                    label={option.label}
                    description={option.detail}
                    disabled={busy || option.disabledReason !== null}
                  />
                  {option.disabledReason && (
                    <Group gap="xs" pl={28}>
                      <Text size="xs" c="dimmed">
                        {option.disabledReason}
                      </Text>
                      {option.action === "plan" && (
                        <Anchor
                          href="/dashboard/plan"
                          target="_blank"
                          rel="noopener noreferrer"
                          size="xs"
                        >
                          Change plan
                        </Anchor>
                      )}
                      {option.action === "sign-in" && (
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          onClick={onSignIn}
                        >
                          Sign in
                        </Button>
                      )}
                    </Group>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Radio.Group>
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
            Create project
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function NewProjectModal({
  opened,
  ...form
}: NewProjectFormProps & { opened: boolean }) {
  return (
    <Modal
      opened={opened}
      onClose={form.onCancel}
      title="New project"
      size="md"
    >
      <NewProjectForm {...form} />
    </Modal>
  );
}
