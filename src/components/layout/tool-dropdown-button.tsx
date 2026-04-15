import { Menu, Paper, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { ChevronDown } from 'lucide-react'

import { ToolbarToolIcon } from '@/components/layout/toolbar-tool-icon'
import { ToolbarTooltipContent } from '@/components/layout/toolbar-tooltip-content'
import type { RegisteredToolDefinition } from '@/domain/tools/tool-registry'
import { useToolActions } from '@/hooks/use-tool-actions'

interface ToolDropdownButtonProps {
  tool: RegisteredToolDefinition
  variantTools: RegisteredToolDefinition[]
  active?: boolean
}

export function ToolDropdownButton({
  tool,
  variantTools,
  active = false,
}: ToolDropdownButtonProps) {
  const { triggerTool } = useToolActions()

  return (
    <Menu width={224}>
      <Menu.Target>
        <Tooltip label={<ToolbarTooltipContent title={tool.name} description={tool.tooltip} />}>
          <UnstyledButton
            type="button"
            aria-label={tool.name}
            aria-pressed={active}
            data-tool-id={tool.id}
            data-tool-tooltip={tool.tooltip}
          >
            <Paper
              radius="md"
              px={10}
              h={40}
              withBorder={active}
              style={{
                alignItems: 'center',
                backgroundColor: active ? 'rgba(94, 130, 171, 0.22)' : 'transparent',
                borderColor: active
                  ? 'var(--mantine-color-workbench-4)'
                  : 'transparent',
                color: 'var(--mantine-color-dark-0)',
                display: 'flex',
                gap: 4,
              }}
            >
              <ToolbarToolIcon icon={tool.icon} />
              <ChevronDown
                className="h-3.5 w-3.5"
                style={{ color: 'var(--mantine-color-dark-2)' }}
              />
            </Paper>
          </UnstyledButton>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown
        style={{
          backgroundColor: 'rgba(9, 13, 18, 0.98)',
          borderColor: 'var(--mantine-color-dark-5)',
          boxShadow: 'var(--workbench-panel-shadow)',
        }}
      >
        {variantTools.map((variant) => {
          return (
            <Menu.Item
              key={variant.id}
              onClick={() =>
                triggerTool(variant.id, {
                  source: 'dropdown',
                })
              }
              data-tool-id={variant.id}
              data-tool-tooltip={variant.tooltip}
              leftSection={<ToolbarToolIcon icon={variant.icon} />}
            >
              <div className="flex flex-col">
                <Text size="sm" c="dark.0">
                  {variant.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {variant.tooltip}
                </Text>
              </div>
            </Menu.Item>
          )
        })}
      </Menu.Dropdown>
    </Menu>
  )
}
