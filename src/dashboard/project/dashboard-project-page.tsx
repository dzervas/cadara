import { useState } from "react";
import { Link } from "wouter";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { ProjectAccessPort } from "@/application/account/project-access-port";
import type { Account } from "@/contracts/account/account";
import type { RemoteProject } from "@/contracts/project-sync/project-service";
import { projectOwnerName } from "@/core/account/project-people-view";
import { useProjectAccess } from "@/hooks/use-project-access";
import {
  ProjectAccessLinks,
  ProjectAccessPeople,
} from "@/components/account/sharing/project-access-sections";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";

/**
 * One account project on one scrolling page: header, People, Links and the
 * Danger zone. The People and Links sections are the Share dialog's.
 */
export function DashboardProjectPage({
  projectId,
  account,
  accountChecked,
  projects,
  port,
  onSignIn,
  onDeleted,
  onLeft,
  onChangePlan,
}: {
  projectId: string;
  account: Account | null;
  /** Whether the session check answered; until then a null account is unknown. */
  accountChecked: boolean;
  /** The account's projects; null while they load. */
  projects: RemoteProject[] | null;
  port: ProjectAccessPort;
  onSignIn: () => void;
  onDeleted: () => void;
  /** The user left the project and no longer has access. */
  onLeft: () => void;
  onChangePlan: () => void;
}) {
  const listed = projects?.find((project) => project.id === projectId);
  const access = useProjectAccess(
    port,
    listed ? { orgId: listed.organization_id, projectId } : null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!account && !accountChecked)
    return <Loader size="sm" aria-label="Loading project" />;
  if (!account)
    return (
      <Stack align="flex-start">
        <Text>Sign in to see this project.</Text>
        <Button onClick={onSignIn}>Sign in</Button>
      </Stack>
    );
  if (projects && !listed)
    return (
      <Stack align="flex-start">
        <Title order={1} size={20}>
          Project not found
        </Title>
        <Text c="dimmed">
          It was deleted, or it is no longer shared with you.
        </Text>
        <Anchor component={Link} href="/dashboard">
          Back to projects
        </Anchor>
      </Stack>
    );
  if (access.loadError)
    return (
      <Alert color="red" role="alert">
        {access.loadError}
      </Alert>
    );
  const { details, people } = access;
  if (!listed || !details || !people)
    return <Loader size="sm" aria-label="Loading project" />;

  const editorHref = `/app/p/${encodeURIComponent(projectId)}${window.location.search}`;
  return (
    <Stack gap="xl">
      <Anchor component={Link} href="/dashboard" size="sm" c="dimmed">
        ← Projects
      </Anchor>
      <Group gap="lg" align="flex-end" wrap="nowrap">
        <div className="dashboard-thumbnail w-40 shrink-0">
          <WorkbenchIcon name="file" size={40} />
        </div>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Title order={1} size={22}>
            {details.name}
          </Title>
          <Group gap="xs">
            <Badge variant="outline" color="gray" size="sm" radius="sm">
              {details.visibility === "public" ? "Public" : "Private"}
            </Badge>
            <Text size="sm" c="dimmed">
              {projectOwnerName(people)}
            </Text>
            <Text size="sm" c="dimmed">
              · Updated {new Date(details.updated_at).toLocaleDateString()}
            </Text>
          </Group>
        </Stack>
        <Button
          component="a"
          href={editorHref}
          color="workbench.0"
          autoContrast
        >
          Open in editor
        </Button>
      </Group>
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ProjectAccessPeople
          access={access}
          account={account}
          orgId={listed.organization_id}
          onLeft={onLeft}
          onChangePlan={onChangePlan}
        />
        <Stack gap="xl">
          <ProjectAccessLinks access={access} />
          {people.can_manage && (
            <Stack gap="md" component="section" aria-label="Danger zone">
              <Text fw={600} size="sm">
                Danger zone
              </Text>
              <Paper withBorder p="sm" radius="md">
                <Button
                  variant="outline"
                  color="red"
                  fullWidth
                  disabled={access.busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete project
                </Button>
              </Paper>
              {access.failure?.area === "danger" && (
                <Text size="xs" c="red" role="alert">
                  {access.failure.error.message}
                </Text>
              )}
            </Stack>
          )}
        </Stack>
      </div>
      <Modal
        opened={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${details.name}?`}
      >
        <Stack>
          <Text size="sm">
            Everyone loses access to the project and its documents.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={access.busy}
              onClick={() =>
                void access.deleteProject().then((deleted) => {
                  setConfirmDelete(false);
                  if (deleted) onDeleted();
                })
              }
            >
              Delete project
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
