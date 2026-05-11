import { Button, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";

import {
  WorkbenchIcon,
  type WorkbenchIconName,
} from "@/components/ui/workbench-icon";

interface WorkbenchInspectorPanelProps {
  children: ReactNode;
  commitDisabled?: boolean;
  commitLabel?: string;
  iconName: WorkbenchIconName;
  onCancel: () => void;
  onCommit: () => void;
  shortCode?: string | null;
  statusLabel?: string;
  title: string;
}

export function WorkbenchInspectorPanel({
  children,
  commitDisabled = false,
  commitLabel = "Commit",
  iconName,
  onCancel,
  onCommit,
  shortCode = null,
  statusLabel = "idle",
  title,
}: WorkbenchInspectorPanelProps) {
  return (
    <Paper
      component="aside"
      className="flex max-h-[70vh] w-[320px] min-w-0 max-w-full flex-col overflow-hidden rounded-[6px]"
      style={{
        background: "var(--workbench-shell-surface-panel-elev)",
        boxShadow: "var(--workbench-shell-elevation-md)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header className="px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
            style={{
              background: "var(--workbench-shell-accent-surface)",
              color: "var(--workbench-shell-accent)",
            }}
          >
            <WorkbenchIcon name={iconName} className="h-3.5 w-3.5" />
          </span>
          <Text
            size="13px"
            fw={500}
            c="dark.0"
            className="min-w-0 flex-1 truncate"
          >
            {title}
          </Text>
          {shortCode ? (
            <Text size="11px" ff="monospace" c="dimmed" className="shrink-0">
              {shortCode}
            </Text>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-1">{children}</div>

      <footer className="flex items-center gap-2 px-3 py-2.5">
        <span
          className="flex items-center gap-1.5 text-[10px] font-mono"
          style={{ color: "var(--workbench-shell-success)" }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "currentColor" }}
          />
          {statusLabel}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          onClick={onCancel}
          variant="subtle"
          color="gray"
          size="xs"
          styles={{
            root: {
              color: "var(--workbench-shell-text-muted)",
            },
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          disabled={commitDisabled}
          size="xs"
          styles={{
            root: {
              backgroundColor: "var(--workbench-shell-accent)",
              color: "var(--workbench-shell-surface)",
            },
          }}
        >
          {commitLabel}
        </Button>
      </footer>
    </Paper>
  );
}
