import { Button, Group, Select } from "@mantine/core";

export interface ProjectSwitcherProps {
  /** `group` is where the project lives: "On this device" or its account owner. */
  projects: { projectId: string; name: string; group: string }[];
  activeProjectId: string;
  busy: boolean;
  onSwitch: (projectId: string) => void;
  /** Opens the New project modal. */
  onCreate: () => void;
}

export function ProjectSwitcher({
  projects,
  activeProjectId,
  busy,
  onSwitch,
  onCreate,
}: ProjectSwitcherProps) {
  const groups = [...new Set(projects.map((project) => project.group))];
  return (
    <Group gap={4} wrap="nowrap" px={6} style={{ flexShrink: 0 }}>
      <Select
        aria-label="Project"
        size="xs"
        w={160}
        value={activeProjectId}
        disabled={busy}
        data={groups.map((group) => ({
          group,
          items: projects
            .filter((project) => project.group === group)
            .map((project) => ({
              value: project.projectId,
              label: project.name,
            })),
        }))}
        onChange={(value) => {
          if (value) onSwitch(value);
        }}
        allowDeselect={false}
      />
      <Button
        size="compact-xs"
        variant="subtle"
        disabled={busy}
        onClick={onCreate}
      >
        New project
      </Button>
    </Group>
  );
}
