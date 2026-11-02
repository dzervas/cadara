import { useMemo, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ACCOUNT_SESSION_CHANGED } from "@/application/account/account-session";
import type { Account } from "@/contracts/account/account";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import {
  createAccountSettingsClient,
  type AccountSettingsClient,
} from "@/infrastructure/account/settings";
import { ApiKeysSection } from "./api-keys-section";
import { PasskeysSection } from "./passkeys-section";
import { SettingsSection } from "./settings-layout";
import { useSectionError } from "./use-section-error";

/** Tells this tab's and other tabs' account sessions to reload the account. */
function announceAccountChanged() {
  window.localStorage.setItem(ACCOUNT_SESSION_CHANGED, String(Date.now()));
  window.dispatchEvent(new Event(ACCOUNT_SESSION_CHANGED));
}

export function SettingsPage({
  account,
  organizationId,
  workspaceName,
}: {
  account: Account;
  /** The workspace selected in the sidebar; API keys belong to it. */
  organizationId: string;
  workspaceName: string;
}) {
  const client = useMemo(
    () => createAccountSettingsClient({ apiOrigin: getAccountApiOrigin() }),
    [],
  );
  return (
    <Stack gap="xl" maw={640}>
      <Title order={1} size={20}>
        Settings
      </Title>
      <ProfileSection client={client} account={account} />
      <PasskeysSection client={client} />
      <ApiKeysSection
        key={organizationId}
        client={client}
        organizationId={organizationId}
        workspaceName={workspaceName}
      />
      <ExportSection client={client} />
      <DeleteAccountSection client={client} account={account} />
    </Stack>
  );
}

function ProfileSection({
  client,
  account,
}: {
  client: AccountSettingsClient;
  account: Account;
}) {
  const { error, fail, clear } = useSectionError();
  const [name, setName] = useState(account.user.name);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const save = () => {
    setSaving(true);
    clear();
    client
      .updateName(trimmed)
      .then(announceAccountChanged)
      .catch(fail)
      .finally(() => setSaving(false));
  };
  return (
    <SettingsSection title="Profile" error={error} onDismissError={clear}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Stack gap="sm">
          <Group align="flex-end" gap="sm">
            <TextInput
              label="Name"
              size="xs"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="flex-1"
            />
            <Button
              type="submit"
              size="xs"
              variant="default"
              loading={saving}
              disabled={!trimmed || trimmed === account.user.name}
            >
              Save
            </Button>
          </Group>
          <div>
            <Text size="xs" c="dimmed">
              Email
            </Text>
            <Text size="sm">{account.user.email}</Text>
          </div>
        </Stack>
      </form>
    </SettingsSection>
  );
}

function ExportSection({ client }: { client: AccountSettingsClient }) {
  const { error, fail, clear } = useSectionError();
  const [exporting, setExporting] = useState(false);
  const exportData = () => {
    setExporting(true);
    clear();
    client
      .downloadExport()
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "cadara-account.zip";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      })
      .catch(fail)
      .finally(() => setExporting(false));
  };
  return (
    <SettingsSection
      title="Your data"
      description="Download a zip of your account, projects and files."
      error={error}
      onDismissError={clear}
    >
      <Group>
        <Button
          size="xs"
          variant="default"
          loading={exporting}
          onClick={exportData}
        >
          Export all data
        </Button>
      </Group>
    </SettingsSection>
  );
}

function DeleteAccountSection({
  client,
  account,
}: {
  client: AccountSettingsClient;
  account: Account;
}) {
  const { error, fail, clear } = useSectionError();
  const [opened, setOpened] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const close = () => {
    setOpened(false);
    setConfirmation("");
  };
  const confirmed =
    confirmation.trim().toLocaleLowerCase() ===
    account.user.email.toLocaleLowerCase();
  const deleteAccount = () => {
    setDeleting(true);
    clear();
    client
      .deleteAccount()
      .then((result) => {
        if (result.deleted) {
          announceAccountChanged();
          window.location.assign("/dashboard");
          return;
        }
        close();
        setDeleting(false);
        const names = result.ownedOrganizationIds.map(
          (id) =>
            account.organizations.find((org) => org.id === id)?.name ?? id,
        );
        fail(
          new Error(
            `Transfer or delete these teams first: ${names.join(", ")}.`,
          ),
        );
      })
      .catch((reason: unknown) => {
        close();
        setDeleting(false);
        fail(reason);
      });
  };
  return (
    <SettingsSection
      title="Delete account"
      description="Deletes your account and personal projects. Signing in with an email link within 30 days restores it."
      danger
      error={error}
      onDismissError={clear}
    >
      <Group>
        <Button
          size="xs"
          color="red"
          variant="light"
          onClick={() => setOpened(true)}
        >
          Delete account…
        </Button>
      </Group>
      <Modal
        opened={opened}
        onClose={close}
        title="Delete account"
        centered
        size="sm"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed) deleteAccount();
          }}
        >
          <Stack gap="md">
            <Text size="sm">
              Deletes your account and personal projects. Signing in with an
              email link within 30 days restores it.
            </Text>
            <TextInput
              label={`Type ${account.user.email} to confirm`}
              size="xs"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              data-autofocus
            />
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                color="red"
                loading={deleting}
                disabled={!confirmed}
              >
                Delete account
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </SettingsSection>
  );
}
