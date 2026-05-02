import { ActionIcon, Paper, Text, Tooltip, UnstyledButton } from '@mantine/core'

import { ToolbarToolIcon } from '@/components/layout/toolbar-tool-icon'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import { ShortcutHint } from '@/components/shortcuts/shortcut-hint'
import { getToolbarToolCommandId } from '@/core/shortcuts/commands'
import type { RegisteredToolDefinition } from '@/core/tools/tool-registry'
import { useWorkbenchCommandHandlers } from '@/hooks/use-workbench-command-handlers'

interface ToolButtonProps {
  tool: RegisteredToolDefinition
  inline?: boolean
  onTrigger?: () => void
  active?: boolean
  disabled?: boolean
  selected?: boolean
  buttonId?: string
  buttonRole?: string
  buttonTabIndex?: number
  ariaSelected?: boolean
  onButtonFocus?: () => void
  onButtonMouseEnter?: () => void
}

export function ToolButton({
  tool,
  inline = false,
  onTrigger,
  active = false,
  disabled = false,
  selected = false,
  buttonId,
  buttonRole,
  buttonTabIndex,
  ariaSelected,
  onButtonFocus,
  onButtonMouseEnter,
}: ToolButtonProps) {
  const { activateTool } = useWorkbenchCommandHandlers()
  const commandId = getToolbarToolCommandId(tool.id)
  const isSuccessAction = tool.id === 'finishSketch'
  const isEmphasized = active || isSuccessAction || selected
  const emphasisBackground = isSuccessAction
    ? 'var(--workbench-shell-success-surface)'
    : isEmphasized
      ? 'var(--workbench-shell-accent-surface)'
      : 'transparent'
  const emphasisBorder = isSuccessAction
    ? 'var(--workbench-shell-success-border)'
    : isEmphasized
      ? 'var(--workbench-shell-accent)'
      : 'transparent'
  const emphasisColor = isSuccessAction
    ? 'var(--workbench-shell-success-text)'
    : selected
      ? 'var(--workbench-shell-accent)'
      : 'var(--workbench-shell-text)'
  const controlBackground = disabled
    ? 'var(--workbench-shell-control-surface)'
    : emphasisBackground
  const controlBorder = isEmphasized
    ? emphasisBorder
    : 'transparent'
  const controlColor = disabled
    ? 'var(--workbench-shell-text-dim)'
    : emphasisColor
  const mutedTextColor = disabled
    ? 'var(--workbench-shell-text-dim)'
    : isSuccessAction
      ? 'var(--workbench-shell-success-text)'
      : 'var(--workbench-shell-text-muted)'

  const handleClick = () => {
    if (disabled) {
      return
    }

    void activateTool(tool.id, {
      source: inline ? 'search' : 'toolbar',
    })
    onTrigger?.()
  }

  const content = inline ? (
    <UnstyledButton
      type="button"
      onClick={handleClick}
      aria-label={tool.name}
      aria-selected={ariaSelected}
      disabled={disabled}
      id={buttonId}
      role={buttonRole}
      tabIndex={buttonTabIndex}
      data-tool-id={tool.id}
      data-tool-source="search"
      data-tool-tooltip={tool.tooltip}
      data-disabled={disabled || undefined}
      onFocus={onButtonFocus}
      onMouseEnter={onButtonMouseEnter}
    >
      <Paper
        radius="md"
        px="sm"
        py={10}
        withBorder={disabled || isEmphasized}
        style={{
          backgroundColor: controlBackground,
          borderColor: disabled ? 'var(--workbench-shell-border)' : isEmphasized ? emphasisBorder : 'var(--workbench-shell-border)',
          opacity: disabled ? 0.52 : 1,
        }}
      >
        <div className="flex items-center gap-3">
          <Paper
            radius="md"
            withBorder
            p={8}
            style={{
              backgroundColor: 'var(--workbench-shell-control-surface)',
              borderColor: 'var(--workbench-shell-border)',
              color: controlColor,
            }}
          >
            <ToolbarToolIcon icon={tool.icon} />
          </Paper>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <Text size="sm" fw={500} truncate="end" style={{ color: controlColor }}>
                {tool.name}
              </Text>
              <ShortcutHint commandId={commandId} />
            </div>
            <Text
              size="xs"
              truncate="end"
              style={{ color: mutedTextColor }}
            >
              {tool.tooltip}
            </Text>
          </div>
        </div>
      </Paper>
    </UnstyledButton>
  ) : (
    <ActionIcon
      type="button"
      onClick={handleClick}
      variant={active ? 'light' : 'subtle'}
      color="workbench"
      aria-label={tool.name}
      aria-pressed={active}
      disabled={disabled}
      data-tool-id={tool.id}
      data-tool-source="toolbar"
      data-tool-tooltip={tool.tooltip}
      data-disabled={disabled || undefined}
      styles={{
        root: {
          border: `1px solid ${controlBorder}`,
          backgroundColor: controlBackground,
          color: controlColor,
          cursor: disabled ? 'not-allowed' : undefined,
          opacity: disabled ? 0.46 : 1,
        },
      }}
    >
      <ToolbarToolIcon icon={tool.icon} />
    </ActionIcon>
  )

  if (inline) {
    return content
  }

  return (
    <Tooltip label={<ToolbarTooltipContent title={tool.name} description={tool.tooltip} commandId={commandId} />}>
      {content}
    </Tooltip>
  )
}
