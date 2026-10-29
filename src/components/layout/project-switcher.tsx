import { Button, Group, Select, TextInput } from "@mantine/core";
import { useState } from "react";

export interface ProjectSwitcherProps {
  projects: { projectId: string; name: string }[];
  activeProjectId: string;
  busy: boolean;
  onSwitch: (projectId: string) => void;
  onCreate: (name: string) => void;
}

export function ProjectSwitcher({
  projects,
  activeProjectId,
  busy,
  onSwitch,
  onCreate,
}: ProjectSwitcherProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  return (
    <Group gap={4} wrap="nowrap" px={6} style={{ flexShrink: 0 }}>
      {creating ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onCreate(name.trim());
            setCreating(false);
            setName("");
          }}
        >
          <Group gap={4} wrap="nowrap">
            <TextInput
              size="xs"
              aria-label="Project name"
              placeholder="Project name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              autoFocus
              disabled={busy}
              w={140}
            />
            <Button
              type="submit"
              size="compact-xs"
              disabled={busy || !name.trim()}
            >
              Create project
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </Group>
        </form>
      ) : (
        <>
          <Select
            aria-label="Project"
            size="xs"
            w={160}
            value={activeProjectId}
            disabled={busy}
            data={projects.map((project) => ({
              value: project.projectId,
              label: project.name,
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
            onClick={() => setCreating(true)}
          >
            New project
          </Button>
        </>
      )}
    </Group>
  );
}
