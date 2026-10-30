import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import {
  ActionIcon,
  Button,
  Popover,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useState } from "react";
import type { Account } from "@/contracts/account/account";

export interface AccountPanelProps {
  account: Account | null;
  offline: boolean;
  pendingEmail: string | null;
  busy: boolean;
  passkeyRegistered: boolean;
  onMagicLink: (email: string) => void;
  onSocial: (provider: "google" | "github") => void;
  onPasskey: () => void;
  onRegisterPasskey: () => void;
  onSignOut: () => void;
}

export function AccountPanel(props: AccountPanelProps) {
  const [email, setEmail] = useState("");
  return (
    <Stack gap="xs">
      {props.offline && (
        <Text size="xs" c="dimmed" role="status">
          Account offline · unable to check your session.
        </Text>
      )}
      {props.account ? (
        <>
          <Text size="sm" fw={600}>
            {props.account.user.name || "Account"}
          </Text>
          <Text size="xs" c="dimmed">
            {props.account.user.email}
          </Text>
          <Text size="xs" fw={600}>
            Organizations
          </Text>
          {props.account.organizations.map((org) => (
            <Text size="xs" key={org.id}>
              {org.name} ·{" "}
              {
                props.account?.me.actor.memberships.find(
                  (entry) => entry.organizationId === org.id,
                )?.role
              }
            </Text>
          ))}
          {props.passkeyRegistered && (
            <Text size="xs" role="status">
              Passkey registered.
            </Text>
          )}
          <Button
            size="compact-sm"
            variant="default"
            disabled={props.busy}
            onClick={props.onRegisterPasskey}
          >
            Register passkey
          </Button>
          <Button
            size="compact-sm"
            variant="subtle"
            disabled={props.busy}
            onClick={props.onSignOut}
          >
            Sign out
          </Button>
        </>
      ) : (
        <>
          <Text size="sm" fw={600}>
            Sign in to CADara
          </Text>
          <Text size="xs" c="dimmed">
            Your local projects work without an account.
          </Text>
          {props.pendingEmail && (
            <Text size="xs" role="status">
              Check your inbox at {props.pendingEmail} for a sign-in link.
            </Text>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              props.onMagicLink(email.trim());
            }}
          >
            <Stack gap="xs">
              <TextInput
                label="Email"
                type="email"
                size="xs"
                required
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                disabled={props.busy}
              />
              <Button
                type="submit"
                size="compact-sm"
                disabled={props.busy || !email.trim()}
              >
                Email sign-in link
              </Button>
            </Stack>
          </form>
          <Button
            size="compact-sm"
            variant="default"
            disabled={props.busy}
            onClick={() => props.onSocial("google")}
          >
            Continue with Google
          </Button>
          <Button
            size="compact-sm"
            variant="default"
            disabled={props.busy}
            onClick={() => props.onSocial("github")}
          >
            Continue with GitHub
          </Button>
          <Button
            size="compact-sm"
            variant="subtle"
            disabled={props.busy}
            onClick={props.onPasskey}
          >
            Sign in with passkey
          </Button>
        </>
      )}
    </Stack>
  );
}

export function AccountMenu(props: AccountPanelProps & { onOpen: () => void }) {
  return (
    <Popover
      position="bottom-end"
      width={280}
      shadow="md"
      onChange={(opened) => {
        if (opened) props.onOpen();
      }}
    >
      <Popover.Target>
        <Tooltip label={props.account ? "Account" : "Sign in to CADara"}>
          <ActionIcon
            size={32}
            variant="subtle"
            color="workbench"
            aria-label="Account"
          >
            <WorkbenchIcon name="account" className="h-4 w-4" />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <AccountPanel {...props} />
      </Popover.Dropdown>
    </Popover>
  );
}
