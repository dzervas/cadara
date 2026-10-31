import {
  Avatar,
  Badge,
  Group,
  Tooltip,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { ProjectRole } from "@/contracts/account/account";
import type { ProjectSyncConnection } from "@/contracts/project-sync/project-service";

// Quiet Chrome Rule (DESIGN.md): healthy states show no badge; only states
// the user must notice (offline, a failure) carry one, in status colour.
const OFFLINE_PRESENTATION = {
  label: "Offline",
  color: "yellow",
  description:
    "Changes are kept in this browser and sync when the connection returns.",
};
const FAILED_PRESENTATION = {
  label: "Sync error",
  color: "red",
  description: "Project sync failed.",
};

const READ_ONLY_PRESENTATION: Partial<
  Record<ProjectRole, { label: string; description: string }>
> = {
  viewer: {
    label: "Read only · Viewer",
    description: "You can view this project but not edit it.",
  },
  commenter: {
    label: "Read only · Commenter",
    description: "You can comment on this project but not edit its parts.",
  },
};

export interface ProjectSyncIndicatorProps {
  connection: ProjectSyncConnection;
  /** The role the service grants; viewers and commenters cannot edit parts. */
  role: ProjectRole | null;
  /** Why syncing is unavailable, shown instead of the connection detail. */
  detail?: string | null;
  /** Syncing failed to start: the badge shows the danger colour. */
  failed?: boolean;
}

/** The synced project's connection state and the user's edit permission. */
export function ProjectSyncIndicator({
  connection,
  role,
  detail,
  failed = false,
}: ProjectSyncIndicatorProps) {
  const presentation = failed
    ? FAILED_PRESENTATION
    : connection === "offline"
      ? OFFLINE_PRESENTATION
      : null;
  // Follows the role, not the connection: it stays while offline or
  // reconnecting, since the role of the last sync token still applies.
  const readOnly = role ? READ_ONLY_PRESENTATION[role] : undefined;
  if (!presentation && !readOnly) return null;
  return (
    <Group gap={4} wrap="nowrap">
      {presentation && (
        <Tooltip label={detail ?? presentation.description} multiline maw={260}>
          <Badge
            variant="dot"
            color={presentation.color}
            size="sm"
            role="status"
            aria-label={`Sync status: ${presentation.label}`}
            data-project-sync-connection={connection}
          >
            {presentation.label}
          </Badge>
        </Tooltip>
      )}
      {readOnly && (
        <Tooltip label={readOnly.description} multiline maw={260}>
          <Badge
            variant="outline"
            color="gray"
            size="sm"
            role="status"
            aria-label={readOnly.label}
          >
            {readOnly.label}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

export interface ProjectPresenceParticipant {
  key: string;
  name: string;
  role: ProjectRole | null;
  color: string;
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]![0]}${words.at(-1)![0]}`
      : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Other people only; the caller excludes the current account. */
export function ProjectPresenceStrip({
  participants,
}: {
  participants: readonly ProjectPresenceParticipant[];
}) {
  if (!participants.length) return null;
  const description = (participant: ProjectPresenceParticipant) =>
    `${participant.name} · ${participant.role ?? "Participant"}`;
  return (
    <Group gap={4} wrap="nowrap">
      <Avatar.Group spacing={8} role="list" aria-label="People in this project">
        {participants.slice(0, 4).map((participant) => (
          <Tooltip
            key={participant.key}
            label={description(participant)}
            events={{ hover: true, focus: true, touch: false }}
          >
            <Avatar
              size={28}
              radius="xl"
              color="gray"
              role="listitem"
              tabIndex={0}
              aria-label={description(participant)}
              data-project-presence-name={participant.name}
              data-project-presence-color={participant.color}
              style={{ border: `2px solid ${participant.color}` }}
            >
              {initials(participant.name)}
            </Avatar>
          </Tooltip>
        ))}
      </Avatar.Group>
      {participants.length > 4 && (
        <Popover position="bottom-end" withArrow={false} trapFocus returnFocus>
          <Popover.Target>
            <UnstyledButton
              aria-label={`${participants.length - 4} more people in this project`}
              style={{
                borderRadius: 14,
                padding: "4px 8px",
                background: "var(--workbench-glass-fill)",
              }}
            >
              +{participants.length - 4}
            </UnstyledButton>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap={6} role="list" aria-label="More people in this project">
              {participants.slice(4).map((participant) => (
                <Group
                  key={participant.key}
                  gap={8}
                  role="listitem"
                  wrap="nowrap"
                >
                  <Avatar
                    size={24}
                    radius="xl"
                    color="gray"
                    style={{ border: `2px solid ${participant.color}` }}
                  >
                    {initials(participant.name)}
                  </Avatar>
                  <Text size="xs">{description(participant)}</Text>
                </Group>
              ))}
            </Stack>
          </Popover.Dropdown>
        </Popover>
      )}
    </Group>
  );
}
