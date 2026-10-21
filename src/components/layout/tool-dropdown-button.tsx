import { memo, useState } from "react";
import { flushSync } from "react-dom";
import { ActionIcon, Menu, Text, Tooltip } from "@mantine/core";

import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import { ToolbarToolIcon } from "@/components/layout/toolbar-tool-icon";
import { ToolbarTooltipContent } from "@/components/layout/toolbar-tooltip-content";
import { ShortcutHint } from "@/components/shortcuts/shortcut-hint";
import { getToolbarToolCommandId } from "@/core/shortcuts/commands";
import {
  getToolById,
  type DropdownToolDefinition,
  type RegisteredToolDefinition,
  type ToolId,
} from "@/core/tools/tool-registry";
import {
  pickRecentToolbarTool,
  promoteRecentToolbarTool,
} from "@/core/tools/toolbar-recency";
import { useWorkbenchCommandHandlers } from "@/hooks/use-workbench-command-handlers";
import {
  getToolbarDropdownTriggerStyle,
  toolbarActionIconClassName,
  toolbarDropdownMenuStyle,
} from "@/theme/workbench-toolbar-styles";

export function ToolbarDropdownChevron({ disabled }: { disabled: boolean }) {
  return (
    <WorkbenchIcon
      name="chevronDown"
      className="h-3.5 w-3.5"
      style={{
        color: disabled
          ? "var(--workbench-shell-text-dim)"
          : "var(--workbench-shell-text-muted)",
      }}
    />
  );
}

interface ToolbarToolMenuItemProps {
  tool: RegisteredToolDefinition;
  active?: boolean;
  disabled: boolean;
  onSelect: (tool: RegisteredToolDefinition) => void;
}

export function ToolbarToolMenuItem({
  tool,
  active = false,
  disabled,
  onSelect,
}: ToolbarToolMenuItemProps) {
  return (
    <Menu.Item
      onClick={() => {
        if (!disabled) {
          onSelect(tool);
        }
      }}
      disabled={disabled}
      data-tool-id={tool.id}
      data-tool-name={tool.name}
      data-tool-tooltip={tool.tooltip}
      data-disabled={disabled || undefined}
      data-tool-active={active || undefined}
      leftSection={<ToolbarToolIcon icon={tool.icon} />}
      style={
        active
          ? { backgroundColor: "var(--workbench-shell-accent-surface)" }
          : undefined
      }
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Text size="sm" style={{ color: "var(--workbench-shell-text)" }}>
            {tool.name}
          </Text>
          <ShortcutHint commandId={getToolbarToolCommandId(tool.id)} />
        </div>
        <Text size="xs" style={{ color: "var(--workbench-shell-text-muted)" }}>
          {tool.tooltip}
        </Text>
      </div>
    </Menu.Item>
  );
}

interface ToolDropdownButtonProps {
  tool: DropdownToolDefinition;
  active?: boolean;
  disabled?: boolean;
  activeToolId?: string | null;
  recentToolIds?: readonly string[];
  onToolUsed?: (toolId: ToolId) => void;
}

// Memoized for the same reason as ToolButton: its output depends only on its
// props and the stable command context.
export const ToolDropdownButton = memo(function ToolDropdownButton({
  tool,
  active = false,
  disabled = false,
  activeToolId = null,
  recentToolIds = [],
  onToolUsed,
}: ToolDropdownButtonProps) {
  const { activateTool } = useWorkbenchCommandHandlers();
  const variantTools: RegisteredToolDefinition[] = tool.dropdown.variantIds.map(
    (toolId) => getToolById(toolId),
  );
  const [opened, setOpened] = useState(false);
  // The face follows the active variant, then the last used one (Onshape's
  // "most recent tool moves to the top of its group").
  const faceVariant =
    variantTools.find((variant) => variant.id === activeToolId) ??
    pickRecentToolbarTool(variantTools, recentToolIds);
  const selfVariant = variantTools.find((variant) => variant.id === tool.id);
  // Families that are themselves a variant activate their face on click;
  // pure choosers (Pattern, Dimension) only open the menu.
  const activatedVariant = selfVariant ? (faceVariant ?? selfVariant) : null;
  const describedTool = activatedVariant ?? tool;
  const commandId = getToolbarToolCommandId(describedTool.id);

  const activate = (
    variant: RegisteredToolDefinition,
    source: "toolbar" | "dropdown",
  ) => {
    onToolUsed?.(variant.id);
    void activateTool(variant.id, { source });
  };

  const handleTriggerClick = () => {
    if (disabled) {
      return;
    }

    setOpened(true);

    if (activatedVariant) {
      activate(activatedVariant, "toolbar");
    }
  };

  return (
    <Menu
      width={224}
      opened={opened}
      onChange={setOpened}
      transitionProps={{ duration: 0 }}
    >
      <Menu.Target>
        <Tooltip
          disabled={opened}
          label={
            <ToolbarTooltipContent
              title={describedTool.name}
              description={describedTool.tooltip}
              commandId={commandId}
            />
          }
        >
          <ActionIcon
            type="button"
            onClick={handleTriggerClick}
            variant={active ? "light" : "subtle"}
            color="workbench"
            aria-label={describedTool.name}
            aria-pressed={active}
            disabled={disabled}
            data-tool-id={tool.id}
            data-tool-dropdown-trigger={tool.id}
            data-tool-tooltip={tool.tooltip}
            data-disabled={disabled || undefined}
            className={toolbarActionIconClassName}
            style={getToolbarDropdownTriggerStyle({ active, disabled })}
          >
            <ToolbarToolIcon icon={(faceVariant ?? tool).icon} />
            <ToolbarDropdownChevron disabled={disabled} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown style={toolbarDropdownMenuStyle}>
        {promoteRecentToolbarTool(variantTools, recentToolIds).map(
          (variant) => (
            <ToolbarToolMenuItem
              key={variant.id}
              tool={variant}
              disabled={disabled}
              onSelect={(selected) => {
                flushSync(() => setOpened(false));
                activate(selected, "dropdown");
              }}
            />
          ),
        )}
      </Menu.Dropdown>
    </Menu>
  );
});
