import { Fragment, useState } from "react";
import { flushSync } from "react-dom";
import { ActionIcon, Menu, Tooltip } from "@mantine/core";

import { ToolbarToolIcon } from "@/components/layout/toolbar-tool-icon";
import { ToolbarTooltipContent } from "@/components/layout/toolbar-tooltip-content";
import {
  ToolbarDropdownChevron,
  ToolbarToolMenuItem,
} from "@/components/layout/tool-dropdown-button";
import type {
  RegisteredToolDefinition,
  ToolId,
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

export interface ToolbarGroupDropdownSection {
  id: string;
  label: string;
  /** Every tool of the island, with families flattened into their variants. */
  tools: readonly RegisteredToolDefinition[];
  /** Names and tooltips of the hidden tools and families, a lookup hook for browser tests. */
  toolLabels: readonly string[];
}

interface ToolbarGroupDropdownButtonProps {
  sections: readonly ToolbarGroupDropdownSection[];
  isToolActive: (toolId: ToolId) => boolean;
  isToolDisabled: (tool: RegisteredToolDefinition) => boolean;
  recentToolIds: readonly string[];
  onToolUsed: (toolId: ToolId) => void;
}

/**
 * A collapsed island (or several merged islands): one trigger whose face is
 * the active or last used tool, opening a menu of every tool it hides.
 */
export function ToolbarGroupDropdownButton({
  sections,
  isToolActive,
  isToolDisabled,
  recentToolIds,
  onToolUsed,
}: ToolbarGroupDropdownButtonProps) {
  const { activateTool } = useWorkbenchCommandHandlers();
  const [opened, setOpened] = useState(false);
  const tools = sections.flatMap((section) => section.tools);
  const activeTool = tools.find((tool) => isToolActive(tool.id));
  const faceTool =
    activeTool ?? pickRecentToolbarTool(tools, recentToolIds) ?? tools[0]!;
  const title = sections.map((section) => section.label).join(" · ");
  const disabled = tools.every(isToolDisabled);
  const merged = sections.length > 1;

  return (
    <Menu
      width={248}
      opened={opened}
      onChange={setOpened}
      transitionProps={{ duration: 0 }}
    >
      <Menu.Target>
        <Tooltip
          disabled={opened}
          label={
            <ToolbarTooltipContent
              title={title}
              description={tools.map((tool) => tool.name).join(", ")}
            />
          }
        >
          <ActionIcon
            type="button"
            onClick={() => {
              if (!disabled) {
                setOpened(true);
              }
            }}
            variant={activeTool ? "light" : "subtle"}
            color="workbench"
            aria-label={title}
            aria-pressed={activeTool !== undefined}
            disabled={disabled}
            data-toolbar-group-trigger={sections
              .map((section) => section.id)
              .join(" ")}
            data-toolbar-group-tools={`|${sections
              .flatMap((section) => section.toolLabels)
              .join("|")}|`}
            data-disabled={disabled || undefined}
            className={toolbarActionIconClassName}
            style={getToolbarDropdownTriggerStyle({
              active: activeTool !== undefined,
              disabled,
            })}
          >
            <ToolbarToolIcon icon={faceTool.icon} />
            <ToolbarDropdownChevron disabled={disabled} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown
        style={{
          ...toolbarDropdownMenuStyle,
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        {sections.map((section, index) => (
          <Fragment key={section.id}>
            {merged ? (
              <>
                {index > 0 ? <Menu.Divider /> : null}
                <Menu.Label>{section.label}</Menu.Label>
              </>
            ) : null}
            {promoteRecentToolbarTool(section.tools, recentToolIds).map(
              (tool) => (
                <ToolbarToolMenuItem
                  key={tool.id}
                  tool={tool}
                  active={isToolActive(tool.id)}
                  disabled={isToolDisabled(tool)}
                  onSelect={(selected) => {
                    flushSync(() => setOpened(false));
                    onToolUsed(selected.id);
                    void activateTool(selected.id, { source: "dropdown" });
                  }}
                />
              ),
            )}
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
