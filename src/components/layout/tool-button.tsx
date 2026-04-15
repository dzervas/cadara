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
}

export function ToolButton({
  tool,
  inline = false,
  onTrigger,
  active = false,
}: ToolButtonProps) {
  const { triggerTool } = useToolActions()

  const handleClick = () => {
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
      data-tool-id={tool.id}
      data-tool-source="search"
      data-tool-tooltip={tool.tooltip}
    >
      <Paper
        radius="md"
        px="sm"
        py={10}
        withBorder={active}
        style={{
          backgroundColor: active ? 'rgba(94, 130, 171, 0.2)' : 'transparent',
          borderColor: 'var(--mantine-color-dark-5)',
        }}
      >
        <div className="flex items-center gap-3">
          <Paper
            radius="md"
            withBorder
            p={8}
            style={{
              backgroundColor: 'var(--mantine-color-dark-8)',
              borderColor: 'var(--mantine-color-dark-5)',
            }}
          >
            <ToolbarToolIcon icon={tool.icon} />
          </Paper>
          <div className="min-w-0 flex-1">
            <Text size="sm" fw={500} c="dark.0" truncate="end">
              {tool.name}
            </Text>
            <Text size="xs" c="dimmed" truncate="end">
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
      data-tool-id={tool.id}
      data-tool-source="toolbar"
      data-tool-tooltip={tool.tooltip}
      styles={{
        root: {
          border: active
            ? '1px solid var(--mantine-color-workbench-4)'
            : '1px solid transparent',
          backgroundColor: active ? 'rgba(94, 130, 171, 0.22)' : 'transparent',
          color: 'var(--mantine-color-dark-0)',
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
