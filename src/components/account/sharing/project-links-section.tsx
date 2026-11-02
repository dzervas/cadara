import { useState } from "react";
import {
  Button,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import type { ProjectAccessFailure } from "@/hooks/use-project-access";

export interface ProjectLinksSectionProps {
  /** Whether links handed out for the project open it. */
  enabled: boolean;
  /** Project admins switch links and rotate them; everyone else reads the state. */
  canManage: boolean;
  /** Whether a published version exists for a link to open. */
  published: boolean;
  /** Why the published versions could not be read. */
  publishedError: string | null;
  /** The link made in this visit; null until Copy link. */
  link: string | null;
  busy: boolean;
  failure: ProjectAccessFailure | null;
  onSetEnabled: (enabled: boolean) => void;
  onRotate: () => void;
  /** Makes a link to the latest published version; resolves to its URL. */
  onMakeLink: () => Promise<string | null>;
}

/**
 * Link sharing: Off, or on. While on, Copy link makes a 7-day link to the
 * latest published version's model file. Turning links off invalidates every
 * link handed out; turning them on starts a new link.
 */
export function ProjectLinksSection({
  enabled,
  canManage,
  published,
  publishedError,
  link,
  busy,
  failure,
  onSetEnabled,
  onRotate,
  onMakeLink,
}: ProjectLinksSectionProps) {
  const [copied, setCopied] = useState<"copied" | "select" | null>(null);
  const copy = async () => {
    setCopied(null);
    const url = await onMakeLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      // The link stays shown for copying by hand.
      setCopied("select");
    }
  };
  return (
    <Stack gap="md" component="section" aria-label="Links">
      <Text fw={600} size="sm">
        Links
      </Text>
      <Paper withBorder p="sm" radius="md">
        <Stack gap="sm">
          <Switch
            label="Anyone with the link can view"
            description={
              enabled
                ? "Copy link shares the latest published model as a file for 7 days."
                : "Off. Turning links on makes a new link; old links never come back."
            }
            checked={enabled}
            disabled={!canManage || busy}
            onChange={(event) => onSetEnabled(event.currentTarget.checked)}
          />
          {canManage && enabled && publishedError && (
            <Text size="xs" c="red" role="alert">
              {publishedError}
            </Text>
          )}
          {canManage && enabled && !published && !publishedError && (
            <Text size="xs" c="dimmed">
              Publish a version to get a link.
            </Text>
          )}
          {canManage && enabled && link && (
            <TextInput
              aria-label="Share link"
              readOnly
              size="xs"
              ff="monospace"
              value={link}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
          {canManage && enabled && (
            <Group gap="xs" grow>
              {published && (
                <Button
                  variant="default"
                  size="xs"
                  disabled={busy}
                  onClick={() => void copy()}
                >
                  Copy link
                </Button>
              )}
              <Button
                variant="default"
                size="xs"
                disabled={busy}
                onClick={() => {
                  setCopied(null);
                  onRotate();
                }}
              >
                Rotate
              </Button>
            </Group>
          )}
          {copied && link && (
            <Text size="xs" c="dimmed" role="status">
              {copied === "copied"
                ? "Link copied. It works for 7 days."
                : "Copy the link above. It works for 7 days."}
            </Text>
          )}
          {failure?.area === "links" && (
            <Text size="xs" c="red" role="alert">
              {failure.error.message}
            </Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
