import { useState } from "react";
import { flushSync } from "react-dom";
import { ActionIcon, Menu, Text, Tooltip } from "@mantine/core";

import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import { ToolbarToolIcon } from "@/components/layout/toolbar-tool-icon";
import { ToolbarTooltipContent } from "@/components/layout/toolbar-tooltip-content";
import { ShortcutHint } from "@/components/shortcuts/shortcut-hint";
import { getToolbarToolCommandId } from "@/core/shortcuts/commands";
import type {
  DropdownToolDefinition,
  RegisteredToolDefinition,
} from "@/core/tools/tool-registry";
import { useWorkbenchCommandHandlers } from "@/hooks/use-workbench-command-handlers";
import {
  getToolbarActionIconStyle,
  toolbarActionIconClassName,
} from "@/theme/workbench-toolbar-styles";

interface ToolDropdownButtonProps {
  tool: DropdownToolDefinition;
  variantTools: RegisteredToolDefinition[];
  active?: boolean;
  disabled?: boolean;
}

export function ToolDropdownButton({
  tool,
  variantTools,
  active = false,
  disabled = false,
}: ToolDropdownButtonProps) {
  const { activateTool } = useWorkbenchCommandHandlers();
  const [opened, setOpened] = useState(false);
  const commandId = getToolbarToolCommandId(tool.id);
  const controlBackground = disabled
    ? "var(--workbench-shell-control-surface)"
    : active
      ? "var(--workbench-shell-accent-surface)"
      : "transparent";
  const controlBorder = active
    ? "var(--workbench-shell-accent)"
    : "transparent";
  const controlColor = disabled
    ? "var(--workbench-shell-text-dim)"
    : "var(--workbench-shell-text)";

  const handleTriggerClick = () => {
    if (disabled) {
      return;
    }

    setOpened(true);

    if (variantTools.some((variant) => variant.id === tool.id)) {
      void activateTool(tool.id, {
        source: "toolbar",
      });
    }
  };

  const dropdownItems = variantTools.map((variant) => {
    return (
      <Menu.Item
        key={variant.id}
        onClick={() => {
          if (disabled) {
            return;
          }

          flushSync(() => setOpened(false));
          void activateTool(variant.id, {
            source: "dropdown",
          });
        }}
        disabled={disabled}
        data-tool-id={variant.id}
        data-tool-tooltip={variant.tooltip}
        data-disabled={disabled || undefined}
        leftSection={<ToolbarToolIcon icon={variant.icon} />}
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <Text size="sm" style={{ color: "var(--workbench-shell-text)" }}>
              {variant.name}
            </Text>
            <ShortcutHint commandId={getToolbarToolCommandId(variant.id)} />
          </div>
          <Text
            size="xs"
            style={{ color: "var(--workbench-shell-text-muted)" }}
          >
            {variant.tooltip}
          </Text>
        </div>
      </Menu.Item>
    );
  });
  const dropdown = (
    <Menu.Dropdown
      style={{
        backgroundColor: "var(--workbench-shell-overlay-strong)",
        border: "none",
        boxShadow: "var(--workbench-shell-elevation-md)",
      }}
    >
      {dropdownItems}
    </Menu.Dropdown>
  );

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
              title={tool.name}
              description={tool.tooltip}
              commandId={commandId}
            />
          }
        >
          <ActionIcon
            type="button"
            onClick={handleTriggerClick}
            variant={active ? "light" : "subtle"}
            color="workbench"
            aria-label={tool.name}
            aria-pressed={active}
            disabled={disabled}
            data-tool-id={tool.id}
            data-tool-dropdown-trigger={tool.id}
            data-tool-tooltip={tool.tooltip}
            data-disabled={disabled || undefined}
            className={toolbarActionIconClassName}
            style={{
              ...getToolbarActionIconStyle({ active }),
              "--workbench-toolbar-action-bg": controlBackground,
              "--workbench-toolbar-action-border": controlBorder,
              "--workbench-toolbar-action-color": controlColor,
              alignItems: "center",
              display: "flex",
              gap: 4,
              height: 40,
              opacity: disabled ? 0.46 : 1,
              paddingInline: 10,
              width: "auto",
            }}
          >
            <ToolbarToolIcon icon={tool.icon} />
            <WorkbenchIcon
              name="chevronDown"
              className="h-3.5 w-3.5"
              style={{
                color: disabled
                  ? "var(--workbench-shell-text-dim)"
                  : "var(--workbench-shell-text-muted)",
              }}
            />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      {dropdown}
    </Menu>
  );
}
