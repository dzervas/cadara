import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { OrganizationPort } from "@/application/account/organization-port";
import type { ProjectRole } from "@/contracts/account/account";
import type {
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  TeamRole,
} from "@/contracts/account/organizations";

const roleLabels: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};
const projectRoleLabels: Record<ProjectRole, string> = {
  admin: "Admin",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};
const assignableRoles = [
  { value: "member", label: roleLabels.member },
  { value: "admin", label: roleLabels.admin },
];
const projectRoleOptions = (
  Object.keys(projectRoleLabels) as ProjectRole[]
).map((role) => ({ value: role, label: projectRoleLabels[role] }));

interface MembersState {
  organization: Organization;
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export interface DashboardMembersPageProps {
  port: OrganizationPort;
  organizationId: string;
  userId: string;
  /** The signed-in account's role in this team. */
  role: TeamRole;
  /** The team was just created, but its checkout could not start. */
  checkoutFailed?: boolean;
}

export function DashboardMembersPage({
  port,
  organizationId,
  userId,
  role,
  checkoutFailed = false,
}: DashboardMembersPageProps) {
  const manager = role === "owner" || role === "admin";
  const [state, setState] = useState<MembersState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        port.getOrganization(organizationId),
        port.listMembers(organizationId),
        manager
          ? port.listInvitations(organizationId)
          : Promise.resolve<OrganizationInvitation[]>([]),
      ]).then(([organization, members, invitations]) => ({
        organization,
        members,
        invitations: invitations.filter(
          (invitation) => invitation.status === "pending",
        ),
      })),
    [port, organizationId, manager],
  );
  // The dashboard keys this page by team, so a load never replaces another team's.
  useEffect(() => {
    let live = true;
    void load()
      .then((next) => live && setState(next))
      .catch((error: unknown) => live && setLoadError(message(error)));
    return () => {
      live = false;
    };
  }, [load]);

  /** Runs one change, then shows the team as the service now has it. */
  const change = async (operation: () => Promise<unknown>) => {
    setPending(true);
    setActionError(null);
    try {
      await operation();
      setState(await load());
      return true;
    } catch (error) {
      setActionError(message(error));
      return false;
    } finally {
      setPending(false);
    }
  };

  if (loadError)
    return (
      <Alert color="red" role="alert" title="Members could not be loaded">
        {loadError}
      </Alert>
    );
  if (!state) return <Loader size="sm" aria-label="Loading members" />;
  const { organization, members, invitations } = state;
  return (
    <Stack gap="xl" maw={880}>
      <Stack gap={2}>
        <Title order={1} size={20}>
          Members
        </Title>
        <Text size="sm" c="dimmed">
          {organization.name}
        </Text>
      </Stack>
      {checkoutFailed && (
        <Alert color="red" role="alert">
          <Text size="sm">
            Your team was created, but checkout could not start.{" "}
            <Anchor component={Link} href="/dashboard/plan" size="sm">
              Try checkout again
            </Anchor>
          </Text>
        </Alert>
      )}
      {actionError && (
        <Alert
          color="red"
          role="alert"
          withCloseButton
          onClose={() => setActionError(null)}
        >
          {actionError}
        </Alert>
      )}
      {manager && (
        <InviteForm
          disabled={pending}
          onInvite={(email, inviteRole) =>
            change(() =>
              port.inviteMember(organizationId, { email, role: inviteRole }),
            )
          }
        />
      )}
      <Section title="Members" count={members.length}>
        <Table verticalSpacing="xs" aria-label="Members">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Member</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Default project role</Table.Th>
              {manager && (
                <Table.Th>
                  <span className="sr-only">Actions</span>
                </Table.Th>
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                self={member.userId === userId}
                manager={manager}
                disabled={pending}
                onChange={(input) =>
                  change(() =>
                    port.updateMember(organizationId, member.id, input),
                  )
                }
                onRemove={() =>
                  change(() => port.removeMember(organizationId, member.id))
                }
              />
            ))}
          </Table.Tbody>
        </Table>
      </Section>
      {manager && invitations.length > 0 && (
        <Section title="Pending invitations" count={invitations.length}>
          <Table verticalSpacing="xs" aria-label="Pending invitations">
            <Table.Tbody>
              {invitations.map((invitation) => (
                <Table.Tr key={invitation.id}>
                  <Table.Td>
                    <Text size="sm">{invitation.email}</Text>
                    <Text size="xs" c="dimmed">
                      Invited as {roleLabels[invitation.role]} · expires{" "}
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      disabled={pending}
                      aria-label={`Revoke the invitation for ${invitation.email}`}
                      onClick={() =>
                        void change(() =>
                          port.cancelInvitation(organizationId, invitation.id),
                        )
                      }
                    >
                      Revoke
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      )}
      <Section title="Sharing">
        <Switch
          label="Allow sharing outside the team"
          description="When off, team projects can be shared only with team members."
          checked={organization.allowExternalSharing}
          disabled={!manager || pending}
          onChange={(event) => {
            const allowExternalSharing = event.currentTarget.checked;
            void change(() =>
              port.updateOrganization(organizationId, {
                allowExternalSharing,
              }),
            );
          }}
        />
      </Section>
    </Stack>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Group gap="xs" mb="xs">
        <Title order={2} size={14}>
          {title}
        </Title>
        {count !== undefined && (
          <Text size="xs" c="dimmed" ff="monospace">
            {count}
          </Text>
        )}
      </Group>
      <Paper withBorder p="sm" bg="var(--workbench-shell-surface-strong)">
        {children}
      </Paper>
    </section>
  );
}

function InviteForm({
  disabled,
  onInvite,
}: {
  disabled: boolean;
  onInvite: (
    email: string,
    role: Exclude<TeamRole, "owner">,
  ) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<TeamRole, "owner">>("member");
  return (
    <form
      aria-label="Invite member"
      onSubmit={(event) => {
        event.preventDefault();
        void onInvite(email.trim(), role).then((sent) => sent && setEmail(""));
      }}
    >
      <Group gap="xs" align="flex-end">
        <TextInput
          label="Invite by email"
          type="email"
          size="xs"
          required
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          disabled={disabled}
          w={280}
        />
        <Select
          label="Role"
          size="xs"
          data={assignableRoles}
          value={role}
          onChange={(value) =>
            value && setRole(value as Exclude<TeamRole, "owner">)
          }
          allowDeselect={false}
          disabled={disabled}
          w={120}
        />
        <Button type="submit" size="xs" disabled={disabled || !email.trim()}>
          Invite
        </Button>
      </Group>
    </form>
  );
}

function MemberRow({
  member,
  self,
  manager,
  disabled,
  onChange,
  onRemove,
}: {
  member: OrganizationMember;
  self: boolean;
  manager: boolean;
  disabled: boolean;
  onChange: (input: {
    role?: Exclude<TeamRole, "owner">;
    defaultProjectRole?: ProjectRole;
  }) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const label = member.user.name || member.user.email;
  // The owner is fixed; owners and admins administer every team project.
  const editable = manager && member.role !== "owner";
  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm">
          {label}
          {self && (
            <Text span size="xs" c="dimmed">
              {" "}
              (you)
            </Text>
          )}
        </Text>
        {member.user.name && (
          <Text size="xs" c="dimmed">
            {member.user.email}
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        {/* An admin keeps their own role: demoting oneself ends this view. */}
        {editable && !self ? (
          <Select
            aria-label={`Role of ${label}`}
            size="xs"
            w={110}
            data={assignableRoles}
            value={member.role}
            onChange={(value) =>
              value &&
              value !== member.role &&
              void onChange({ role: value as Exclude<TeamRole, "owner"> })
            }
            allowDeselect={false}
            disabled={disabled}
          />
        ) : (
          <Text size="sm">{roleLabels[member.role]}</Text>
        )}
      </Table.Td>
      <Table.Td>
        {member.role !== "member" ? (
          <Text size="sm" c="dimmed">
            Admin on every project
          </Text>
        ) : editable ? (
          <Select
            aria-label={`Default project role of ${label}`}
            size="xs"
            w={130}
            data={projectRoleOptions}
            value={member.defaultProjectRole}
            onChange={(value) =>
              value &&
              value !== member.defaultProjectRole &&
              void onChange({ defaultProjectRole: value as ProjectRole })
            }
            allowDeselect={false}
            disabled={disabled}
          />
        ) : (
          <Text size="sm">{projectRoleLabels[member.defaultProjectRole]}</Text>
        )}
      </Table.Td>
      {manager && (
        <Table.Td ta="right">
          {editable && !self && !confirming && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              disabled={disabled}
              aria-label={`Remove ${label}`}
              onClick={() => setConfirming(true)}
            >
              Remove
            </Button>
          )}
          {confirming && (
            <Group gap={4} justify="flex-end" wrap="nowrap">
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                disabled={disabled}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                size="compact-xs"
                color="red"
                disabled={disabled}
                aria-label={`Confirm removing ${label}`}
                onClick={() =>
                  void onRemove().then((removed) => {
                    if (!removed) setConfirming(false);
                  })
                }
              >
                Remove
              </Button>
            </Group>
          )}
        </Table.Td>
      )}
    </Table.Tr>
  );
}
