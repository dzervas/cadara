import { ChevronDown } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`flex h-10 items-center gap-1 rounded-lg border px-2.5 text-[var(--cad-foreground)] transition hover:border-[var(--cad-border-strong)] hover:bg-[var(--cad-surface-elevated)] ${
                  active
                    ? 'border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)]'
                    : 'border-transparent'
                }`}
                aria-label={tool.name}
                aria-pressed={active}
                data-tool-id={tool.id}
                data-tool-tooltip={tool.tooltip}
              >
                <ToolbarToolIcon icon={tool.icon} />
                <ChevronDown className="h-3.5 w-3.5 text-[var(--cad-muted)]" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {variantTools.map((variant) => {
              return (
                <DropdownMenuItem
                  key={variant.id}
                  onSelect={() =>
                    triggerTool(variant.id, {
                      source: 'dropdown',
                    })
                  }
                  data-tool-id={variant.id}
                  data-tool-tooltip={variant.tooltip}
                >
                  <ToolbarToolIcon icon={variant.icon} className="mr-2" />
                  <div className="flex flex-col">
                    <span>{variant.name}</span>
                    <span className="text-xs text-[var(--cad-muted-foreground)]">
                      {variant.tooltip}
                    </span>
                  </div>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipContent>
          <ToolbarTooltipContent title={tool.name} description={tool.tooltip} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
