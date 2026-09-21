import { Button, Group, Text, Tooltip } from "@mantine/core";

export interface HistoryActionStripEntry {
  sequence: number;
  label: string;
  blockedReason?: string;
}

interface HistoryActionStripProps {
  undo: readonly HistoryActionStripEntry[];
  redo: readonly HistoryActionStripEntry[];
  disabled?: boolean;
  onUndo: (actionSequence: number) => void;
  onRedo: (actionSequence: number) => void;
}

/** Compact contextual controls for deliberately compensating an older independent action. */
export function HistoryActionStrip({
  undo,
  redo,
  disabled = false,
  onUndo,
  onRedo,
}: HistoryActionStripProps) {
  const visible = [
    ...undo
      .slice(-4)
      .reverse()
      .map((entry) => ({ ...entry, direction: "undo" as const })),
    ...redo
      .slice(-2)
      .reverse()
      .map((entry) => ({ ...entry, direction: "redo" as const })),
  ];
  if (visible.length === 0) return null;

  return (
    <Group
      gap={4}
      px={8}
      py={4}
      wrap="nowrap"
      data-history-actions="contextual"
      style={{
        background: "var(--workbench-glass-fill-strong)",
        border: "1px solid var(--workbench-glass-border-strong)",
        borderRadius: "var(--mantine-radius-sm)",
      }}
    >
      <Text c="dimmed" fz={10} fw={600} tt="uppercase">
        Actions
      </Text>
      {visible.map((entry) => {
        const blocked = Boolean(entry.blockedReason);
        const description = blocked
          ? `${entry.label} — blocked: ${entry.blockedReason}`
          : `${entry.direction === "undo" ? "Undo" : "Redo"} ${entry.label}`;
        return (
          <Tooltip
            key={`${entry.direction}:${entry.sequence}`}
            label={description}
          >
            <Button
              aria-label={description}
              color={blocked ? "red" : "workbench"}
              data-history-action-direction={entry.direction}
              data-history-action-sequence={entry.sequence}
              disabled={disabled}
              onClick={() =>
                entry.direction === "undo"
                  ? onUndo(entry.sequence)
                  : onRedo(entry.sequence)
              }
              size="compact-xs"
              variant={blocked ? "light" : "subtle"}
            >
              {entry.direction === "redo" ? "Redo " : ""}
              {entry.label}
            </Button>
          </Tooltip>
        );
      })}
    </Group>
  );
}
