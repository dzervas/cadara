import {
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useState } from "react";
import type { ProjectVisibility } from "@/contracts/project-sync/project-service";

export interface ServiceOrganization {
  id: string;
  name: string;
}

export interface ProjectServiceMenuProps {
  /** Null while the account is being checked. */
  signedIn: boolean | null;
  /** The active project already syncs with CADara. */
  linked: boolean;
  busy: boolean;
  onMenuOpen: () => void;
  onUpload: () => void;
  onOpen: () => void;
}

/** The project row's CADara actions. */
export function ProjectServiceMenu({
  signedIn,
  linked,
  busy,
  onMenuOpen,
  onUpload,
  onOpen,
}: ProjectServiceMenuProps) {
  return (
    <Menu position="top-start" withinPortal onOpen={onMenuOpen}>
      <Menu.Target>
        <Button size="compact-xs" variant="subtle" disabled={busy}>
          CADara
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {signedIn === null && <Menu.Label>Checking your account…</Menu.Label>}
        {signedIn === false && (
          <Menu.Label>Sign in from the account menu to sync.</Menu.Label>
        )}
        <Menu.Item disabled={!signedIn || linked} onClick={onUpload}>
          {linked ? "Uploaded to CADara" : "Upload to CADara…"}
        </Menu.Item>
        <Menu.Item disabled={!signedIn} onClick={onOpen}>
          Open from CADara…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export interface UploadProjectInput {
  orgId: string;
  name: string;
  slug: string;
  visibility: ProjectVisibility;
}

export interface UploadProjectFormProps {
  organizations: readonly ServiceOrganization[];
  defaultName: string;
  busy: boolean;
  error: string | null;
  deriveSlug: (name: string) => string;
  onCancel: () => void;
  onSubmit: (input: UploadProjectInput) => void;
}

export function UploadProjectForm({
  organizations,
  defaultName,
  busy,
  error,
  deriveSlug,
  onCancel,
  onSubmit,
}: UploadProjectFormProps) {
  const [orgId, setOrgId] = useState(organizations[0]?.id ?? "");
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<ProjectVisibility>("private");
  const effectiveSlug = slug ?? deriveSlug(name);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!orgId || !name.trim() || !effectiveSlug) return;
        onSubmit({ orgId, name: name.trim(), slug: effectiveSlug, visibility });
      }}
    >
      <Stack gap="sm">
        <Select
          label="Organization"
          size="xs"
          data={organizations.map((org) => ({
            value: org.id,
            label: org.name,
          }))}
          value={orgId}
          onChange={(value) => setOrgId(value ?? "")}
          allowDeselect={false}
          disabled={busy}
        />
        <TextInput
          label="Name"
          size="xs"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          disabled={busy}
        />
        <TextInput
          label="URL name"
          size="xs"
          description="Lowercase letters, digits and dashes."
          value={effectiveSlug}
          onChange={(event) => setSlug(event.currentTarget.value)}
          disabled={busy}
        />
        <SegmentedControl
          size="xs"
          aria-label="Visibility"
          value={visibility}
          onChange={(value) => setVisibility(value as ProjectVisibility)}
          data={[
            { value: "private", label: "Private" },
            { value: "public", label: "Public" },
          ]}
          disabled={busy}
        />
        {error && (
          <Text size="xs" c="red" role="alert">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button size="compact-sm" variant="subtle" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="compact-sm"
            loading={busy}
            disabled={!orgId || !name.trim() || !effectiveSlug}
          >
            Upload
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function UploadProjectModal({
  opened,
  ...form
}: UploadProjectFormProps & { opened: boolean }) {
  return (
    <Modal
      opened={opened}
      onClose={form.onCancel}
      title="Upload to CADara"
      size="sm"
    >
      <UploadProjectForm {...form} />
    </Modal>
  );
}

export interface ServiceProjectChoice {
  id: string;
  name: string;
  /** False until the uploading client registered its documents. */
  available: boolean;
}

export interface OpenServiceProjectFormProps {
  organizations: readonly ServiceOrganization[];
  orgId: string;
  /** Null while the organization's projects load. */
  projects: readonly ServiceProjectChoice[] | null;
  busy: boolean;
  error: string | null;
  onSelectOrganization: (orgId: string) => void;
  onOpen: (projectId: string) => void;
}

export function OpenServiceProjectForm({
  organizations,
  orgId,
  projects,
  busy,
  error,
  onSelectOrganization,
  onOpen,
}: OpenServiceProjectFormProps) {
  return (
    <Stack gap="sm">
      <Select
        label="Organization"
        size="xs"
        data={organizations.map((org) => ({ value: org.id, label: org.name }))}
        value={orgId}
        onChange={(value) => value && onSelectOrganization(value)}
        allowDeselect={false}
        disabled={busy}
      />
      {projects === null ? (
        <Loader size="xs" aria-label="Loading projects" />
      ) : projects.length === 0 ? (
        <Text size="xs" c="dimmed">
          No projects in this organization yet.
        </Text>
      ) : (
        <Stack gap={2} role="list" aria-label="CADara projects">
          {projects.map((project) => (
            <UnstyledButton
              key={project.id}
              role="listitem"
              disabled={busy || !project.available}
              onClick={() => onOpen(project.id)}
              px="xs"
              py={4}
              style={{ borderRadius: "var(--mantine-radius-md)" }}
            >
              <Text size="sm">{project.name}</Text>
              {!project.available && (
                <Text size="xs" c="dimmed">
                  Not uploaded yet
                </Text>
              )}
            </UnstyledButton>
          ))}
        </Stack>
      )}
      {busy && (
        <Text size="xs" c="dimmed" role="status">
          Downloading the project…
        </Text>
      )}
      {error && (
        <Text size="xs" c="red" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}

export function OpenServiceProjectModal({
  opened,
  onClose,
  ...form
}: OpenServiceProjectFormProps & { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Open from CADara" size="sm">
      <OpenServiceProjectForm {...form} />
    </Modal>
  );
}
