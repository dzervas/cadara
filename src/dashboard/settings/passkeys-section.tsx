import { useCallback, useEffect, useState } from "react";
import { Button, Group, Loader, Stack, Text } from "@mantine/core";
import type {
  AccountSettingsClient,
  PasskeySummary,
} from "@/infrastructure/account/settings";
import { formatSettingsDate } from "./format-settings-date";
import { SettingsRow, SettingsSection } from "./settings-layout";
import { useSectionError } from "./use-section-error";

export function PasskeysSection({ client }: { client: AccountSettingsClient }) {
  const { error, fail, clear } = useSectionError();
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    () => client.listPasskeys().then(setPasskeys),
    [client],
  );
  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);
  const run = (id: string, operation: () => Promise<void>) => {
    setBusy(id);
    clear();
    operation()
      .then(load)
      .catch(fail)
      .finally(() => setBusy(null));
  };
  return (
    <SettingsSection
      error={error}
      onDismissError={clear}
      title="Passkeys"
      description="Sign in with your device's screen lock or a security key instead of an email link."
    >
      <Stack gap={0}>
        {passkeys === null && (
          <Loader size="xs" aria-label="Loading passkeys" />
        )}
        {passkeys?.length === 0 && (
          <Text size="sm" c="dimmed">
            No passkeys yet.
          </Text>
        )}
        {passkeys?.map((passkey) => (
          <SettingsRow
            key={passkey.id}
            label={passkey.name ?? "Passkey"}
            detail={`Added ${formatSettingsDate(passkey.createdAt)}`}
          >
            <Button
              size="xs"
              variant="subtle"
              color="red"
              loading={busy === passkey.id}
              disabled={busy !== null}
              aria-label={`Remove passkey ${passkey.name ?? ""}`.trim()}
              onClick={() =>
                run(passkey.id, () => client.deletePasskey(passkey.id))
              }
            >
              Remove
            </Button>
          </SettingsRow>
        ))}
      </Stack>
      <Group>
        <Button
          variant="default"
          size="xs"
          loading={busy === "add"}
          disabled={busy !== null}
          onClick={() => run("add", () => client.addPasskey())}
        >
          Add passkey
        </Button>
      </Group>
    </SettingsSection>
  );
}
