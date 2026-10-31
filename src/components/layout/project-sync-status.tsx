import { Avatar, Badge, Group, Tooltip } from "@mantine/core";
import type { ProjectRole } from "@/contracts/account/account";
import type { ProjectSyncConnection } from "@/contracts/project-sync/project-service";

const CONNECTION_PRESENTATION: Record<
  ProjectSyncConnection,
  { label: string; color: string; description: string }
> = {
  synced: {
    label: "Synced",
    color: "green",
    description: "Every document matches the CADara copy.",
  },
  syncing: {
    label: "Syncing",
    color: "yellow",
    description: "Exchanging changes with CADara.",
  },
  connecting: {
    label: "Connecting",
    color: "gray",
    description: "Connecting to CADara.",
  },
  offline: {
    label: "Offline",
    color: "gray",
    description:
      "Changes are kept in this browser and sync when the connection returns.",
  },
};

export interface ProjectSyncIndicatorProps {
  connection: ProjectSyncConnection;
  /** The role the service grants; viewers and commenters cannot edit parts. */
  role: ProjectRole | null;
  /** Why syncing is unavailable, shown instead of the connection detail. */
  detail?: string | null;
}

/** The synced project's connection state and the user's edit permission. */
export function ProjectSyncIndicator({
  connection,
  role,
  detail,
}: ProjectSyncIndicatorProps) {
  const presentation = CONNECTION_PRESENTATION[connection];
  return (
    <Group gap={4} wrap="nowrap">
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
      {(role === "viewer" || role === "commenter") && (
        <Tooltip
          label={
            role === "commenter"
              ? "You can comment on this project but not edit its parts."
              : "You can view this project but not edit it."
          }
          multiline
          maw={260}
        >
          <Badge variant="outline" color="gray" size="sm">
            Read only
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

export interface ProjectPresenceParticipant {
  key: string;
  name: string;
  /** The name of the part the participant has open. */
  activePartName: string | null;
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]![0]}${words.at(-1)![0]}`
      : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Everyone else in the synced project, with the part they have open. */
export function ProjectPresenceStrip({
  participants,
}: {
  participants: readonly ProjectPresenceParticipant[];
}) {
  if (!participants.length) return null;
  return (
    <Avatar.Group spacing={6} role="list" aria-label="People in this project">
      {participants.map((participant) => {
        const description = participant.activePartName
          ? `${participant.name} · ${participant.activePartName}`
          : participant.name;
        return (
          <Tooltip key={participant.key} label={description}>
            <Avatar
              size={22}
              radius="xl"
              color="gray"
              role="listitem"
              aria-label={description}
              data-project-presence-name={participant.name}
            >
              {initials(participant.name)}
            </Avatar>
          </Tooltip>
        );
      })}
    </Avatar.Group>
  );
}
