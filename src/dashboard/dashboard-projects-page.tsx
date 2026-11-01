import { useState } from "react";
import {
  ActionIcon,
  Anchor,
  Button,
  Group,
  Loader,
  Menu,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";

export interface DashboardProjectTile {
  id: string;
  name: string;
  detail: string;
  href: string;
}

export interface DashboardProjectSection {
  id: string;
  title: string;
  detail?: string;
  projects: DashboardProjectTile[];
}

export function DashboardProjectsPage({
  sections,
  loading,
  signedIn,
  onSignIn,
}: {
  sections: DashboardProjectSection[];
  loading: boolean;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const shownFilter = sections.some((section) => section.id === filter)
    ? filter
    : "all";
  const query = search.trim().toLocaleLowerCase();
  return (
    <>
      <Group mb="xl" align="center" gap="sm">
        <Title order={1} size={20} mr="md">
          Projects
        </Title>
        <SegmentedControl
          aria-label="Filter projects"
          size="xs"
          value={shownFilter}
          onChange={setFilter}
          data={[
            { value: "all", label: "All" },
            ...sections.map((section) => ({
              value: section.id,
              label: section.title,
            })),
          ]}
        />
        <TextInput
          aria-label="Search projects"
          placeholder="Search projects"
          leftSection={<WorkbenchIcon name="search" size={13} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          w={220}
          ml="auto"
        />
        <Button
          component="a"
          href="/app?newProject=1"
          color="workbench.0"
          autoContrast
          leftSection={<WorkbenchIcon name="plus" size={13} />}
        >
          New project
        </Button>
      </Group>
      {loading && <Loader aria-label="Loading projects" size="sm" mb="md" />}
      {sections
        .filter(
          (section) => shownFilter === "all" || shownFilter === section.id,
        )
        .map((section) => {
          const matches = section.projects.filter((project) =>
            project.name.toLocaleLowerCase().includes(query),
          );
          return (
            <section
              key={section.id}
              aria-label={section.title}
              className="dashboard-section"
            >
              <Group gap={8} mb="sm" align="baseline">
                <Title order={2} size={13}>
                  {section.title}
                </Title>
                <Text size="xs" c="dimmed" ff="monospace">
                  {matches.length}
                </Text>
                {section.detail && (
                  <Text size="xs" c="dimmed">
                    · {section.detail}
                  </Text>
                )}
              </Group>
              <div className="dashboard-tiles">
                {matches.map((project) => (
                  <ProjectTile key={project.id} project={project} />
                ))}
              </div>
              {!matches.length && (
                <Text size="sm" c="dimmed">
                  {query ? "No matching projects." : "No projects here yet."}
                </Text>
              )}
            </section>
          );
        })}
      {!signedIn && (
        <Paper withBorder p="lg" maw={440}>
          <Stack gap="xs">
            <Text fw={500}>Sign in to sync and share</Text>
            <Text size="sm" c="dimmed">
              Your projects on this device work without an account.
            </Text>
            <Button variant="default" onClick={onSignIn}>
              Sign in
            </Button>
          </Stack>
        </Paper>
      )}
    </>
  );
}

function ProjectTile({ project }: { project: DashboardProjectTile }) {
  return (
    <article>
      <Anchor
        className="dashboard-thumbnail"
        href={project.href}
        aria-label={`Open ${project.name}`}
      >
        <WorkbenchIcon name="file" size={36} />
      </Anchor>
      <Group gap={4} wrap="nowrap" mt="xs" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Anchor href={project.href} c="inherit" size="sm" fw={500} truncate>
            {project.name}
          </Anchor>
          <Text size="xs" c="dimmed" truncate>
            {project.detail}
          </Text>
        </Stack>
        <Menu>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={`Actions for ${project.name}`}
            >
              ⋯
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item component="a" href={project.href}>
              Open
            </Menu.Item>
            <Tooltip label="Open the project to share it">
              <span>
                <Menu.Item disabled>Share…</Menu.Item>
              </span>
            </Tooltip>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </article>
  );
}
