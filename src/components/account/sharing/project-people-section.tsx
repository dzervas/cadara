import {
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Anchor,
  Avatar,
  Button,
  Group,
  Menu,
  NativeSelect,
  Paper,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { ProjectRole } from "@/contracts/account/account";
import type { ProjectPeople } from "@/contracts/account/project-access";
import { ProjectAccessRefusal } from "@/application/account/project-access-port";
import {
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  editorLimitReached,
  inviteExpiryLabel,
  personInitials,
  projectPersonRows,
  type ProjectPersonRow,
} from "@/core/account/project-people-view";
import type { ProjectAccessFailure } from "@/hooks/use-project-access";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";

export interface ProjectPeopleSectionProps {
  people: ProjectPeople;
  /** The signed-in user, to mark their own row. */
  userId: string | null;
  /** Individually invited people may leave; team members leave the team. */
  canLeave: boolean;
  /** The user owns the plan, so Change plan is theirs to act on. */
  ownsPlan: boolean;
  busy: boolean;
  failure: ProjectAccessFailure | null;
  /** Milliseconds since the epoch, for invite expiry. */
  now: number;
  onInvite: (email: string, role: ProjectRole) => Promise<boolean>;
  onResendInvite: (inviteId: string) => void;
  onRevokeInvite: (inviteId: string) => void;
  onSetRole: (userId: string, role: ProjectRole) => void;
  onRemovePerson: (userId: string) => void;
  onLeave: () => void;
  /** Opens Usage & plan in place; without it Change plan opens a new tab. */
  onChangePlan?: () => void;
}

const roleOptions = PROJECT_ROLES.map((role) => ({
  value: role,
  label: PROJECT_ROLE_LABELS[role],
}));

/**
 * Who has access to a project. Everyone with access sees the list; project
 * admins also get the invite field, role menus and pending invites.
 */
export function ProjectPeopleSection({
  people,
  userId,
  canLeave,
  ownsPlan,
  busy,
  failure,
  now,
  onInvite,
  onResendInvite,
  onRevokeInvite,
  onSetRole,
  onRemovePerson,
  onLeave,
  onChangePlan,
}: ProjectPeopleSectionProps) {
  const rows = projectPersonRows(people, userId);
  const manage = people.can_manage;
  return (
    <Stack gap="md" component="section" aria-label="People">
      <Text fw={600} size="sm">
        People
      </Text>
      {/* The limit matters to whoever invites. */}
      {manage && people.editors && <EditorsBar editors={people.editors} />}
      {manage && (
        <InviteRow
          people={people}
          ownsPlan={ownsPlan}
          busy={busy}
          failure={failure?.area === "invite" ? failure.error : null}
          onInvite={onInvite}
          onChangePlan={onChangePlan}
        />
      )}
      {!people.organization.personal && (
        <PeopleBox title="Team access">
          <PersonLine
            avatar={people.organization.name.slice(0, 1).toUpperCase()}
            name={`Everyone in ${people.organization.name}`}
            detail="Team members' default role for team projects"
            action={
              people.organization.default_project_role && (
                <Text size="sm" c="dimmed">
                  {
                    PROJECT_ROLE_LABELS[
                      people.organization.default_project_role
                    ]
                  }
                </Text>
              )
            }
          />
        </PeopleBox>
      )}
      <PeopleBox title="People" count={rows.length}>
        {rows.map((row) => (
          <PersonLine
            key={row.userId}
            avatar={personInitials(row)}
            image={row.image}
            name={`${row.name || row.email}${row.you ? " (you)" : ""}`}
            detail={row.name ? row.email : undefined}
            action={
              row.owner ? (
                <Text size="sm" c="dimmed">
                  Owner · Admin
                </Text>
              ) : manage ? (
                <RoleMenu
                  row={row}
                  busy={busy}
                  onSetRole={(role) => onSetRole(row.userId, role)}
                  onRemove={() => onRemovePerson(row.userId)}
                />
              ) : (
                <Text size="sm" c="dimmed">
                  {PROJECT_ROLE_LABELS[row.role]}
                </Text>
              )
            }
          />
        ))}
        {!rows.length && (
          <Text size="sm" c="dimmed" p="sm">
            Nobody else has access yet.
          </Text>
        )}
      </PeopleBox>
      {people.pending.length > 0 && (
        <PeopleBox title="Pending invites" count={people.pending.length}>
          {people.pending.map((invite) => (
            <PersonLine
              key={invite.invite_id}
              avatar={<WorkbenchIcon name="account" size={14} />}
              name={invite.email}
              detail={`Invited as ${PROJECT_ROLE_LABELS[invite.role]} · ${inviteExpiryLabel(invite.expires_at, now)}`}
              action={
                <Group gap="xs" wrap="nowrap">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={busy}
                    aria-label={`Resend invite to ${invite.email}`}
                    onClick={() => onResendInvite(invite.invite_id)}
                  >
                    Resend
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={busy}
                    aria-label={`Revoke invite to ${invite.email}`}
                    onClick={() => onRevokeInvite(invite.invite_id)}
                  >
                    Revoke
                  </Button>
                </Group>
              }
            />
          ))}
        </PeopleBox>
      )}
      {failure?.area === "people" && (
        <Text size="xs" c="red" role="alert">
          {failure.error.message}
        </Text>
      )}
      {canLeave && (
        <Group>
          <Button
            variant="default"
            color="red"
            size="xs"
            disabled={busy}
            onClick={onLeave}
          >
            Leave project
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function EditorsBar({ editors }: { editors: { limit: number; used: number } }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Group gap="lg" wrap="nowrap">
        <Stack gap={6} w={180} style={{ flexShrink: 0 }}>
          <Group justify="space-between" gap="xs">
            <Text size="xs" c="dimmed">
              Editors
            </Text>
            <Text size="xs" ff="monospace">
              {editors.used} / {editors.limit}
            </Text>
          </Group>
          <Progress
            size={4}
            radius="xl"
            color={editors.used >= editors.limit ? "red" : "workbench.2"}
            aria-label="Editors on this project"
            value={Math.min(100, (editors.used / editors.limit) * 100)}
          />
        </Stack>
        <Text size="xs" c="dimmed">
          The plan's editor limit per project, pending invites included. Viewers
          and commenters are unlimited.
        </Text>
      </Group>
    </Paper>
  );
}

function InviteRow({
  people,
  ownsPlan,
  busy,
  failure,
  onInvite,
  onChangePlan,
}: {
  people: ProjectPeople;
  ownsPlan: boolean;
  busy: boolean;
  failure: Error | null;
  onInvite: (email: string, role: ProjectRole) => Promise<boolean>;
  onChangePlan?: () => void;
}) {
  const [email, setEmail] = useState("");
  // A full editor quota starts on a role that fits instead of an alert.
  const [role, setRole] = useState<ProjectRole>(() =>
    editorLimitReached(people, "editor") ? "viewer" : "editor",
  );
  const reached = editorLimitReached(people, role);
  const refusedLimit =
    failure instanceof ProjectAccessRefusal &&
    failure.reason.kind === "editor-limit"
      ? failure.reason
      : null;
  const limit = reached ?? refusedLimit;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onInvite(email.trim(), role)) setEmail("");
  };
  return (
    <Stack gap={6}>
      <Paper withBorder p={6} radius="md">
        <form onSubmit={(event) => void submit(event)}>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              aria-label="Invite by email"
              placeholder="Invite by email"
              type="email"
              variant="unstyled"
              px="xs"
              style={{ flex: 1 }}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <NativeSelect
              aria-label="Role for the invite"
              size="xs"
              variant="unstyled"
              data={roleOptions}
              value={role}
              onChange={(event) =>
                setRole(event.currentTarget.value as ProjectRole)
              }
            />
            <Button
              type="submit"
              size="xs"
              color="workbench.0"
              autoContrast
              disabled={busy || !email.trim() || reached !== null}
            >
              Invite
            </Button>
          </Group>
        </form>
      </Paper>
      {limit ? (
        <Group gap="xs" role="alert">
          <Text size="xs" c="red">
            {`This project has ${limit.used} of ${limit.limit} editors its plan allows. Invite as a commenter or viewer instead${ownsPlan ? "." : ", or ask the owner to change plan."}`}
          </Text>
          {ownsPlan && (
            <Anchor
              href="/dashboard/plan"
              size="xs"
              {...(onChangePlan
                ? {
                    onClick: (event: MouseEvent) => {
                      event.preventDefault();
                      onChangePlan();
                    },
                  }
                : { target: "_blank", rel: "noopener noreferrer" })}
            >
              Change plan
            </Anchor>
          )}
        </Group>
      ) : (
        failure && (
          <Text size="xs" c="red" role="alert">
            {failure.message}
          </Text>
        )
      )}
    </Stack>
  );
}

function RoleMenu({
  row,
  busy,
  onSetRole,
  onRemove,
}: {
  row: ProjectPersonRow;
  busy: boolean;
  onSetRole: (role: ProjectRole) => void;
  onRemove: () => void;
}) {
  const who = row.name || row.email;
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          disabled={busy}
          aria-label={`Role of ${who}: ${PROJECT_ROLE_LABELS[row.role]}`}
          rightSection={<WorkbenchIcon name="chevronDown" size={12} />}
        >
          {PROJECT_ROLE_LABELS[row.role]}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {PROJECT_ROLES.map((role) => (
          <Menu.Item
            key={role}
            onClick={() => role !== row.role && onSetRole(role)}
            rightSection={
              role === row.role ? (
                <WorkbenchIcon name="check" size={12} />
              ) : undefined
            }
          >
            {PROJECT_ROLE_LABELS[role]}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item color="red" onClick={onRemove}>
          Remove
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function PeopleBox({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Stack gap={6} role="group" aria-label={title}>
      <Group gap={8} px={4}>
        <Text size="xs" c="dimmed">
          {title}
        </Text>
        {count !== undefined && (
          <Text size="xs" c="dimmed" ff="monospace">
            {count}
          </Text>
        )}
      </Group>
      <Paper
        withBorder
        radius="md"
        role="list"
        className="[&>*+*]:border-t [&>*+*]:border-(--workbench-shell-border)"
      >
        {children}
      </Paper>
    </Stack>
  );
}

function PersonLine({
  avatar,
  image,
  name,
  detail,
  action,
}: {
  avatar: ReactNode;
  image?: string | null;
  name: string;
  detail?: string;
  action: ReactNode;
}) {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      px="sm"
      py={8}
      role="listitem"
      aria-label={name}
    >
      <Avatar size={30} radius="xl" src={image ?? undefined}>
        {avatar}
      </Avatar>
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500} truncate>
          {name}
        </Text>
        {detail && (
          <Text size="xs" c="dimmed" truncate>
            {detail}
          </Text>
        )}
      </Stack>
      {action}
    </Group>
  );
}
