import { ActionIcon, Paper, Text, Tooltip, UnstyledButton } from '@mantine/core'

import { ToolbarToolIcon } from '@/components/layout/toolbar-tool-icon'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import type { RegisteredToolDefinition } from '@/domain/tools/tool-registry'
import { useToolActions } from '@/hooks/use-tool-actions'

interface ToolButtonProps {
  tool: RegisteredToolDefinition
  inline?: boolean
  onTrigger?: () => void
  active?: boolean
  disabled?: boolean
}

export function ToolButton({
  tool,
  inline = false,
  onTrigger,
  active = false,
  disabled = false,
}: ToolButtonProps) {
  const { triggerTool } = useToolActions()
  const isSuccessAction = tool.id === 'finishSketch'
  const emphasisBackground = isSuccessAction
    ? 'var(--workbench-shell-success-surface)'
    : active
      ? 'var(--workbench-shell-accent-surface)'
      : 'transparent'
  const emphasisBorder = isSuccessAction
    ? 'var(--workbench-shell-success-border)'
    : active
      ? 'var(--workbench-shell-accent)'
      : 'transparent'
  const emphasisColor = isSuccessAction
    ? 'var(--workbench-shell-success-text)'
    : 'var(--workbench-shell-text)'

  const handleClick = () => {
    if (disabled) {
      return
    }

    triggerTool(tool.id, {
      source: inline ? 'search' : 'toolbar',
    })
    onTrigger?.()
  }

  const content = inline ? (
    <UnstyledButton
      type="button"
      onClick={handleClick}
      aria-label={tool.name}
      disabled={disabled}
      data-tool-id={tool.id}
      data-tool-source="search"
      data-tool-tooltip={tool.tooltip}
      data-disabled={disabled || undefined}
    >
      <Paper
        radius="md"
        px="sm"
        py={10}
        withBorder={active || isSuccessAction}
        style={{
          backgroundColor: emphasisBackground,
          borderColor: active || isSuccessAction ? emphasisBorder : 'var(--workbench-shell-border)',
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
            }}
          >
            <ToolbarToolIcon icon={tool.icon} />
          </Paper>
          <div className="min-w-0 flex-1">
            <Text size="sm" fw={500} truncate="end" style={{ color: emphasisColor }}>
              {tool.name}
            </Text>
            <Text
              size="xs"
              truncate="end"
              style={{
                color: isSuccessAction
                  ? 'var(--workbench-shell-success-text)'
                  : 'var(--workbench-shell-text-muted)',
              }}
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
          border: `1px solid ${active || isSuccessAction ? emphasisBorder : 'transparent'}`,
          backgroundColor: emphasisBackground,
          color: emphasisColor,
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
    <Tooltip label={<ToolbarTooltipContent title={tool.name} description={tool.tooltip} />}>
      {content}
    </Tooltip>
  )
}
