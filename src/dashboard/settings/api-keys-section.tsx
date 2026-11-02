import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type {
  ApiKeySummary,
  CreatedApiKey,
} from "@/contracts/account/account-settings";
import type {
  AccountSettingsClient,
  ApiKeyAccess,
} from "@/infrastructure/account/settings";
import { formatSettingsDate } from "./format-settings-date";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { useSectionError } from "./use-section-error";

const accessLabel = (key: ApiKeySummary) =>
  key.metadata?.scopes.some((scope) => scope !== "project:read")
    ? "Read & write"
    : "Read only";

export function ApiKeysSection({
  client,
  organizationId,
  workspaceName,
}: {
  client: AccountSettingsClient;
  organizationId: string;
  workspaceName: string;
}) {
  const { error, fail, clear } = useSectionError();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<ApiKeyAccess>("read");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const load = useCallback(
    () => client.listApiKeys(organizationId).then(setKeys),
    [client, organizationId],
  );
  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);
  const create = () => {
    setCreating(true);
    clear();
    client
      .createApiKey(organizationId, name.trim(), access)
      .then((key) => {
        setCreated(key);
        setName("");
        return load();
      })
      .catch(fail)
      .finally(() => setCreating(false));
  };
  const revoke = (key: ApiKeySummary) => {
    setRevokeBusy(true);
    clear();
    client
      .revokeApiKey(organizationId, key.id)
      .then(() => {
        setRevoking(null);
        if (created?.id === key.id) setCreated(null);
        return load();
      })
      .catch((reason: unknown) => {
        // The section shows the failure; it would be hidden behind the modal.
        setRevoking(null);
        fail(reason);
      })
      .finally(() => setRevokeBusy(false));
  };
  return (
    <SettingsSection
      error={error}
      onDismissError={clear}
      title="API keys"
      description={`Keys act as you on ${workspaceName}'s projects. Treat them like passwords.`}
    >
      {created && (
        <Alert
          color="gray"
          title="Copy this key now. It is not shown again."
          withCloseButton
          closeButtonLabel="Dismiss key"
          onClose={() => setCreated(null)}
        >
          <Group gap="sm" wrap="nowrap">
            <Code
              aria-label={`API key ${created.name}`}
              className="min-w-0 flex-1 truncate"
            >
              {created.key}
            </Code>
            <CopyButton value={created.key}>
              {({ copied, copy }) => (
                <Button size="xs" variant="default" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Alert>
      )}
      <Stack gap={0}>
        {keys === null && <Loader size="xs" aria-label="Loading API keys" />}
        {keys?.length === 0 && (
          <Text size="sm" c="dimmed">
            No API keys.
          </Text>
        )}
        {keys?.map((key) => (
          <SettingsRow
            key={key.id}
            label={key.name ?? "API key"}
            detail={`${key.prefix ? `${key.prefix}… · ` : ""}${accessLabel(key)} · Created ${formatSettingsDate(key.createdAt)}`}
          >
            <Button
              size="xs"
              variant="subtle"
              color="red"
              aria-label={`Revoke ${key.name ?? "API key"}`}
              onClick={() => setRevoking(key)}
            >
              Revoke
            </Button>
          </SettingsRow>
        ))}
      </Stack>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <Group align="flex-end" gap="sm">
          <TextInput
            label="Key name"
            size="xs"
            maxLength={32}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            className="flex-1"
          />
          <SegmentedControl
            aria-label="Key access"
            size="xs"
            value={access}
            onChange={(value) => setAccess(value as ApiKeyAccess)}
            data={[
              { value: "read", label: "Read only" },
              { value: "read-write", label: "Read & write" },
            ]}
          />
          <Button
            type="submit"
            size="xs"
            variant="default"
            loading={creating}
            disabled={!name.trim()}
          >
            Create key
          </Button>
        </Group>
      </form>
      <Modal
        opened={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Revoke API key"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Anything using {revoking?.name ?? "this key"} stops working at once.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={revokeBusy}
              onClick={() => revoking && revoke(revoking)}
            >
              Revoke key
            </Button>
          </Group>
        </Stack>
      </Modal>
    </SettingsSection>
  );
}
