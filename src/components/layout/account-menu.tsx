import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import {
  ActionIcon,
  Anchor,
  Indicator,
  Progress,
  Button,
  Popover,
  Stack,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { useId, useState } from "react";
import type { Account } from "@/contracts/account/account";
import { summarizeQuota } from "@/core/account/quota-summary";
import {
  accountTeams,
  rememberChosenOrganization,
} from "@/core/account/account-teams";

export interface AccountPanelProps {
  account: Account | null;
  offline: boolean;
  errorMessage: string | null;
  pendingEmail: string | null;
  busy: boolean;
  passkeyRegistered: boolean;
  onMagicLink: (email: string) => void;
  onSocial: (provider: "google" | "github") => void;
  onPasskey: () => void;
  onRegisterPasskey: () => void;
  onSignOut: () => void;
  /** Offers "Create team": the one mention of teams for an account without one. */
  onCreateTeam?: () => void;
  /**
   * Opens a team's Members page in this page (the dashboard). Without it, a
   * team link opens the dashboard in a new tab on that team.
   */
  onOpenTeam?: (organizationId: string) => void;
}

export function AccountPanel(props: AccountPanelProps) {
  const [email, setEmail] = useState("");
  const teams = accountTeams(props.account);
  return (
    <Stack gap="xs">
      {props.errorMessage && (
        <Text size="xs" c="red" role="alert">
          {props.errorMessage}
        </Text>
      )}
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
          {teams.length > 0 && (
            <>
              <Text size="xs" fw={600}>
                Teams
              </Text>
              {teams.map((team) => (
                <Anchor
                  key={team.id}
                  href="/dashboard/members"
                  size="xs"
                  {...(props.onOpenTeam
                    ? {}
                    : { target: "_blank", rel: "noopener noreferrer" })}
                  onClick={(event) => {
                    if (props.onOpenTeam) {
                      event.preventDefault();
                      props.onOpenTeam(team.id);
                    } else if (props.account)
                      // The new dashboard tab opens its Members page on this team.
                      rememberChosenOrganization(
                        window.localStorage,
                        props.account.user.id,
                        team.id,
                      );
                  }}
                >
                  {team.name} · {team.role}
                </Anchor>
              ))}
            </>
          )}
          {props.account.me.organizations.map((organization) => {
            const quota = summarizeQuota(organization);
            const color =
              quota.severity === "over"
                ? "red"
                : quota.severity === "warning"
                  ? "yellow"
                  : "workbench";
            return (
              <Stack gap={4} key={organization.organizationId}>
                <Text size="xs" fw={600}>
                  {teams.length > 0
                    ? `${
                        props.account?.organizations.find(
                          (org) => org.id === organization.organizationId,
                        )?.name ?? "Account"
                      } storage`
                    : "Storage"}
                </Text>
                <Text size="xs" ff="monospace">
                  {quota.storageLabel}
                </Text>
                <Progress
                  value={quota.storagePercent}
                  color={color}
                  aria-label="Storage usage"
                />
                <Text size="xs" ff="monospace">
                  {quota.privateProjectsLabel}
                </Text>
                {quota.severity === "over" && (
                  <Text size="xs" c="red" role="status">
                    Over quota. New projects, uploads and publishing are
                    blocked. Sync keeps working.
                  </Text>
                )}
              </Stack>
            );
          })}
          <Anchor
            href="/dashboard/plan"
            target="_blank"
            rel="noopener noreferrer"
            size="xs"
          >
            Change plan
          </Anchor>
          {props.onCreateTeam && (
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<WorkbenchIcon name="plus" size={13} />}
              disabled={props.busy}
              onClick={props.onCreateTeam}
            >
              Create team
            </Button>
          )}
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

export function AccountMenu(
  props: AccountPanelProps & {
    onOpen: () => void;
    opened: boolean;
    onOpenedChange: (opened: boolean) => void;
  },
) {
  const severities =
    props.account?.me.organizations.map(
      (org) => summarizeQuota(org).severity,
    ) ?? [];
  const severity = severities.includes("over")
    ? "over"
    : severities.includes("warning")
      ? "warning"
      : "normal";
  const quotaDescriptionId = useId();
  const quotaDescription =
    severity === "over"
      ? "Account over quota"
      : severity === "warning"
        ? "Account quota above 80%"
        : undefined;
  return (
    <Popover
      position="bottom-end"
      width={280}
      shadow="md"
      opened={props.opened}
      onChange={props.onOpenedChange}
    >
      <Popover.Target>
        <Tooltip label={props.account ? "Account" : "Sign in to CADara"}>
          <ActionIcon
            size={32}
            variant="subtle"
            color="workbench"
            aria-describedby={quotaDescription && quotaDescriptionId}
            aria-label="Account"
            onClick={() => {
              props.onOpenedChange(!props.opened);
              if (!props.opened) props.onOpen();
            }}
          >
            <Indicator
              disabled={severity === "normal"}
              color={severity === "over" ? "red" : "yellow"}
              size={6}
              aria-label={quotaDescription}
            >
              <WorkbenchIcon name="account" className="h-4 w-4" />
            </Indicator>
            {/* The button's name stays "Account"; the quota state is its description. */}
            {quotaDescription && (
              <VisuallyHidden id={quotaDescriptionId}>
                {quotaDescription}
              </VisuallyHidden>
            )}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <AccountPanel {...props} />
      </Popover.Dropdown>
    </Popover>
  );
}
